import { create } from 'zustand';
import { useViewerStore } from '../store/viewerStore';

// Measurements: click points on the model (they snap to corners and edges) to get
// distances and angles in real units. A point is stored two ways:
//   { partId, local } — attached to its part, so lines follow the model on screen
//   metres            — model-space position in real units, for the numbers
// Values are fixed when the measurement is taken.

export const useMeasureStore = create(() => ({
  tool: 'off', // 'off' | 'distance' | 'angle'
  draft: [], // points placed so far for the measurement in progress
  hover: null, // snap candidate under the cursor while a tool is active
  measurements: [], // { id, type, points, value, deltas?, exploded }
}));

const get = () => useMeasureStore.getState();
const set = (partial) => useMeasureStore.setState(partial);
const POINTS_NEEDED = { distance: 2, angle: 3 };
let nextId = 1;

export function distanceBetween(p, q) {
  return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
}

// Angle at `vertex` between the rays to `a` and `b`, in degrees.
export function angleAt(a, vertex, b) {
  const u = [a[0] - vertex[0], a[1] - vertex[1], a[2] - vertex[2]];
  const v = [b[0] - vertex[0], b[1] - vertex[1], b[2] - vertex[2]];
  const lengths = Math.hypot(...u) * Math.hypot(...v);
  if (lengths < 1e-12) return 0;
  const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / lengths;
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

function finish(type, points) {
  const metres = points.map((p) => p.metres);
  const measurement = {
    id: `m${nextId++}`,
    type,
    points,
    // Taken on an exploded model, distances between parts aren't real assembly distances.
    exploded: useViewerStore.getState().explodeTarget > 0.05,
  };
  if (type === 'distance') {
    measurement.value = distanceBetween(metres[0], metres[1]);
    measurement.deltas = metres[1].map((v, i) => Math.abs(v - metres[0][i]));
  } else {
    measurement.value = angleAt(metres[0], metres[1], metres[2]);
  }
  set({ measurements: [...get().measurements, measurement], draft: [] });
  return measurement;
}

export function setMeasureTool(tool) {
  set({ tool, draft: [], hover: null });
}

// Q cycles: off → distance → angle → off.
export function cycleMeasureTool() {
  const order = ['off', 'distance', 'angle'];
  setMeasureTool(order[(order.indexOf(get().tool) + 1) % order.length]);
}

export function setMeasureHover(snap) {
  if (get().tool !== 'off') set({ hover: snap });
}

// Returns the finished measurement once enough points are placed.
export function addMeasurePoint(snap) {
  const { tool, draft } = get();
  if (tool === 'off' || !snap) return null;
  const points = [...draft, snap];
  if (points.length < POINTS_NEEDED[tool]) {
    set({ draft: points });
    return null;
  }
  return finish(tool, points);
}

// Esc: drop the half-finished measurement, or leave the tool if there isn't one.
// Returns true if it handled the key.
export function cancelMeasuring() {
  const { tool, draft } = get();
  if (draft.length) {
    set({ draft: [] });
    return true;
  }
  if (tool !== 'off') {
    setMeasureTool('off');
    return true;
  }
  return false;
}

export function deleteMeasurement(id) {
  set({ measurements: get().measurements.filter((m) => m.id !== id) });
}

export function clearMeasurements() {
  set({ measurements: [], draft: [] });
}

// Measurements belong to a model; start over when another one loads.
useViewerStore.subscribe((state, previous) => {
  if (state.modelId !== previous.modelId || state.modelLoadCount !== previous.modelLoadCount) {
    set({ measurements: [], draft: [], hover: null });
  }
});
