import {
  CAD_AXES,
  cadTransform,
  IDENTITY,
  MATE_TYPES,
  createMate,
  describeGeometry,
  flippedRelative,
  fromCadMm,
  mateOf,
  placedBounds,
  solveAssembly,
  turned,
  wouldLoop,
} from '../cad/assembly';
import { starterDesign } from '../cad/features';
import { normaliseAppearance, surfaceOf } from '../cad/appearance';
import { stepOfAssembly } from '../cad/cadClient';
import { resolveFeatures, resolveParameters } from '../cad/parameters';
import { appearanceOf, assemblyBomCsv, buildAssemblyBom } from '../models/assemblyBom';
import { glbOf } from '../scene/exportGlb';
import { uploadFile } from './libraryActions';
import { findModelEntry } from '../models/catalog';
import { assemblyScene, contentOf, forgetContent, loadContent } from '../scene/assemblyContent';
import { useAssemblyStore } from '../store/assemblyStore';
import { useDesignStore } from '../store/designStore';
import { setWorkspace } from '../store/uiStore';
import { normaliseDesign } from './designActions';
import { fitToView, showOriginalMaterials } from './viewerActions';

const set = (partial) => useAssemblyStore.setState(partial);
const get = () => useAssemblyStore.getState();

const AUTOSAVE_KEY = 'holocad.assembly.v1';
const AUTOSAVE_DELAY_MS = 500;
const DESIGN_AUTOSAVE_KEY = 'holocad.design.v1';
const FILE_FORMAT = 'holocad-assembly';
const COALESCE_MS = 1200;
const SPACING = 0.15; // gap between new parts laid side by side, as a share of their size

let autosaveTimer = null;
let nextId = 1;
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(nextId++).toString(36)}`;

// ---- the assembly as data ------------------------------------------------------------

const snapshot = () => {
  const { name, components, mates } = get();
  return { name, components, mates };
};

const isNumberList = (value, length) =>
  Array.isArray(value) && value.length === length && value.every((v) => typeof v === 'number' && Number.isFinite(v));

const isGeometry = (g) =>
  g &&
  ((g.type === 'plane' && isNumberList(g.point, 3) && isNumberList(g.normal, 3)) ||
    (g.type === 'cylinder' && isNumberList(g.point, 3) && isNumberList(g.axis, 3) && Number.isFinite(g.radius)));

// Brings an assembly from a file or storage into shape: valid parts, mates between parts
// that exist, numbers where numbers belong.
export function normaliseAssembly(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Not a HoloCAD assembly');
  const components = (Array.isArray(raw.components) ? raw.components : []).flatMap((c) => {
    if (!c || typeof c !== 'object') return [];
    let source;
    if (c.source?.kind === 'design') {
      try {
        source = { kind: 'design', design: normaliseDesign(c.source.design) };
      } catch {
        return [];
      }
    } else if (c.source?.kind === 'model' && typeof c.source.modelId === 'string') {
      source = { kind: 'model', modelId: c.source.modelId };
    } else return [];
    const appearance = c.appearance ? normaliseAppearance(c.appearance, { allowNoMaterial: source.kind === 'model' }) : null;
    return [
      {
        id: typeof c.id === 'string' ? c.id : newId('part'),
        name: typeof c.name === 'string' && c.name.trim() ? c.name.slice(0, 80) : 'Part',
        source,
        position: isNumberList(c.position, 3) ? c.position : [0, 0, 0],
        quaternion: isNumberList(c.quaternion, 4) ? c.quaternion : [0, 0, 0, 1],
        ...(appearance ? { appearance } : {}),
      },
    ];
  });
  const ids = new Set(components.map((c) => c.id));
  const mates = (Array.isArray(raw.mates) ? raw.mates : []).filter(
    (m) =>
      m &&
      MATE_TYPES[m.type] &&
      ids.has(m.moving?.componentId) &&
      ids.has(m.target?.componentId) &&
      isGeometry(m.moving.geometry) &&
      isGeometry(m.target.geometry) &&
      isNumberList(m.relative, 4),
  ).map((m) => ({
    id: typeof m.id === 'string' ? m.id : newId('mate'),
    type: m.type,
    moving: { componentId: m.moving.componentId, geometry: m.moving.geometry, label: String(m.moving.label ?? '') },
    target: { componentId: m.target.componentId, geometry: m.target.geometry, label: String(m.target.label ?? '') },
    relative: m.relative,
    slide: m.type === 'contact' ? (isNumberList(m.slide, 2) ? m.slide : [0, 0]) : Number.isFinite(m.slide) ? m.slide : 0,
    gap: Number.isFinite(m.gap) ? m.gap : 0,
    angle: Number.isFinite(m.angle) ? m.angle : 0,
  }));
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 80) : 'Untitled assembly';
  return { name, components, mates };
}

// ---- undo / redo ---------------------------------------------------------------------

const past = [];
const future = [];
let lastEdit = { key: null, at: 0 };
let gestureKey = null;
let gestureLabel = null;

function publishHistory() {
  set({ undoLabel: past.at(-1)?.label ?? null, redoLabel: future.at(-1)?.label ?? null });
}

function change(label, apply, { coalesceKey = null } = {}) {
  const now = performance.now();
  const key = gestureKey ?? coalesceKey;
  const merge = key && lastEdit.key === key && (gestureKey !== null || now - lastEdit.at < COALESCE_MS);
  if (!merge) {
    past.push({ label: gestureLabel ?? label, assembly: snapshot() });
    if (past.length > 200) past.shift();
  }
  future.length = 0;
  lastEdit = { key, at: now };
  set(apply(get()));
  publishHistory();
  afterChange();
}

function restore(assembly) {
  const { selectedComponentId } = get();
  set({
    ...assembly,
    selectedComponentId: assembly.components.some((c) => c.id === selectedComponentId) ? selectedComponentId : null,
    pick: null,
  });
  lastEdit = { key: null, at: 0 };
  publishHistory();
  afterChange();
}

export function undoAssembly() {
  const step = past.pop();
  if (!step) return false;
  future.push({ label: step.label, assembly: snapshot() });
  restore(step.assembly);
  return true;
}

export function redoAssembly() {
  const step = future.pop();
  if (!step) return false;
  past.push({ label: step.label, assembly: snapshot() });
  restore(step.assembly);
  return true;
}

// A drag is one undo step: begin before its first change, end after its last.
export function beginAssemblyGesture(key, label) {
  lastEdit = { key: null, at: 0 };
  gestureKey = `gesture:${key}`;
  gestureLabel = label;
}

export function endAssemblyGesture() {
  gestureKey = null;
  gestureLabel = null;
  lastEdit = { key: null, at: 0 };
}

function afterChange() {
  solve();
  ensureContent();
  scheduleAutosave();
}

function solve() {
  const { components, mates } = get();
  set({ placements: solveAssembly(components, mates) });
}

// ---- geometry for each part ----------------------------------------------------------

function ensureContent() {
  const { components, content } = get();
  const live = new Set(components.map((c) => c.id));
  const kept = Object.fromEntries(Object.entries(content).filter(([id]) => live.has(id)));
  for (const id of Object.keys(content)) if (!live.has(id)) forgetContent(id);
  set({ content: kept });
  for (const component of components) {
    if (kept[component.id]) continue;
    set({ content: { ...get().content, [component.id]: { status: 'loading', error: null } } });
    loadContent(component)
      .then(({ box, info }) => {
        if (!get().components.some((c) => c.id === component.id)) return;
        set({
          content: { ...get().content, [component.id]: { status: 'ready', error: null, info } },
          contentVersion: get().contentVersion + 1,
        });
        if (component.autoPlace) placeBesideOthers(component.id, box);
        // Frame the view once everything has arrived (a new part may be much bigger).
        const stillLoading = Object.values(get().content).some((c) => c.status === 'loading');
        if (!stillLoading && (component.autoPlace || !get().frame)) refitAssembly();
      })
      .catch((error) => {
        set({ content: { ...get().content, [component.id]: { status: 'error', error: error.message } } });
      });
  }
}

// A new part goes to the right of everything already there, standing on the same floor.
function placeBesideOthers(componentId, box) {
  const { components, placements } = get();
  const others = components.filter((c) => c.id !== componentId && contentOf(c.id) && get().content[c.id]?.status === 'ready');
  const width = box.max[0] - box.min[0];
  let position = [-(box.min[0] + box.max[0]) / 2, -box.min[1], -(box.min[2] + box.max[2]) / 2];
  if (others.length) {
    const all = others.map((c) => placedBounds(contentOf(c.id).box, placements[c.id] ?? IDENTITY));
    const maxX = Math.max(...all.map((b) => b.max[0]));
    const floor = Math.min(...all.map((b) => b.min[1]));
    const size = Math.max(width, ...all.map((b) => b.max[0] - b.min[0]));
    position = [maxX + size * SPACING - box.min[0], floor - box.min[1], -(box.min[2] + box.max[2]) / 2];
  }
  const round = (v) => Number(v.toFixed(6));
  // Not an undo step of its own: it finishes adding the part.
  set({
    components: get().components.map((c) =>
      c.id === componentId ? { ...c, position: position.map(round), quaternion: [0, 0, 0, 1], autoPlace: undefined } : c,
    ),
  });
  solve();
  scheduleAutosave();
}

// ---- workspace -----------------------------------------------------------------------

function loadAutosaved() {
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    return saved ? normaliseAssembly(JSON.parse(saved)) : null;
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
      // Not kept between visits; fine.
    }
  }, AUTOSAVE_DELAY_MS);
}

export function openAssembly() {
  setWorkspace('assemble');
  if (!get().components.length) {
    const saved = loadAutosaved();
    if (saved?.components.length) set({ ...saved, frame: null });
  }
  solve();
  ensureContent();
}

export function closeAssembly() {
  setTool(null);
  setWorkspace('view');
}

export function newAssembly() {
  change('New assembly', () => ({ name: 'Untitled assembly', components: [], mates: [], selectedComponentId: null, message: null }));
  set({ frame: null, tool: null, pick: null });
}

export function renameAssembly(name) {
  change('Rename', () => ({ name: name.slice(0, 80) }), { coalesceKey: 'name' });
}

// ---- parts ---------------------------------------------------------------------------

function uniqueName(base) {
  const taken = new Set(get().components.map((c) => c.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

function addComponent(name, source) {
  const component = { id: newId('part'), name: uniqueName(name), source, position: [0, 0, 0], quaternion: [0, 0, 0, 1], autoPlace: true };
  change(`Add ${component.name}`, ({ components }) => ({
    components: [...components, component],
    selectedComponentId: component.id,
    message: null,
  }));
  return component.id;
}

function currentDesign() {
  const { name, features, parameters } = useDesignStore.getState();
  if (features.length) return { name, features, parameters };
  try {
    const saved = localStorage.getItem(DESIGN_AUTOSAVE_KEY);
    if (saved) return normaliseDesign(JSON.parse(saved));
  } catch {
    // fall through to the starter part
  }
  return starterDesign();
}

// A copy of the part in DESIGN as it is now (later edits there don't change it here).
export function addDesignPart(design = currentDesign()) {
  const copy = normaliseDesign(design);
  return addComponent(copy.name, { kind: 'design', design: copy });
}

export function addModelPart(modelId) {
  const entry = findModelEntry(modelId);
  if (!entry) return null;
  return addComponent(entry.label ?? entry.name ?? 'Model', { kind: 'model', modelId });
}

export async function addDesignFilePart(file) {
  try {
    const raw = JSON.parse(await file.text());
    if (raw.format !== 'holocad-design') throw new Error('Not a HoloCAD design file');
    return addDesignPart(raw);
  } catch (error) {
    set({ message: `Couldn't add ${file.name}: ${error.message}` });
    return null;
  }
}

const componentOf = (id) => get().components.find((c) => c.id === id) ?? null;

// Where a part is now, made its own: used when its mate goes away, so it stays put.
function bake(components, ids) {
  const { placements } = get();
  return components.map((c) => (ids.includes(c.id) && placements[c.id] ? { ...c, ...placements[c.id] } : c));
}

export function removeComponent(id) {
  const component = componentOf(id);
  if (!component) return;
  change(`Delete ${component.name}`, ({ components, mates, selectedComponentId }) => {
    const orphans = mates.filter((m) => m.target.componentId === id).map((m) => m.moving.componentId);
    return {
      components: bake(components, orphans).filter((c) => c.id !== id),
      mates: mates.filter((m) => m.moving.componentId !== id && m.target.componentId !== id),
      selectedComponentId: selectedComponentId === id ? null : selectedComponentId,
    };
  });
  if (get().pick?.componentId === id) set({ pick: null });
}

export function duplicateComponent(id) {
  const component = componentOf(id);
  if (!component) return null;
  return addComponent(component.name.replace(/ \d+$/, ''), component.source);
}

export function renameComponent(id, name) {
  if (!name.trim()) return;
  change(
    'Rename part',
    ({ components }) => ({ components: components.map((c) => (c.id === id ? { ...c, name: name.slice(0, 80) } : c)) }),
    { coalesceKey: `${id}.name` },
  );
}

export function selectComponent(id) {
  set({ selectedComponentId: id && componentOf(id) ? id : null });
}

// position: metres in the assembly frame. Only free parts (a mated part goes where its
// mate puts it).
export function moveComponentTo(id, position, { label = 'Move part', coalesceKey = `${id}.position` } = {}) {
  const component = componentOf(id);
  if (!component || mateOf(get().mates, id)) return;
  change(label, ({ components }) => ({ components: components.map((c) => (c.id === id ? { ...c, position } : c)) }), {
    coalesceKey,
  });
}

// The panel's fields: CAD millimetres (Z up).
export function setComponentPositionMm(id, cadMm) {
  moveComponentTo(id, fromCadMm(cadMm), { label: 'Move part' });
}

// Turn a part a step: a free one about a CAD axis, a mated one about its mate.
export function turnComponent(id, axis, degrees) {
  const component = componentOf(id);
  if (!component) return;
  const mate = mateOf(get().mates, id);
  if (mate) {
    setMateValue(mate.id, 'angle', (((mate.angle + degrees) % 360) + 360) % 360);
    return;
  }
  const placement = turned(get().placements[id] ?? component, CAD_AXES[axis], degrees);
  change(`Turn ${component.name}`, ({ components }) => ({
    components: components.map((c) => (c.id === id ? { ...c, ...placement } : c)),
  }));
}

// A part's look. Designed part: material (and so its mass), colour, finish. Model: paint
// (colour, finish) over its CAD file's own look, or null to take the paint off.
export function setComponentAppearance(id, patch) {
  const component = componentOf(id);
  if (!component) return;
  const model = component.source.kind === 'model';
  const next =
    patch === null
      ? null
      : normaliseAppearance({ ...(appearanceOf(component) ?? {}), ...patch }, { allowNoMaterial: model });
  const field = patch ? Object.keys(patch)[0] : 'paint';
  const label = { materialId: 'Change material', color: 'Change colour', finish: 'Change finish' }[field] ?? 'Change look';
  change(
    `${label} of ${component.name}`,
    ({ components }) => ({
      components: components.map((c) => {
        if (c.id !== id) return c;
        const { appearance: _old, ...rest } = c;
        return next ? { ...rest, appearance: next } : rest;
      }),
    }),
    { coalesceKey: `${id}.appearance.${field}` },
  );
  showOriginalMaterials();
}

// ---- mates ---------------------------------------------------------------------------

export function setTool(tool) {
  set({ tool: MATE_TYPES[tool] ? tool : null, pick: null, hoverFace: null, message: null });
}

export function setHoverFace(face) {
  const current = get().hoverFace;
  if (current === face) return;
  if (current && face && current.componentId === face.componentId && current.key === face.key) return;
  set({ hoverFace: face });
}

const nameOf = (id) => componentOf(id)?.name ?? 'part';

// A face clicked while a mate tool is on: the first is the part that moves, the second the
// part it attaches to. face: { componentId, geometry, label, key, highlight } or null.
export function pickFace(face) {
  const { tool, pick, mates } = get();
  if (!tool) return;
  const needs = MATE_TYPES[tool].needs;
  if (!face) {
    set({ message: pick ? 'Now click a face on the part to attach it to' : 'Click a face on the part to move' });
    return;
  }
  if (face.geometry?.type !== needs) {
    set({ message: `That's a ${describeGeometry(face.geometry)}. ${MATE_TYPES[tool].hint}.` });
    return;
  }
  if (!pick) {
    set({ pick: face, selectedComponentId: face.componentId, message: `Now click a face on the part to attach ${nameOf(face.componentId)} to` });
    return;
  }
  if (face.componentId === pick.componentId) {
    set({ pick: face, message: `Now click a face on the part to attach ${nameOf(face.componentId)} to` });
    return;
  }
  if (wouldLoop(mates, pick.componentId, face.componentId)) {
    set({ message: `${nameOf(face.componentId)} is already attached to ${nameOf(pick.componentId)}: attach it the other way round` });
    return;
  }
  let mate;
  try {
    mate = createMate(tool, pick, face, get().placements, newId('mate'));
  } catch (error) {
    set({ message: error.message });
    return;
  }
  const moving = pick.componentId;
  change(`Mate ${nameOf(moving)} to ${nameOf(face.componentId)}`, ({ mates: list }) => ({
    // One mate per moving part: a new one replaces the old.
    mates: [...list.filter((m) => m.moving.componentId !== moving), mate],
    selectedComponentId: moving,
  }));
  set({ tool: null, pick: null, hoverFace: null, message: `${nameOf(moving)} ${MATE_TYPES[tool].label.toLowerCase()} on ${nameOf(face.componentId)}` });
}

export function removeMate(mateId) {
  const mate = get().mates.find((m) => m.id === mateId);
  if (!mate) return;
  change(`Unmate ${nameOf(mate.moving.componentId)}`, ({ components, mates }) => ({
    components: bake(components, [mate.moving.componentId]),
    mates: mates.filter((m) => m.id !== mateId),
  }));
}

export function flipMate(mateId) {
  const mate = get().mates.find((m) => m.id === mateId);
  if (!mate) return;
  change(`Flip ${nameOf(mate.moving.componentId)}`, ({ mates }) => ({
    mates: mates.map((m) => (m.id === mateId ? { ...m, relative: flippedRelative(m) } : m)),
  }));
}

const MATE_FIELDS = { gap: 'Gap', angle: 'Angle', slide: 'Slide', slideU: 'Slide', slideV: 'Slide' };

// key: 'gap' | 'angle' | 'slide' (on axis) | 'slideU' / 'slideV' (face to face: across the face).
export function setMateValue(mateId, key, value, { coalesceKey = `${mateId}.${key}` } = {}) {
  const mate = get().mates.find((m) => m.id === mateId);
  const number = Number(value);
  if (!mate || !MATE_FIELDS[key] || !Number.isFinite(number)) return;
  if (key === 'slide' && mate.type === 'contact') return;
  const patch =
    key === 'slideU' ? { slide: [number, mate.slide[1]] } : key === 'slideV' ? { slide: [mate.slide[0], number] } : { [key]: number };
  change(
    `${MATE_FIELDS[key]} ${nameOf(mate.moving.componentId)}`,
    ({ mates }) => ({ mates: mates.map((m) => (m.id === mateId ? { ...m, ...patch } : m)) }),
    { coalesceKey },
  );
}

// Where dragging slid a mated part to: [u, v] mm (face to face) or mm (on axis).
export function setMateSlide(mateId, slide) {
  const mate = get().mates.find((m) => m.id === mateId);
  if (!mate || Array.isArray(slide) !== (mate.type === 'contact')) return;
  change(
    `Slide ${nameOf(mate.moving.componentId)}`,
    ({ mates }) => ({ mates: mates.map((m) => (m.id === mateId ? { ...m, slide } : m)) }),
    { coalesceKey: `${mateId}.slide` },
  );
}

// ---- framing -------------------------------------------------------------------------

// The view's framing for the assembly as it is now (metres), then fit it on screen.
export function refitAssembly() {
  const { components, placements } = get();
  const boxes = components
    .filter((c) => contentOf(c.id))
    .map((c) => placedBounds(contentOf(c.id).box, placements[c.id] ?? IDENTITY));
  if (!boxes.length) {
    set({ frame: null });
    return;
  }
  const min = [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b.min[k])));
  const max = [0, 1, 2].map((k) => Math.max(...boxes.map((b) => b.max[k])));
  const center = min.map((v, k) => (v + max[k]) / 2);
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 0.001;
  set({ frame: { center, radius } });
  fitToView();
}

// ---- files ---------------------------------------------------------------------------

function fileName(extension = 'holocad-assembly.json') {
  const base = get().name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'assembly';
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

export function saveAssemblyFile() {
  const name = fileName();
  const json = JSON.stringify({ format: FILE_FORMAT, version: 1, ...snapshot() }, null, 2);
  download(new Blob([json], { type: 'application/json' }), name);
  set({ message: `Saved ${name}` });
  return name;
}

// ---- exports -------------------------------------------------------------------------

const readyComponents = () => get().components.filter((c) => get().content[c.id]?.status === 'ready');

export function currentAssemblyBom() {
  const { components, content } = get();
  const info = Object.fromEntries(Object.entries(content).map(([id, c]) => [id, c.info]));
  return buildAssemblyBom(components, info);
}

export function exportAssemblyBomCsv() {
  const name = fileName('BOM.csv');
  download(new Blob([assemblyBomCsv(currentAssemblyBom())], { type: 'text/csv;charset=utf-8' }), name);
  set({ message: `Saved ${name}` });
  return name;
}

async function assemblyGlb() {
  const parts = readyComponents();
  if (!parts.length) throw new Error('No parts to export yet');
  return glbOf(assemblyScene(parts, get().placements, get().name));
}

// Everything (designed parts and models), placed and coloured, as one .glb: opens in
// Blender, three.js, Windows 3D Viewer, game engines, AR viewers…
export async function exportAssemblyGlb() {
  set({ saving: 'glb', message: null });
  try {
    const name = fileName('glb');
    download(await assemblyGlb(), name);
    set({ message: `Saved ${name}` });
  } catch (error) {
    set({ message: `Couldn't export: ${error.message}` });
  } finally {
    set({ saving: null });
  }
}

// Designed parts as one STEP assembly (each named, coloured and placed) for any CAD
// program. Models are meshes here, not CAD solids, so they're left out (and named).
export async function exportAssemblyStep() {
  set({ saving: 'step', message: null });
  try {
    const { placements } = get();
    const designed = get().components.filter((c) => c.source.kind === 'design');
    const models = get().components.filter((c) => c.source.kind === 'model');
    if (!designed.length) throw new Error('STEP holds designed parts; this assembly has none');
    const parts = designed.map((c) => {
      const { values } = resolveParameters(c.source.design.parameters);
      const { features } = resolveFeatures(c.source.design.features, values);
      return { name: c.name, color: surfaceOf(appearanceOf(c)).color, features, ...cadTransform(placements[c.id] ?? c) };
    });
    const { blob, skipped } = await stepOfAssembly(parts);
    const name = fileName('step');
    download(blob, name);
    const notes = [];
    if (models.length) notes.push(`left out ${models.map((c) => c.name).join(', ')} (models: use EXPORT GLB)`);
    if (skipped.length) notes.push(`couldn't build ${skipped.join(', ')}`);
    set({ message: `Saved ${name}${notes.length ? `; ${notes.join('; ')}` : ''}` });
  } catch (error) {
    set({ message: `Couldn't export STEP: ${error.message}` });
  } finally {
    set({ saving: null });
  }
}

// The whole assembly into the LIBRARY (as a .glb): open it in the viewer like any model,
// explode it, measure it, show it to someone.
export async function saveAssemblyToLibrary() {
  set({ saving: 'library', message: null });
  try {
    const file = new File([await assemblyGlb()], fileName('glb'), { type: 'model/gltf-binary' });
    const model = await uploadFile(file);
    set({ message: model ? `Sent to the library as ${model.name}` : 'Upload failed (see LIBRARY)' });
  } catch (error) {
    set({ message: `Couldn't save: ${error.message}` });
  } finally {
    set({ saving: null });
  }
}

export async function openAssemblyFile(file) {
  try {
    const raw = JSON.parse(await file.text());
    if (raw.format !== FILE_FORMAT) throw new Error('Not a HoloCAD assembly file');
    const assembly = normaliseAssembly(raw);
    change(`Open ${assembly.name}`, () => ({ ...assembly, selectedComponentId: null, message: `Opened ${file.name}` }));
    set({ frame: null, tool: null, pick: null });
  } catch (error) {
    set({ message: `Couldn't open ${file.name}: ${error.message}` });
  }
}
