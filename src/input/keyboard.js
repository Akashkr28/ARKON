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
