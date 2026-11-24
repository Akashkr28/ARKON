import { buildInWorker, stepOfCurrentPart, whenKernelReady } from '../cad/cadClient';
import { FEATURE_TYPES, clampParam, makeFeature, newFeatureId, starterDesign } from '../cad/features';
import { isFormula, makeParameter, resolveFeatures, resolveParameters } from '../cad/parameters';
import { isValidName } from '../cad/expressions';
import { DEFAULT_APPEARANCE, normaliseAppearance } from '../cad/appearance';
import { useDesignStore } from '../store/designStore';
import { setWorkspace } from '../store/uiStore';
import { uploadFile } from './libraryActions';
import { designObject } from '../scene/designObject';
import { applyAppearance } from '../scene/applyAppearance';
import { glbOf } from '../scene/exportGlb';
import { fitToView, showOriginalMaterials } from './viewerActions';

const set = (partial) => useDesignStore.setState(partial);
const get = () => useDesignStore.getState();

const REBUILD_DELAY_MS = 120; // typing "120" rebuilds once, not three times
const AUTOSAVE_KEY = 'holocad.design.v1';
const AUTOSAVE_DELAY_MS = 500;
const FILE_FORMAT = 'holocad-design';
// Edits of the same field this close together are one undo step (typing "120").
const COALESCE_MS = 1200;

let rebuildTimer = null;
let autosaveTimer = null;
let latestBuild = 0;

// ---- the design as data --------------------------------------------------------------

const snapshot = () => {
  const { name, features, parameters, appearance } = get();
  return { name, features, parameters, appearance };
};

// Brings a design from a file or storage into shape: known feature types and parameters
// only, every value checked against its limits, ids present.
export function normaliseDesign(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Not a HoloCAD design');
  const parameters = (Array.isArray(raw.parameters) ? raw.parameters : [])
    .filter((p) => p && typeof p.name === 'string' && p.expression !== undefined)
    .map((p) => ({
      id: typeof p.id === 'string' ? p.id : makeParameter('', '').id,
      name: p.name,
      expression: String(p.expression),
    }));
  const features = (Array.isArray(raw.features) ? raw.features : [])
    .filter((f) => f && FEATURE_TYPES[f.type])
    .map((f) => {
      const params = {};
      for (const spec of FEATURE_TYPES[f.type].params) {
        const value = f.params?.[spec.key];
        if (isFormula(value) && spec.kind !== 'choice') params[spec.key] = { expr: String(value.expr) };
        else params[spec.key] = value === undefined ? spec.value : clampParam(f.type, spec.key, value);
      }
      return {
        id: typeof f.id === 'string' ? f.id : newFeatureId(),
        type: f.type,
        enabled: f.enabled !== false,
        params,
      };
    });
  if (!features.length) throw new Error('The design has no features');
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 80) : 'Untitled part',
    features,
    parameters,
    appearance: normaliseAppearance(raw.appearance),
  };
}

// ---- undo / redo ---------------------------------------------------------------------

const past = []; // { label, design }
const future = [];
let lastEdit = { key: null, at: 0 };
let gestureKey = null; // set while a handle is being dragged
let gestureLabel = null;

function publishHistory() {
  set({ undoLabel: past.at(-1)?.label ?? null, redoLabel: future.at(-1)?.label ?? null });
}

// Make a change as one undoable step. `coalesceKey`: repeated edits of the same thing in
// quick succession (keystrokes in one field) merge into the step already recorded.
function change(label, apply, { coalesceKey = null, rebuildNow = false, noRebuild = false } = {}) {
  const now = performance.now();
  // During a drag everything it changes is one step, however long it takes.
  const key = gestureKey ?? coalesceKey;
  const merge = key && lastEdit.key === key && (gestureKey !== null || now - lastEdit.at < COALESCE_MS);
  if (!merge) {
    past.push({ label: gestureLabel ?? label, design: snapshot() });
    if (past.length > 200) past.shift();
  }
  future.length = 0;
  lastEdit = { key, at: now };
  set(apply(get()));
  publishHistory();
  if (noRebuild) scheduleAutosave();
  else afterChange(rebuildNow);
}

function restore(design) {
  const { selectedFeatureId } = get();
  set({
    ...design,
    selectedFeatureId: design.features.some((f) => f.id === selectedFeatureId) ? selectedFeatureId : null,
  });
  lastEdit = { key: null, at: 0 };
  publishHistory();
  afterChange(true);
}

export function undoDesign() {
  const step = past.pop();
  if (!step) return false;
  future.push({ label: step.label, design: snapshot() });
  restore(step.design);
  return true;
}

export function redoDesign() {
  const step = future.pop();
  if (!step) return false;
  past.push({ label: step.label, design: snapshot() });
  restore(step.design);
  return true;
}

function afterChange(rebuildNow) {
  if (rebuildNow) rebuild();
  else scheduleRebuild();
  scheduleAutosave();
}

// ---- workspace -----------------------------------------------------------------------

function loadAutosaved() {
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    return saved ? normaliseDesign(JSON.parse(saved)) : null;
  } catch {
    return null;
  }
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ format: FILE_FORMAT, version: 1, ...snapshot() }));
    } catch {
      // Private window or full storage: the design just isn't kept between visits.
    }
  }, AUTOSAVE_DELAY_MS);
}

export function openDesign() {
  setWorkspace('design');
  if (get().kernel === 'off') {
    set({ kernel: 'loading' });
    whenKernelReady(() => set({ kernel: 'ready' }));
  }
  if (!get().features.length) {
    const design = loadAutosaved() ?? starterDesign();
    set({ ...design, selectedFeatureId: design.features[0].id, frame: null });
  }
  rebuild({ fit: !get().frame });
}

export function closeDesign() {
  setWorkspace('view');
}

export function newDesign(baseType = 'box') {
  const base = makeFeature(baseType);
  change(
    'New part',
    () => ({
      name: 'Untitled part',
      features: [base],
      parameters: [],
      appearance: { ...DEFAULT_APPEARANCE },
      selectedFeatureId: base.id,
      message: null,
    }),
    {
      rebuildNow: true,
    },
  );
  set({ frame: null });
  rebuild({ fit: true });
}

export function renameDesign(name) {
  change('Rename', () => ({ name: name.slice(0, 80) }), { coalesceKey: 'name' });
}

// What the part is made of and how it looks: { materialId, color (null: the material's),
// finish }. Changes how it's drawn and its mass, not its shape (no rebuild).
export function setDesignAppearance(patch) {
  const next = normaliseAppearance({ ...get().appearance, ...patch });
  const field = Object.keys(patch)[0] ?? 'appearance';
  const label =
    { materialId: 'Change material', color: 'Change colour', finish: 'Change finish' }[field] ?? 'Change look';
  change(label, () => ({ appearance: next }), { coalesceKey: `appearance.${field}`, noRebuild: true });
  showOriginalMaterials();
}

// ---- features ------------------------------------------------------------------------

const labelOf = (type) => FEATURE_TYPES[type]?.label ?? type;

export function addFeature(type) {
  if (!FEATURE_TYPES[type]) return null;
  const feature = makeFeature(type);
  change(`Add ${labelOf(type)}`, ({ features }) => ({
    // A base shape replaces the existing base (first in the list); operations go last.
    features: FEATURE_TYPES[type].base
      ? [feature, ...features.filter((f) => !FEATURE_TYPES[f.type].base)]
      : [...features, feature],
    selectedFeatureId: feature.id,
  }));
  return feature.id;
}

export function removeFeature(id) {
  const feature = get().features.find((f) => f.id === id);
  if (!feature) return;
  change(`Delete ${labelOf(feature.type)}`, ({ features, selectedFeatureId }) => ({
    features: features.filter((f) => f.id !== id),
    selectedFeatureId: selectedFeatureId === id ? null : selectedFeatureId,
  }));
}

// Operations can move up and down among themselves; the base stays first.
export function moveFeature(id, direction) {
  const features = [...get().features];
  const i = features.findIndex((f) => f.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= features.length) return;
  if (FEATURE_TYPES[features[i].type].base || FEATURE_TYPES[features[j].type].base) return;
  [features[i], features[j]] = [features[j], features[i]];
  change(`Move ${labelOf(features[j].type)}`, () => ({ features }));
}

export function toggleFeature(id) {
  const feature = get().features.find((f) => f.id === id);
  if (!feature) return;
  change(`${feature.enabled ? 'Suppress' : 'Restore'} ${labelOf(feature.type)}`, ({ features }) => ({
    features: features.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f)),
  }));
}

export function selectFeature(id) {
  set({ selectedFeatureId: id });
}

// value: a number, a choice, or a formula { expr }.
export function setFeatureParam(id, key, value) {
  const feature = get().features.find((f) => f.id === id);
  if (!feature) return;
  const spec = FEATURE_TYPES[feature.type].params.find((p) => p.key === key);
  const next =
    isFormula(value) && spec?.kind !== 'choice' ? { expr: value.expr } : clampParam(feature.type, key, value);
  change(
    `Change ${spec?.label ?? key}`,
    ({ features }) => ({
      features: features.map((f) => (f.id === id ? { ...f, params: { ...f.params, [key]: next } } : f)),
    }),
    { coalesceKey: `${id}.${key}` },
  );
}

// ---- parameters ----------------------------------------------------------------------

export function addParameter() {
  const taken = new Set(get().parameters.map((p) => p.name));
  let n = 1;
  while (taken.has(`p${n}`)) n += 1;
  const parameter = makeParameter(`p${n}`, '10');
  change('Add parameter', ({ parameters }) => ({ parameters: [...parameters, parameter] }));
  return parameter.id;
}

export function removeParameter(id) {
  change('Delete parameter', ({ parameters }) => ({ parameters: parameters.filter((p) => p.id !== id) }));
}

export function setParameterExpression(id, expression) {
  change(
    'Change parameter',
    ({ parameters }) => ({
      parameters: parameters.map((p) => (p.id === id ? { ...p, expression: String(expression) } : p)),
    }),
    { coalesceKey: `${id}.expression` },
  );
}

// Renaming a parameter renames it in every formula that uses it.
export function renameParameter(id, name) {
  const parameter = get().parameters.find((p) => p.id === id);
  if (!parameter) return;
  const old = parameter.name;
  const rename = (text) =>
    isValidName(old) && isValidName(name) ? text.replace(new RegExp(`\\b${old}\\b`, 'g'), name) : text;
  change(
    'Rename parameter',
    ({ parameters, features }) => ({
      parameters: parameters.map((p) => (p.id === id ? { ...p, name } : { ...p, expression: rename(p.expression) })),
      features: features.map((f) => ({
        ...f,
        params: Object.fromEntries(
          Object.entries(f.params).map(([k, v]) => [k, isFormula(v) ? { expr: rename(v.expr) } : v]),
        ),
      })),
    }),
    { coalesceKey: `${id}.name` },
  );
}

// ---- building ------------------------------------------------------------------------

function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => rebuild(), REBUILD_DELAY_MS);
}

// The part's bounding sphere in the viewer's frame (metres).
function frameOf(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }
  const center = min.map((v, k) => (v + max[k]) / 2);
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
  return { center, radius: radius || 0.001 };
}

export async function rebuild({ fit = false } = {}) {
  clearTimeout(rebuildTimer);
  const build = ++latestBuild;
  // Formulas first: the worker only ever sees numbers.
  const { values, errors: parameterErrors } = resolveParameters(get().parameters);
  const { features, errors: formulaErrors } = resolveFeatures(get().features, values);
  set({ status: 'building', error: null, values, parameterErrors, resolvedFeatures: features });
  try {
    const { part, errors } = await buildInWorker(features);
    if (build !== latestBuild) return; // a newer edit is already building
    const frame = part && (fit || !get().frame) ? frameOf(part.positions) : get().frame;
    set({
      part,
      errors: { ...errors, ...formulaErrors },
      status: 'ready',
      partVersion: get().partVersion + 1,
      frame,
    });
    if (part && fit) fitToView();
  } catch (error) {
    if (build !== latestBuild) return;
    set({ status: 'error', error: error.message });
  }
}

// Re-frame the part after it has grown or shrunk a lot, then fit it on screen.
export function refitDesign() {
  const { part } = get();
  if (!part) return;
  set({ frame: frameOf(part.positions), partVersion: get().partVersion + 1 });
  fitToView();
}

// ---- files ---------------------------------------------------------------------------

function fileName(extension) {
  const base =
    get()
      .name.replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'part';
  return `${base}.${extension}`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The design itself (features, parameters, formulas), to reopen and keep editing later.
export function saveDesignFile() {
  const name = fileName('holocad.json');
  const json = JSON.stringify({ format: FILE_FORMAT, version: 1, ...snapshot() }, null, 2);
  download(new Blob([json], { type: 'application/json' }), name);
  set({ message: `Saved ${name}` });
  return name;
}

export async function openDesignFile(file) {
  try {
    const raw = JSON.parse(await file.text());
    if (raw.format !== FILE_FORMAT) throw new Error('Not a HoloCAD design file');
    const design = normaliseDesign(raw);
    change(
      `Open ${design.name}`,
      () => ({ ...design, selectedFeatureId: design.features[0].id, message: `Opened ${file.name}` }),
      {
        rebuildNow: true,
      },
    );
    set({ frame: null });
    rebuild({ fit: true });
  } catch (error) {
    set({ message: `Couldn't open ${file.name}: ${error.message}` });
  }
}

async function stepFile() {
  const blob = await stepOfCurrentPart();
  return new File([blob], fileName('step'), { type: 'application/step' });
}

// Downloads the part as STEP: opens in SolidWorks, Fusion, FreeCAD, CATIA, NX…
export async function exportDesignStep() {
  set({ saving: 'step', message: null });
  try {
    const file = await stepFile();
    download(file, file.name);
    set({ message: `Saved ${file.name}` });
  } catch (error) {
    set({ message: `Couldn't export: ${error.message}` });
  } finally {
    set({ saving: null });
  }
}

// The part as shown (its material colour and finish) as .glb, for Blender, AR, the web…
export async function exportDesignGlb() {
  const { part, name, appearance } = get();
  if (!part) return;
  set({ saving: 'glb', message: null });
  try {
    const object = designObject(part, name);
    applyAppearance(object, appearance);
    const file = fileName('glb');
    download(await glbOf(object), file);
    set({ message: `Saved ${file}` });
  } catch (error) {
    set({ message: `Couldn't export: ${error.message}` });
  } finally {
    set({ saving: null });
  }
}

// Sends the part through the normal STEP pipeline: it lands in the LIBRARY with exact
// specs, face data and a BOM, like any uploaded CAD file.
export async function saveDesignToLibrary() {
  set({ saving: 'library', message: null });
  try {
    const model = await uploadFile(await stepFile());
    set({ message: model ? `Sent to the library as ${model.name}: converting…` : 'Upload failed (see LIBRARY)' });
  } catch (error) {
    set({ message: `Couldn't save: ${error.message}` });
  } finally {
    set({ saving: null });
  }
}

// ---- shaping by hand (handles; see cad/handles.js and actions/handleDrag.js) ------------

// Sets what a handle drives: each dimension directly, or the parameter behind it.
export function applyHandleValues(handle, values) {
  for (const [key, value] of Object.entries(values)) {
    const driver = handle.drivers[key];
    if (driver.kind === 'number') setFeatureParam(handle.featureId, key, value);
    else if (driver.kind === 'parameter') setParameterExpression(driver.parameterId, String(Number(value.toFixed(4))));
  }
}

// A drag is one undo step: begin before its first change, end after its last.
export function beginDesignGesture(key, label) {
  lastEdit = { key: null, at: 0 };
  gestureKey = `gesture:${key}`;
  gestureLabel = label;
}

export function endDesignGesture() {
  gestureKey = null;
  gestureLabel = null;
  lastEdit = { key: null, at: 0 };
}
