import { MATERIAL_LIBRARY } from '../config';
import { findModelEntry } from '../models/catalog';
import { useSpecStore } from '../store/specStore';
import { useViewerStore } from '../store/viewerStore';

const set = (partial) => useSpecStore.setState(partial);
const get = () => useSpecStore.getState();

let loadToken = 0;
let facesToken = 0;

const NO_FACES = { facesModelId: null, facesStatus: 'none', faces: null, hover: null, pinned: null };

// Where a model's specs live: next to a bundled sample, or in the API for uploads.
export function specsUrl(entry) {
  if (!entry) return null;
  if (entry.source === 'sample') return entry.specsUrl ?? null;
  return `/api/models/${entry.id}/specs`;
}

export async function loadSpecs(modelId, { fetchImpl = fetch } = {}) {
  const token = ++loadToken;
  const url = specsUrl(findModelEntry(modelId));
  if (!url) {
    set({ modelId, status: 'unavailable', error: null, units: null, specs: [], materialPicks: {}, ...NO_FACES });
    return;
  }
  set({ modelId, status: 'loading', error: null, units: null, specs: [], materialPicks: {}, ...NO_FACES });
  try {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (token !== loadToken) return; // another model was opened meanwhile
    const specs = [];
    for (const part of body.parts ?? []) specs[part.index] = part.spec ?? null;
    set({ status: specs.some(Boolean) ? 'ready' : 'unavailable', units: body.units ?? null, specs });
  } catch (error) {
    if (token !== loadToken) return;
    set({ status: 'error', error: `Couldn't load part specs (${error.message})` });
  }
}

export function specForPart(partId) {
  const part = useViewerStore.getState().parts[partId];
  if (!part || part.specIndex === null || part.specIndex === undefined) return null;
  return get().specs[part.specIndex] ?? null;
}

// materialId: an id from MATERIAL_LIBRARY, or null to go back to the CAD file's material.
export function pickMaterial(key, materialId) {
  const picks = { ...get().materialPicks };
  const material = MATERIAL_LIBRARY.find((m) => m.id === materialId);
  if (material) picks[key] = material;
  else delete picks[key];
  set({ materialPicks: picks });
}

export function facesUrl(entry) {
  if (!entry) return null;
  if (entry.source === 'sample') return entry.facesUrl ?? null;
  return `/api/models/${entry.id}/faces`;
}

// Face/edge data is bigger than the specs and only the inspector needs it: load on demand.
export async function loadFaces(modelId, { fetchImpl = fetch } = {}) {
  if (get().facesModelId === modelId && get().facesStatus !== 'error') return;
  const token = ++facesToken;
  const url = facesUrl(findModelEntry(modelId));
  if (!url) {
    set({ ...NO_FACES, facesModelId: modelId, facesStatus: 'unavailable' });
    return;
  }
  set({ ...NO_FACES, facesModelId: modelId, facesStatus: 'loading' });
  try {
    const res = await fetchImpl(url);
    if (token !== facesToken) return;
    if (res.status === 404) {
      set({ facesStatus: 'unavailable' });
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const faces = await res.json();
    if (token !== facesToken) return;
    set({ facesStatus: 'ready', faces });
  } catch {
    if (token === facesToken) set({ facesStatus: 'error' });
  }
}

const sameItem = (a, b) =>
  a === b || (a && b && a.partId === b.partId && a.kind === b.kind && a.index === b.index && a.x === b.x && a.y === b.y);

// item: { partId, specIndex, kind, index } plus the cursor's x, y; or null.
export function setInspectHover(item) {
  if (!sameItem(get().hover, item)) set({ hover: item });
}

export function pinInspected(item) {
  set({ pinned: item ? { ...item } : null });
}
