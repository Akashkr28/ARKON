// Screen-space questions about the design handles, answered by the scene (like
// sceneQueries.js), so mouse and gesture code can drag them with plain numbers.

let active = null;

export function registerHandleQueries(queries) {
  active = queries;
  return () => {
    if (active === queries) active = null;
  };
}

// → the handle within reach of this pixel, or null
export function handleAt(screenX, screenY) {
  return active ? active.handleAt(screenX, screenY) : null;
}

// Where the pointer is along a handle's axis (mm), or on its plane (CAD x, y in mm).
export function handlePosition(handle, screenX, screenY) {
  return active ? active.handlePosition(handle, screenX, screenY) : null;
}
