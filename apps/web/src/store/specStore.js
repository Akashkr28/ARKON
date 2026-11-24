import { create } from 'zustand';

// Measured engineering data for the open model (see models/partSpecs.js).
// Written only by actions/specActions.js.
export const useSpecStore = create(() => ({
  modelId: null,
  status: 'none', // 'none' | 'loading' | 'ready' | 'unavailable' | 'error'
  error: null,
  units: null,
  specs: [], // by spec index: the converter's spec object, or null (e.g. GLB upload)
  // Materials picked in the spec sheet, by product (all copies of a part together):
  // productKey -> { id, name, density }.
  materialPicks: {},

  // Face/edge data for the inspector, loaded the first time the SPECS tab is opened.
  facesModelId: null,
  facesStatus: 'none', // 'none' | 'loading' | 'ready' | 'unavailable' | 'error'
  faces: null, // { units, products: [{ faces, edges }], parts: [productIndex|null] }
  // { partId, specIndex, kind: 'face' | 'edge', index, x, y } under the cursor, and the
  // last one clicked (shown in the spec sheet).
  hover: null,
  pinned: null,
}));
