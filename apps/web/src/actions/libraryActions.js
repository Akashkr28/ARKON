import { useLibraryStore } from '../store/libraryStore';
import { useViewerStore } from '../store/viewerStore';
import * as api from '../api/modelsApi';
import { loadModel } from './viewerActions';
import { LIBRARY, MODELS } from '../config';

// Upload, list, retry and delete models through the API. Like viewerActions,
// these are plain functions the HUD, keyboard and (later) the AI assistant share.

const get = () => useLibraryStore.getState();
const set = (partial) => useLibraryStore.setState(partial);
const isPending = (model) => model.status === 'queued' || model.status === 'converting';

let pollTimer = null;
// Models the user just uploaded: open each in the viewer as soon as it's ready.
const openWhenReady = new Set();

function replaceModel(updated) {
  const exists = get().models.some((m) => m.id === updated.id);
  set({
    models: exists
      ? get().models.map((m) => (m.id === updated.id ? updated : m))
      : [updated, ...get().models],
  });
}

function openReadyUploads() {
  for (const id of openWhenReady) {
    const model = get().models.find((m) => m.id === id);
    if (!model) openWhenReady.delete(id);
    else if (model.status === 'ready') {
      openWhenReady.delete(id);
      loadModel(id);
    } else if (model.status === 'failed') openWhenReady.delete(id);
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = get().models.some(isPending) ? setTimeout(refreshLibrary, LIBRARY.pollMs) : null;
}

export async function refreshLibrary() {
  try {
    set({ models: await api.listModels(), apiStatus: 'online' });
    openReadyUploads();
  } catch {
    set({ apiStatus: 'offline' });
  }
  schedulePoll();
}

export function setUploadQuality(quality) {
  set({ quality });
}

function hasAcceptedExtension(name) {
  const lower = name.toLowerCase();
  return LIBRARY.acceptedExtensions.some((ext) => lower.endsWith(ext));
}

export async function uploadFile(file) {
  const key = `${file.name}-${performance.now()}`;
  const updateUpload = (changes) =>
    set({ uploads: get().uploads.map((u) => (u.key === key ? { ...u, ...changes } : u)) });
  set({ uploads: [...get().uploads, { key, filename: file.name, progress: 0, error: null }] });

  if (!hasAcceptedExtension(file.name)) {
    updateUpload({ error: `Only ${LIBRARY.acceptedExtensions.join(', ')} files can be uploaded` });
    return null;
  }

  try {
    const model = await api.uploadModel(file, {
      quality: get().quality,
      onProgress: (progress) => updateUpload({ progress }),
    });
    set({ uploads: get().uploads.filter((u) => u.key !== key), apiStatus: 'online' });
    replaceModel(model);
    openWhenReady.add(model.id);
    openReadyUploads();
    schedulePoll();
    return model;
  } catch (error) {
    updateUpload({ error: error.message });
    return null;
  }
}

export function dismissUpload(key) {
  set({ uploads: get().uploads.filter((u) => u.key !== key) });
}

export async function retryConversion(id, quality) {
  try {
    replaceModel(await api.retryModel(id, quality));
    schedulePoll();
  } catch (error) {
    replaceModel({ ...get().models.find((m) => m.id === id), error: error.message });
  }
}

// First call arms the delete; a second call within a few seconds confirms it.
let disarmTimer = null;
export async function deleteLibraryModel(id) {
  if (get().pendingDeleteId !== id) {
    set({ pendingDeleteId: id });
    clearTimeout(disarmTimer);
    disarmTimer = setTimeout(() => set({ pendingDeleteId: null }), 3000);
    return false;
  }
  clearTimeout(disarmTimer);
  set({ pendingDeleteId: null });
  try {
    await api.deleteModel(id);
  } catch (error) {
    if (error.status !== 404) {
      replaceModel({ ...get().models.find((m) => m.id === id), error: error.message });
      return false;
    }
  }
  set({ models: get().models.filter((m) => m.id !== id) });
  openWhenReady.delete(id);
  if (useViewerStore.getState().modelId === id) loadModel(MODELS[0].id);
  return true;
}
