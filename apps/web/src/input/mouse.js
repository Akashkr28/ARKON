import * as actions from '../actions/viewerActions';
import { useViewerStore } from '../store/viewerStore';
import { pickPartAt } from '../scene/picking';
import { screenToNdc, screenToPlane } from '../vision/projection';

// Mouse fallbacks: double-click spawns the model at the cursor; while exploded, a
// click selects the part under the cursor (or clears the selection on empty space).

function isOverHud(target) {
  return Boolean(target.closest?.('.hud-panel, .hud-errors, .part-info, button, select, input'));
}

function handleDoubleClick(event) {
  if (isOverHud(event.target)) return;
  const z = useViewerStore.getState().position[2];
  const point = screenToPlane(
    { x: event.clientX, y: event.clientY },
    window.innerWidth,
    window.innerHeight,
    z,
    {},
  );
  actions.spawnAt(point.x, point.y, point.z);
}

function handleClick(event) {
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

export function bindMouse() {
  window.addEventListener('dblclick', handleDoubleClick);
  window.addEventListener('click', handleClick);
  return () => {
    window.removeEventListener('dblclick', handleDoubleClick);
    window.removeEventListener('click', handleClick);
  };
}
