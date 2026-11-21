// Geometry questions the rest of the app can ask the scene with plain numbers
// (like picking.js): "what would a measurement snap to under this pixel?" and
// "how big are these parts?". The model viewer registers the implementation.

let active = null;

export function registerSceneQueries(queries) {
  active = queries;
  return () => {
    if (active === queries) active = null;
  };
}

// → { partId, local: [x,y,z] (in the part's own space), metres: [x,y,z] (model
//     space, real units), kind: 'vertex' | 'edge' | 'face' } or null
export function snapAt(screenX, screenY) {
  return active ? active.snapAt(screenX, screenY) : null;
}

// → { center: [x,y,z], radius } in the model group's own (unrotated, unscaled)
//   space, or null if none of the parts are visible.
export function partsBounds(partIds) {
  return active ? active.partsBounds(partIds) : null;
}

// Current world position of a point stored as { partId, local }; for drawing.
export function worldPointOf(point, out) {
  return active ? active.worldPointOf(point, out) : null;
}
