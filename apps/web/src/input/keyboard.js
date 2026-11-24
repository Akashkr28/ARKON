import * as actions from '../actions/viewerActions';
import { cancelMeasuring, cycleMeasureTool } from '../actions/measureActions';
import { toggleGrid, toggleSpecsTab } from '../store/uiStore';
import { closeGesturePicker } from './handCursor';
import { setTool } from '../actions/assemblyActions';
import { redoHere, undoHere } from '../actions/commands';
import { useAssemblyStore } from '../store/assemblyStore';

const SHORTCUTS = {
  e: actions.toggleExplode,
  c: actions.cycleCamera,
  b: actions.toggleGrayscale,
  f: actions.toggleMirror,
  l: actions.toggleLabels,
  d: actions.toggleDebug,
  r: actions.resetModel,
  m: actions.toggleMaterialMode,
  // Esc backs out one level: an open hand picker, half-finished measurement, measure
  // tool, mate tool, then selection.
  escape: () => closeGesturePicker() || cancelMeasuring() || cancelMateTool() || actions.clearSelection(),
  q: cycleMeasureTool, // off → distance → angle
  s: actions.cycleSection, // off → X → Y → Z
  '.': actions.fitToSelection, // like Blender's numpad period
  // Visibility of the selection: hide, isolate, show all ("unhide"), x-ray.
  h: () => actions.hideParts(),
  i: () => actions.isolateParts(),
  u: actions.showAllParts,
  x: () => actions.toggleXray(),
  g: toggleGrid, // ruler grid, on the section plane or the floor
  p: toggleSpecsTab, // the selection's full spec sheet (again: back to the parts list)
  // Views, laid out like Blender's numpad (works on the number row too).
  0: actions.fitToView,
  1: () => actions.setView('front'),
  3: () => actions.setView('right'),
  7: () => actions.setView('top'),
  5: () => actions.setView('iso'),
};

function cancelMateTool() {
  if (!useAssemblyStore.getState().tool) return false;
  setTool(null);
  return true;
}

// Ctrl (Windows/Linux) or Cmd (Mac) combinations.
function commandShortcut(event) {
  const key = event.key.toLowerCase();
  if (key === 'z' && event.shiftKey) return redoHere;
  if (key === 'z') return undoHere;
  if (key === 'y') return redoHere;
  if (key === 'a') return actions.selectAll;
  return null;
}

function isTyping(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target?.isContentEditable;
}

function handleKeyDown(event) {
  if (isTyping(event.target)) return;
  if (event.ctrlKey || event.metaKey) {
    const action = event.altKey ? null : commandShortcut(event);
    if (!action) return;
    event.preventDefault(); // e.g. Cmd+A would otherwise select the page text
    action();
    return;
  }
  if (event.repeat || event.altKey) return;
  const action = SHORTCUTS[event.key.toLowerCase()];
  if (!action) return;
  event.preventDefault();
  action();
}

export function bindKeyboard() {
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}
