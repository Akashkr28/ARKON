import * as actions from '../actions/viewerActions';
import { cancelMeasuring, cycleMeasureTool } from '../actions/measureActions';

const SHORTCUTS = {
  e: actions.toggleExplode,
  c: actions.cycleCamera,
  b: actions.toggleGrayscale,
  f: actions.toggleMirror,
  l: actions.toggleLabels,
  d: actions.toggleDebug,
  r: actions.resetModel,
  m: actions.toggleMaterialMode,
  // Esc backs out one level: half-finished measurement, measure tool, then selection.
  escape: () => cancelMeasuring() || actions.clearSelection(),
  q: cycleMeasureTool, // off → distance → angle
  '.': actions.fitToSelection, // like Blender's numpad period
  // Visibility of the selection: hide, isolate, show all ("unhide"), x-ray.
  h: () => actions.hideParts(),
  i: () => actions.isolateParts(),
  u: actions.showAllParts,
  x: () => actions.toggleXray(),
  // Views, laid out like Blender's numpad (works on the number row too).
  0: actions.fitToView,
  1: () => actions.setView('front'),
  3: () => actions.setView('right'),
  7: () => actions.setView('top'),
  5: () => actions.setView('iso'),
};

// Ctrl (Windows/Linux) or Cmd (Mac) combinations.
function commandShortcut(event) {
  const key = event.key.toLowerCase();
  if (key === 'z' && event.shiftKey) return actions.redo;
  if (key === 'z') return actions.undo;
  if (key === 'y') return actions.redo;
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
