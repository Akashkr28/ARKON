import * as actions from '../actions/viewerActions';
import { useViewerStore } from '../store/viewerStore';
import { pickPartAt } from '../scene/picking';
import { screenToNdc, screenToPlane } from '../vision/projection';
import { NAVIGATION, VIEW } from '../config';
import { setInteractionActive } from '../actions/history';
import { addMeasurePoint, setMeasureHover, useMeasureStore } from '../actions/measureActions';
import { inspectAt, pointAt, snapAt } from '../scene/sceneQueries';
import { pinInspected, setInspectHover } from '../actions/specActions';
import { useSpecStore } from '../store/specStore';
import { useUiStore } from '../store/uiStore';
import { useAssemblyStore } from '../store/assemblyStore';
import { setCursorPoint } from '../store/cursorStore';
import { beginHandleDrag, endHandleDrag, hoverHandle, moveHandleDrag } from '../actions/handleDrag';
import { productForSpec } from '../models/partFaces';
import { componentAt, faceAt } from '../scene/assemblyQueries';
import { pickFace, selectComponent } from '../actions/assemblyActions';

// Mouse, trackpad and touch navigation. Everything goes through viewerActions, so it
// mixes freely with gestures (and, later, the AI assistant and other users).
//
//   left drag / one finger        rotate
//   right or middle drag,         pan
//   shift + left drag
//   wheel / pinch                 zoom toward the cursor / between the fingers
//   click                         select the part under the cursor (empty space clears)
//   shift / ctrl / cmd + click    add or remove a part from the selection
//   double-click                  frame the part under the cursor (empty space: everything)
//   with a measure tool on        click places measurement points (snapping to corners/edges)
//   DESIGN: drag a handle         shape the part
//   ASSEMBLE: drag a part         move it (a mated part slides the way its mate allows);
//             click               select it; with a mate tool on, pick faces
//
// Hands get the same clicks through clickAt / doubleClickAt (input/handCursor.js).

export const HUD_SELECTOR = '.hud-panel, .hud-errors, .part-info, .gesture-picker, button, select, input, label';

export function isOverHud(target) {
  return Boolean(target?.closest?.(HUD_SELECTOR));
}

// Screen pixels → scene units at a depth from the camera (default: the model's centre).
function worldPerPixel(depth = VIEW.cameraZ - useViewerStore.getState().position[2]) {
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
    setInteractionActive('pointer', true);
  } else if (pointers.size === 1) {
    // Designing: grabbing a handle shapes the part instead of turning the view.
    // Assembling: grabbing a part moves it (and a click without moving selects it).
    if (
      (designing() || (assembling() && !event.shiftKey)) &&
      event.button === 0 &&
      beginHandleDrag(event.clientX, event.clientY)
    ) {
      gesture = { mode: 'handle', dragged: designing() };
      document.body.classList.add('is-dragging-handle');
      return;
    }
    // What's under the cursor: rotation pivots around it and panning moves it 1:1,
    // which matters once you've zoomed in close.
    const grabbed = pointAt(event.clientX, event.clientY);
    gesture = {
      mode: dragMode(event),
      startX: event.clientX,
      startY: event.clientY,
      dragged: false,
      pivot: grabbed?.model ?? null,
      depth: grabbed?.depth ?? undefined,
    };
  }
}

const measuring = () => useMeasureStore.getState().tool !== 'off';
const designing = () => useUiStore.getState().workspace === 'design';
const assembling = () => useUiStore.getState().workspace === 'assemble';

let handleFrame = 0;
function updateHandleHover(x, y) {
  if (handleFrame) return;
  handleFrame = requestAnimationFrame(() => {
    handleFrame = 0;
    document.body.classList.toggle('is-handle-hover', Boolean(hoverHandle(x, y)));
  });
}

// Hover snapping runs at most once per frame, whatever the mouse event rate.
let hoverFrame = 0;
function updateMeasureHover(x, y) {
  if (hoverFrame) return;
  hoverFrame = requestAnimationFrame(() => {
    hoverFrame = 0;
    setMeasureHover(snapAt(x, y));
  });
}

// The inspector: with the SPECS tab open, hovering names the CAD face or edge under the
// cursor (a click keeps it in the spec sheet). Off while measuring.
const inspecting = () =>
  useUiStore.getState().hudTab === 'specs' && useSpecStore.getState().facesStatus === 'ready' && !measuring();

// Coordinates under the cursor (readout, scale bar, grid), at most once a frame.
let cursorFrame = 0;
function updateCursorPoint(x, y) {
  if (cursorFrame) return;
  cursorFrame = requestAnimationFrame(() => {
    cursorFrame = 0;
    setCursorPoint(pointAt(x, y));
  });
}

let inspectFrame = 0;
function updateInspectHover(x, y) {
  if (inspectFrame) return;
  inspectFrame = requestAnimationFrame(() => {
    inspectFrame = 0;
    const { faces } = useSpecStore.getState();
    const item = inspectAt(x, y, (specIndex) => productForSpec(faces, specIndex));
    setInspectHover(item ? { ...item, x, y } : null);
  });
}

function onPointerMove(event) {
  const previous = pointers.get(event.pointerId);
  if (!previous && measuring() && !isOverHud(event.target)) updateMeasureHover(event.clientX, event.clientY);
  if (!previous) {
    if (isOverHud(event.target)) setCursorPoint(null);
    else updateCursorPoint(event.clientX, event.clientY);
    if ((designing() || assembling()) && !isOverHud(event.target)) updateHandleHover(event.clientX, event.clientY);
  }
  if (previous && gesture?.mode === 'handle') {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    moveHandleDrag(event.clientX, event.clientY, { fine: event.shiftKey }); // Shift: 0.1 mm steps
    return;
  }
  if (!previous && inspecting()) {
    if (isOverHud(event.target)) setInspectHover(null);
    else updateInspectHover(event.clientX, event.clientY);
  }
  if (previous && gesture?.dragged) setInspectHover(null);
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
    setInteractionActive('pointer', true);
    document.body.classList.add('is-navigating');
  }

  if (gesture.mode === 'rotate') {
    // Horizontal drag turns around the vertical axis; vertical drag tilts.
    actions.rotateBy(dy * NAVIGATION.rotatePerPixel, dx * NAVIGATION.rotatePerPixel, gesture.pivot);
  } else {
    const scale = worldPerPixel(gesture.depth);
    actions.moveBy(dx * scale, -dy * scale);
  }
}

function onPointerUp(event) {
  if (!pointers.delete(event.pointerId)) return;
  if (gesture?.dragged) suppressNextClick = true; // a drag isn't a click
  if (gesture?.mode === 'handle') {
    if (endHandleDrag()) suppressNextClick = true;
    document.body.classList.remove('is-dragging-handle');
  }
  if (pointers.size === 0) {
    gesture = null;
    setInteractionActive('pointer', false);
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
  const factor = Math.exp(-pixels * NAVIGATION.wheelZoomPerPixel);
  // Toward the surface under the cursor; over empty space, toward the model's plane.
  const surface = pointAt(event.clientX, event.clientY);
  if (surface) {
    actions.zoomAt(surface.model, factor);
    return;
  }
  const point = screenToModelPlane(event.clientX, event.clientY);
  actions.zoomAbout(point.x, point.y, factor);
}

// --- Clicks ----------------------------------------------------------------------

function onClick(event) {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
  if (isOverHud(event.target)) return;
  clickAt(event.clientX, event.clientY, { additive: event.shiftKey || event.ctrlKey || event.metaKey });
}

// A click on the scene at a screen point, from the mouse or a hand's air tap: places a
// measurement point, picks a face or part in ASSEMBLE, or selects the part there
// (additive: add or remove it instead; empty space clears).
export function clickAt(x, y, { additive = false } = {}) {
  if (measuring()) {
    addMeasurePoint(snapAt(x, y));
    return;
  }
  if (assembling()) {
    if (useAssemblyStore.getState().tool) pickFace(faceAt(x, y));
    else selectComponent(componentAt(x, y)?.componentId ?? null);
    return;
  }
  const ndc = screenToNdc({ x, y }, window.innerWidth, window.innerHeight, {});
  const partId = pickPartAt(ndc.x, ndc.y);
  if (inspecting()) {
    const { faces } = useSpecStore.getState();
    pinInspected(inspectAt(x, y, (specIndex) => productForSpec(faces, specIndex)));
  }
  if (partId && additive) {
    actions.toggleInSelection(partId);
  } else if (partId) {
    actions.selectPart(partId);
    actions.showPartInfo(partId);
  } else if (!additive) {
    actions.clearSelection();
  }
}

function onDoubleClick(event) {
  if (isOverHud(event.target)) return;
  doubleClickAt(event.clientX, event.clientY);
}

// Frame the part at a screen point (empty space: everything).
export function doubleClickAt(x, y) {
  // Measuring quickly would otherwise double-click; don't jump the view mid-measure.
  if (measuring()) return;
  const ndc = screenToNdc({ x, y }, window.innerWidth, window.innerHeight, {});
  const partId = pickPartAt(ndc.x, ndc.y);
  if (!partId || !actions.fitToParts([partId], 'Fit to part')) actions.fitToView();
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
  // Crosshair cursor while a measure tool is on.
  const unsubscribeTool = useMeasureStore.subscribe((state) => {
    document.body.classList.toggle('is-measuring', state.tool !== 'off');
  });
  return () => {
    unsubscribeTool();
    cancelAnimationFrame(hoverFrame);
    for (const [type, handler] of listeners) window.removeEventListener(type, handler);
    window.removeEventListener('wheel', onWheel);
    pointers.clear();
    gesture = null;
  };
}
