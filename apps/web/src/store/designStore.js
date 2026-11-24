import { create } from 'zustand';

// The part being designed (DESIGN workspace). Written only by actions/designActions.js.
export const useDesignStore = create(() => ({
  kernel: 'off', // 'off' | 'loading' | 'ready' | 'error'
  name: 'Untitled part',
  features: [], // see cad/features.js; dimensions may be formulas { expr }
  parameters: [], // { id, name, expression } (cad/parameters.js)
  appearance: { materialId: 'aluminium', color: null, finish: 'satin' }, // cad/appearance.js
  values: {}, // parameter name -> number, as last resolved
  parameterErrors: {}, // parameterId -> message
  resolvedFeatures: [], // features with formulas worked out (what was built)
  undoLabel: null,
  redoLabel: null,
  selectedFeatureId: null,
  errors: {}, // featureId -> why it couldn't be built
  status: 'idle', // 'idle' | 'building' | 'ready' | 'error'
  error: null,
  part: null, // { positions, normals, indices, faceGroups, edgeLines, properties }
  partVersion: 0, // bumped per rebuild, so the scene swaps geometry
  // How the part is framed in the view (metres): fixed while editing, so the part doesn't
  // jump in size with every change; re-fitted on request.
  frame: null, // { center: [x, y, z], radius }
  saving: null, // null | 'step' | 'glb' | 'library'
  // Shaping by hand: the handle under the cursor or pinch, and the one being dragged
  // ({ handleId, text } for the live label).
  hoverHandleId: null,
  drag: null,
  message: null,
}));
