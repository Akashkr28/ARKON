import { MODELS } from '../config';
import { useLibraryStore } from '../store/libraryStore';

// One lookup for "what can the viewer load": bundled samples plus uploaded models
// that are ready. Ids are either sample ids ("engine") or API UUIDs.

export function libraryEntry(model) {
  return {
    id: model.id,
    label: model.name,
    // updatedAt in the URL means a re-converted model isn't served from the loader's cache.
    url: `${model.fileUrl}?v=${Date.parse(model.updatedAt)}`,
    source: 'library',
  };
}

export function findModelEntry(id, models = useLibraryStore.getState().models) {
  const sample = MODELS.find((m) => m.id === id);
  if (sample) return { ...sample, source: 'sample' };
  const uploaded = models.find((m) => m.id === id && m.status === 'ready');
  return uploaded ? libraryEntry(uploaded) : null;
}
