import * as actions from '../actions/viewerActions';
import { useViewerStore } from '../store/viewerStore';
import { pickPartAt } from '../scene/picking';
import { screenToNdc, screenToPlane } from '../vision/projection';
import { NAVIGATION, VIEW } from '../config';

// Mouse, trackpad and touch navigation. Everything goes through viewerActions, so it
// mixes freely with gestures (and, later, the AI assistant and other users).
//
//   left drag / one finger        rotate
//   right or middle drag,         pan
//   shift + left drag
//   wheel / pinch                 zoom toward the cursor / between the fingers
//   click (while exploded)        select the part under the cursor
//   double-click                  move the model to the cursor

const HUD_SELECTOR = '.hud-panel, .hud-errors, .part-info, button, select, input, label';

function isOverHud(target) {
  return Boolean(target?.closest?.(HUD_SELECTOR));
}

// Screen pixels → scene units on the plane the model sits in.
function worldPerPixel() {
  const depth = VIEW.cameraZ - useViewerStore.getState().position[2];
  return (2 * Math.tan((VIEW.cameraFov * Math.PI) / 360) * depth) / window.innerHeight;
}

function screenToModelPlane(x, y) {
  const z = useViewerStore.getState().position[2];
  return screenToPlane({ x, y }, window.innerWidth, window.innerHeight, z, {});
}

// --- Drag state ----------------------------------------------------------------

const pointers = new Map(); // pointerId -> { x, y }
let gesture = null; // { mode: 'rotate' | 'pan' | 'pinch', startX, startY, dragged }
let suppressNextClick = false;

function dragMode(event) {
  if (event.pointerType === 'touch') return 'rotate';
  if (event.button === 1 || event.button === 2 || event.shiftKey) return 'pan';
  return 'rotate';
}

function pinchInfo() {
  const [a, b] = [...pointers.values()];
  return { distance: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
}

function onPointerDown(event) {
  if (isOverHud(event.target)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2) {
    gesture = { mode: 'pinch', dragged: true, ...pinchInfo() };
  } else if (pointers.size === 1) {
    gesture = { mode: dragMode(event), startX: event.clientX, startY: event.clientY, dragged: false };
  }
}

function onPointerMove(event) {
  const previous = pointers.get(event.pointerId);
  if (!previous || !gesture) return;
  const dx = event.clientX - previous.x;
  const dy = event.clientY - previous.y;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (gesture.mode === 'pinch') {
    if (pointers.size < 2) return;
    const now = pinchInfo();
    const centre = screenToModelPlane(now.midX, now.midY);
    if (gesture.distance > 0) actions.zoomAbout(centre.x, centre.y, now.distance / gesture.distance);
    const scale = worldPerPixel();
    actions.moveBy((now.midX - gesture.midX) * scale, -(now.midY - gesture.midY) * scale);
    Object.assign(gesture, now);
    return;
  }

  if (!gesture.dragged) {
    const moved = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
    if (moved < NAVIGATION.dragThresholdPx) return;
    gesture.dragged = true;
    actions.stopSpin();
    document.body.classList.add('is-navigating');
  }

  if (gesture.mode === 'rotate') {
    // Horizontal drag turns around the vertical axis; vertical drag tilts.
    actions.rotateBy(dy * NAVIGATION.rotatePerPixel, dx * NAVIGATION.rotatePerPixel);
  } else {
    const scale = worldPerPixel();
    actions.moveBy(dx * scale, -dy * scale);
  }
}

function onPointerUp(event) {
  if (!pointers.delete(event.pointerId)) return;
  if (gesture?.dragged) suppressNextClick = true; // a drag isn't a click
  if (pointers.size === 0) {
    gesture = null;
    document.body.classList.remove('is-navigating');
  } else if (gesture?.mode === 'pinch') {
    // One finger lifted: carry on rotating with the other.
    const [remaining] = pointers.values();
    gesture = { mode: 'rotate', startX: remaining.x, startY: remaining.y, dragged: true };
  }
}

function onWheel(event) {
  if (isOverHud(event.target)) return;
  event.preventDefault(); // otherwise the page (or a pinch-zoom) scrolls
  const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY; // lines → px
  const point = screenToModelPlane(event.clientX, event.clientY);
  actions.zoomAbout(point.x, point.y, Math.exp(-pixels * NAVIGATION.wheelZoomPerPixel));
}

// --- Clicks ----------------------------------------------------------------------

function onClick(event) {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
  if (isOverHud(event.target) || !actions.isExploded()) return;
  const ndc = screenToNdc({ x: event.clientX, y: event.clientY }, window.innerWidth, window.innerHeight, {});
  const partId = pickPartAt(ndc.x, ndc.y);
  if (partId) {
    actions.selectPart(partId);
    actions.showPartInfo(partId);
  } else {
    actions.clearSelection();
  }
}

function onDoubleClick(event) {
  if (isOverHud(event.target)) return;
  const point = screenToModelPlane(event.clientX, event.clientY);
  actions.spawnAt(point.x, point.y, point.z);
}

function onContextMenu(event) {
  if (!isOverHud(event.target)) event.preventDefault(); // right-drag pans
}

export function bindPointer() {
  const listeners = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', onPointerUp],
    ['pointercancel', onPointerUp],
    ['click', onClick],
    ['dblclick', onDoubleClick],
    ['contextmenu', onContextMenu],
  ];
  for (const [type, handler] of listeners) window.addEventListener(type, handler);
  window.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    for (const [type, handler] of listeners) window.removeEventListener(type, handler);
    window.removeEventListener('wheel', onWheel);
    pointers.clear();
    gesture = null;
  };
}
