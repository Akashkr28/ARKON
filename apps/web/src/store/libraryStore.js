import { create } from 'zustand';
import { LIBRARY } from '../config';

// Uploaded models as the API reports them. Written only by actions/libraryActions.js.
export const useLibraryStore = create(() => ({
  apiStatus: 'unknown', // 'unknown' | 'online' | 'offline'
  converterStatus: 'unknown', // 'up' | 'down' | 'unknown'
  maxUploadBytes: null, // from the API; checked before uploading
  models: [], // API model objects, newest first
  uploads: [], // in-flight: { key, filename, progress (0..1), error }
  quality: LIBRARY.defaultQuality, // used for the next STEP upload
  pendingDeleteId: null, // first click arms delete, second confirms
}));
