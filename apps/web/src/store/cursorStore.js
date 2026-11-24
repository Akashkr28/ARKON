import { create } from 'zustand';

// The model surface under the mouse, updated at most once a frame while hovering.
// Drives the coordinate readout, the scale bar and the ruler grid. Display only.
export const useCursorStore = create(() => ({
  point: null, // { partId, metres: [x, y, z] (model space, Y up), depth } or null
  depth: null, // depth of the last surface hovered: where the scale bar measures
}));

export function setCursorPoint(point) {
  useCursorStore.setState(point ? { point, depth: point.depth } : { point: null });
}
