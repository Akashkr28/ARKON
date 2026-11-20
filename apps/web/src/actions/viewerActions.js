import { useViewerStore, initialTransform } from '../store/viewerStore';
import { VIEW } from '../config';
import { findModelEntry } from '../models/catalog';
import { VIEW_PRESETS, fitScale, nearestAngle } from '../scene/viewPresets';
import { LENGTH_UNITS } from '../units';
import { redo as redoHistory, undo as undoHistory } from './history';

// The single place that changes viewer state. Gestures, keyboard, and (later) the AI
// assistant and collaborators all call these functions with plain, serializable args.

const get = () => useViewerStore.getState();
const set = (partial) => useViewerStore.setState(partial);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const listeners = new Set();

// TODO(collab): subscribe here and broadcast actions over Socket.IO.
// TODO(ai): expose the emitted action names as LLM tools with the same arguments.
export function onAction(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(name, args = {}) {
  for (const listener of listeners) listener(name, args);
}

// --- Undo / redo ---------------------------------------------------------------

export function undo() {
  const label = undoHistory();
  if (label) emit('undo', { label });
  return label;
}

export function redo() {
  const label = redoHistory();
  if (label) emit('redo', { label });
  return label;
}

// --- Model transform -------------------------------------------------------

export function moveTo(x, y, z = get().position[2]) {
  set({ position: [x, y, z] });
  emit('moveTo', { x, y, z });
}

export function moveBy(dx, dy, dz = 0) {
  const [x, y, z] = get().position;
  moveTo(x + dx, y + dy, z + dz);
}

export function rotateBy(dx, dy) {
  const [x, y, z] = get().rotation;
  set({ rotation: [x + dx, y + dy, z] });
  emit('rotateBy', { dx, dy });
}

export function spin(velocityX, velocityY) {
  set({ spinVelocity: [velocityX, velocityY] });
  emit('spin', { velocityX, velocityY });
}

export function stopSpin() {
  set({ spinVelocity: [0, 0] });
}

export function scaleTo(scale) {
  const clamped = clamp(scale, VIEW.minScale, VIEW.maxScale);
  set({ scale: clamped });
  emit('scaleTo', { scale: clamped });
}

export function scaleBy(factor) {
  scaleTo(get().scale * factor);
}

// Zoom around a point on the model's plane (scene units), keeping that point fixed
// on screen, like zooming toward the mouse cursor in CAD tools.
export function zoomAbout(x, y, factor) {
  const { scale, position } = get();
  const next = clamp(scale * factor, VIEW.minScale, VIEW.maxScale);
  const applied = next / scale;
  const [px, py, pz] = position;
  set({ scale: next, position: [x + (px - x) * applied, y + (py - y) * applied, pz] });
  emit('zoomAbout', { x, y, factor });
}

// Turn the model to a standard view: front, back, left, right, top, bottom or iso.
export function setView(name) {
  const preset = VIEW_PRESETS[name];
  if (!preset) return false;
  const [x, y] = get().rotation;
  const [targetX, targetY] = preset.rotation;
  set({ rotation: [nearestAngle(x, targetX), nearestAngle(y, targetY), 0], spinVelocity: [0, 0] });
  emit('setView', { name });
  return true;
}

// Centre the model and size it to fit the screen (accounting for any explode),
// keeping its current orientation.
export function fitToView() {
  set({ position: [0, 0, 0], scale: fitScale(get().explodeTarget), spinVelocity: [0, 0] });
  emit('fitToView');
}

export function setLengthUnit(unit) {
  if (!LENGTH_UNITS[unit]) return;
  set({ lengthUnit: unit });
}

export function spawnAt(x, y, z = 0) {
  set({ modelVisible: true, position: [x, y, z], spinVelocity: [0, 0] });
  emit('spawnAt', { x, y, z });
}

// Selection: `selectedPartIds` in the order they were picked; `selectedPartId` is the
// most recent one (the "primary": the part a pinch pulls and the info card shows).
// Only these actions write them, so the two always agree.
const NO_SELECTION = { selectedPartIds: [], selectedPartId: null, infoPartId: null, partPull: [0, 0, 0] };

function selectionOf(ids) {
  return { selectedPartIds: ids, selectedPartId: ids.at(-1) ?? null, partPull: [0, 0, 0] };
}

export function resetModel() {
  set({
    ...initialTransform(),
    ...NO_SELECTION,
    modelVisible: true,
    spinVelocity: [0, 0],
    explodeTarget: 0,
  });
  emit('resetModel');
}

// --- Explode / parts -------------------------------------------------------

export function explode(factor = 1) {
  const clamped = clamp(factor, 0, VIEW.maxExplode);
  set({ explodeTarget: clamped });
  emit('explode', { factor: clamped });
}

export function assemble() {
  set({ explodeTarget: 0, ...NO_SELECTION });
  emit('assemble');
}

export function isExploded() {
  return get().explodeTarget > 0.05;
}

// Keyboard/menu explode: also shrink the view so the exploded parts stay on screen
// (gesture explodes are continuous, so they don't refit).
export function toggleExplode() {
  if (isExploded()) assemble();
  else {
    explode(1);
    const fit = fitScale(1);
    if (get().scale > fit) set({ scale: fit, position: [0, 0, 0] });
  }
}

// Select just this part (replacing the selection).
export function selectPart(partId) {
  if (partId === null) return clearSelection();
  if (!get().parts[partId]) return;
  set({ ...NO_SELECTION, ...selectionOf([partId]) });
  emit('selectPart', { partId });
}

// Shift/Ctrl-click: add the part, or remove it if it's already selected.
export function toggleInSelection(partId) {
  if (!get().parts[partId]) return;
  const current = get().selectedPartIds;
  const ids = current.includes(partId) ? current.filter((id) => id !== partId) : [...current, partId];
  const infoPartId = get().infoPartId && ids.length ? ids.at(-1) : null;
  set({ ...selectionOf(ids), infoPartId });
  emit('toggleInSelection', { partId });
}

export function selectParts(partIds) {
  const ids = [...new Set(partIds)].filter((id) => get().parts[id]);
  set({ ...NO_SELECTION, ...selectionOf(ids) });
  emit('selectParts', { partIds: ids });
}

export function selectAll() {
  selectParts(Object.keys(get().parts));
}

export function clearSelection() {
  set(NO_SELECTION);
  emit('clearSelection');
}

// Offset (scene units, world axes) of the selected part from its exploded position.
export function pullPart(x, y, z = 0) {
  if (!get().selectedPartId) return;
  set({ partPull: [x, y, z] });
  emit('pullPart', { x, y, z });
}

// The part springs back to its exploded position; it stays selected.
export function releasePart() {
  set({ partPull: [0, 0, 0] });
  emit('releasePart');
}

export function showPartInfo(partId = get().selectedPartId) {
  if (!partId || !get().parts[partId]) return;
  set({ infoPartId: partId });
  emit('showPartInfo', { partId });
}

export function hidePartInfo() {
  set({ infoPartId: null });
}

// --- Model loading ---------------------------------------------------------

// modelId is a bundled sample id or an uploaded model's id (which must be ready).
export function loadModel(modelId) {
  if (!findModelEntry(modelId)) return false;
  set({
    ...NO_SELECTION,
    modelId,
    // Bumped on every load so the scene remounts even when the id is unchanged
    // (retry after an error, reload after a re-upload).
    modelLoadCount: get().modelLoadCount + 1,
    modelStatus: 'loading',
    modelError: null,
    parts: {},
    explodeTarget: 0,
  });
  emit('loadModel', { modelId });
  return true;
}

// `units` says how scene lengths map to real ones: metresPerSceneUnit at scale 1,
// and the model's overall size in metres.
export function modelLoaded(partList, units = {}) {
  const parts = {};
  for (const part of partList) parts[part.id] = part;
  set({
    modelStatus: 'ready',
    modelError: null,
    parts,
    metresPerSceneUnit: units.metresPerSceneUnit ?? 1,
    modelSize: units.modelSize ?? null,
  });
}

export function modelFailed(message) {
  set({ modelStatus: 'error', modelError: message });
}

// --- View toggles ----------------------------------------------------------

export const toggleMirror = () => set({ mirror: !get().mirror });
export const toggleGrayscale = () => set({ grayscale: !get().grayscale });
export const setDim = (dim) => set({ dim: clamp(dim, 0, 0.8) });
export const toggleDebug = () => set({ debug: !get().debug });

export function toggleLabels() {
  set({ labels: !get().labels });
  emit('toggleLabels', { labels: get().labels });
}

export function setMaterialMode(mode) {
  set({ materialMode: mode });
  emit('setMaterialMode', { mode });
}

export function toggleMaterialMode() {
  setMaterialMode(get().materialMode === 'hologram' ? 'original' : 'hologram');
}

// --- Performance -------------------------------------------------------------

export function suggestQuality(level) {
  set({ qualityHint: level });
}

export function dismissQualityHint() {
  set({ qualityHint: null });
}

// --- Cameras ---------------------------------------------------------------

export function setCameras(cameras, activeCameraId) {
  set({ cameras, activeCameraId });
}

export function selectCamera(cameraId) {
  set({ requestedCameraId: cameraId });
}

export function cycleCamera() {
  const { cameras, activeCameraId } = get();
  if (cameras.length < 2) return;
  const index = cameras.findIndex((c) => c.id === activeCameraId);
  selectCamera(cameras[(index + 1) % cameras.length].id);
}

// --- Per-frame -------------------------------------------------------------

// Called once per rendered frame. Integrates spin inertia.
export function tick(dt) {
  const { spinVelocity, rotation } = get();
  const [vx, vy] = spinVelocity;
  if (vx === 0 && vy === 0) return;

  const decay = Math.exp(-VIEW.spinFriction * dt);
  const nextVx = Math.abs(vx * decay) < 0.01 ? 0 : vx * decay;
  const nextVy = Math.abs(vy * decay) < 0.01 ? 0 : vy * decay;
  set({
    rotation: [rotation[0] + vx * dt, rotation[1] + vy * dt, rotation[2]],
    spinVelocity: [nextVx, nextVy],
  });
}
