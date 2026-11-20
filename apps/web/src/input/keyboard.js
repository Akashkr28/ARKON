import * as actions from '../actions/viewerActions';

const SHORTCUTS = {
  e: actions.toggleExplode,
  c: actions.cycleCamera,
  b: actions.toggleGrayscale,
  f: actions.toggleMirror,
  l: actions.toggleLabels,
  d: actions.toggleDebug,
  r: actions.resetModel,
  m: actions.toggleMaterialMode,
  escape: actions.clearSelection,
  // Views, laid out like Blender's numpad (works on the number row too).
  0: actions.fitToView,
  1: () => actions.setView('front'),
  3: () => actions.setView('right'),
  7: () => actions.setView('top'),
  5: () => actions.setView('iso'),
};

function isTyping(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target?.isContentEditable;
}

function handleKeyDown(event) {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  if (isTyping(event.target)) return;
  const action = SHORTCUTS[event.key.toLowerCase()];
  if (!action) return;
  event.preventDefault();
  action();
}

export function bindKeyboard() {
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}
