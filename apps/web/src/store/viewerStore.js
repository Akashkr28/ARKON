import { create } from 'zustand';
import { MODELS } from '../config';

export const initialTransform = () => ({
  position: [0, 0, 0],
  rotation: [0.35, -0.6, 0],
  scale: 1,
});

// Read-only from components. All writes go through actions/viewerActions.js.
export const useViewerStore = create(() => ({
  modelId: MODELS[0].id,
  modelLoadCount: 0,
  modelStatus: 'loading', // 'loading' | 'ready' | 'error'
  modelError: null,
  modelVisible: true,

  ...initialTransform(),
  spinVelocity: [0, 0], // radians/sec around x and y

  explodeTarget: 0,
  parts: {}, // id -> { id, name, vertexCount, size: [x, y, z] in metres }
  // Real-world units: the model is shown normalised, these map back to metres.
  metresPerSceneUnit: 1,
  modelSize: null, // [x, y, z] metres, whole model
  modelBounds: null, // { min, max } metres, in the model's own axes
  section: { axis: null, offset: 0.5, flip: false }, // cutaway plane (undoable)
  showSectionPlane: true, // draw the plane's outline (display only)
  lengthUnit: 'mm', // display unit: 'mm' | 'cm' | 'm' | 'in'
  hiddenPartIds: [], // hidden from view and from picking (undoable)
  xrayPartIds: [], // drawn see-through so you can look past them (undoable)
  selectedPartIds: [], // in pick order
  selectedPartId: null, // the most recently picked one (pull target, info card)
  partPull: [0, 0, 0], // world-space offset of the selected part, on top of the explode
  infoPartId: null, // part whose info card is showing

  mirror: true,
  grayscale: false,
  dim: 0.25,
  labels: false,
  debug: false,
  materialMode: 'hologram', // 'hologram' | 'original'

  qualityHint: null, // a lower quality level to suggest when rendering is slow

  cameras: [], // [{ id, label }]
  requestedCameraId: null, // what we ask getUserMedia for
  activeCameraId: null, // what the browser actually gave us
}));
