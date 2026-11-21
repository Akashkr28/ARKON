import { create } from 'zustand';
import { useViewerStore } from '../store/viewerStore';

// Undo/redo for the model's arrangement. Instead of wrapping each action, history
// watches the store: a burst of changes (a mouse drag, a wheel zoom, a whole gesture,
// a spin coasting to a stop) becomes ONE step once things have been still for
// SETTLE_MS. So gestures, mouse, keyboard and future AI/collab changes are all covered.
//
// Selection, view toggles and camera settings are deliberately not undoable,
// as in most CAD tools.

const SETTLE_MS = 400;
const MAX_STEPS = 100;

// Fields that make up "the arrangement".
const TRACKED = ['position', 'rotation', 'scale', 'explodeTarget', 'hiddenPartIds', 'xrayPartIds'];

export const useHistoryStore = create(() => ({ undoLabel: null, redoLabel: null }));

const undoStack = [];
const redoStack = [];
let pendingBefore = null;
let pendingLabel = null;
let labelHint = null; // set by an action just before it changes the store
let settleTimer = null;
let applying = false;
// Interactions in progress ('pointer', 'gesture'): a step never closes mid-drag,
// however long the user pauses.
const activeInteractions = new Set();

// Actions whose intent the diff can't show (isolate looks like "hide 26 parts")
// name their step. Call right before the change.
export function nameNextStep(label) {
  labelHint = label;
  // The store notifies synchronously; if the action turned out to change nothing,
  // don't let the name stick to some later, unrelated change.
  queueMicrotask(() => {
    if (labelHint === label) labelHint = null;
  });
}

export function setInteractionActive(name, active) {
  if (active) {
    activeInteractions.add(name);
    return;
  }
  if (!activeInteractions.delete(name)) return;
  if (activeInteractions.size === 0 && pendingBefore) {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, SETTLE_MS); // let damping/inertia finish first
  }
}

function snapshot(state) {
  return Object.fromEntries(TRACKED.map((key) => [key, state[key]]));
}

function sameItem(a, b) {
  return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b;
}

function sameValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameItem(v, b[i]));
  return sameItem(a, b);
}

function changedKeys(before, after) {
  return TRACKED.filter((key) => !sameValue(before[key], after[key]));
}

function describe(before, after, keys) {
  if (keys.includes('hiddenPartIds')) {
    const diff = after.hiddenPartIds.length - before.hiddenPartIds.length;
    if (after.hiddenPartIds.length === 0) return 'Show all';
    return diff > 0 ? `Hide ${diff} part${diff === 1 ? '' : 's'}` : 'Show parts';
  }
  if (keys.includes('xrayPartIds')) return 'X-ray';
  if (keys.includes('explodeTarget')) return after.explodeTarget > before.explodeTarget ? 'Explode' : 'Assemble';
  if (keys.length === 1 && keys[0] === 'rotation') return 'Rotate';
  if (keys.length === 1 && keys[0] === 'position') return 'Move';
  if (keys.every((key) => key === 'scale' || key === 'position')) return 'Zoom';
  return 'View change';
}

function publish() {
  useHistoryStore.setState({
    undoLabel: undoStack.at(-1)?.label ?? null,
    redoLabel: redoStack.at(-1)?.label ?? null,
  });
}

// Close the step in progress, if any. `force` closes it even mid-interaction
// (used by undo/redo).
function settle(force = false) {
  clearTimeout(settleTimer);
  settleTimer = null;
  if (!pendingBefore) return;
  if (!force && activeInteractions.size > 0) return; // closes when the interaction ends
  const after = snapshot(useViewerStore.getState());
  const keys = changedKeys(pendingBefore, after);
  if (keys.length) {
    const label = pendingLabel ?? describe(pendingBefore, after, keys);
    undoStack.push({ before: pendingBefore, after, label });
    if (undoStack.length > MAX_STEPS) undoStack.shift();
    redoStack.length = 0;
  }
  pendingBefore = null;
  pendingLabel = null;
  publish();
}

function onStoreChange(state, previous) {
  if (applying) return;
  // A different model (or a reload) starts a fresh history.
  if (state.modelId !== previous.modelId || state.modelLoadCount !== previous.modelLoadCount) {
    clearHistory();
    return;
  }
  const before = snapshot(previous);
  if (!changedKeys(before, snapshot(state)).length) return;
  pendingBefore ??= before;
  if (labelHint) {
    pendingLabel = labelHint;
    labelHint = null;
  }
  clearTimeout(settleTimer);
  settleTimer = setTimeout(settle, SETTLE_MS);
}

function restore(values) {
  applying = true;
  try {
    useViewerStore.setState({ ...values, spinVelocity: [0, 0] });
  } finally {
    applying = false;
  }
}

export function undo() {
  settle(true); // an in-progress change becomes its own step first
  const step = undoStack.pop();
  if (!step) return null;
  restore(step.before);
  redoStack.push(step);
  publish();
  return step.label;
}

export function redo() {
  settle(true);
  const step = redoStack.pop();
  if (!step) return null;
  restore(step.after);
  undoStack.push(step);
  publish();
  return step.label;
}

export function clearHistory() {
  activeInteractions.clear();
  clearTimeout(settleTimer);
  settleTimer = null;
  pendingBefore = null;
  pendingLabel = null;
  labelHint = null;
  undoStack.length = 0;
  redoStack.length = 0;
  publish();
}

// Call once at startup; returns an unsubscribe function.
export function startHistory() {
  const unsubscribe = useViewerStore.subscribe(onStoreChange);
  return () => {
    unsubscribe();
    clearHistory();
  };
}
