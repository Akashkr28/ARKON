// Screen-space questions about the assembly, answered by the scene (like handleQueries.js),
// so mouse and gesture code can pick faces and drag parts with plain numbers.

let active = null;

export function registerAssemblyQueries(queries) {
  active = queries;
  return () => {
    if (active === queries) active = null;
  };
}

// → { componentId, point: [x, y, z] (assembly frame, metres) } for the part under a pixel
export const componentAt = (x, y) => (active ? active.componentAt(x, y) : null);

// → { componentId, geometry, label, key, highlight } for the face under a pixel
export const faceAt = (x, y) => (active ? active.faceAt(x, y) : null);

// → { origin, direction } of the pointer's ray, in the assembly frame
export const rayAt = (x, y) => (active ? active.rayAt(x, y) : null);

// → the direction the camera looks, in the assembly frame
export const viewDirection = () => (active ? active.viewDirection() : [0, 0, -1]);
