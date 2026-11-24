// Section plane maths, in the model's own space (metres, glTF axes: X right,
// Y up, Z toward the viewer in the front view).
//
// A section is { axis: 'x' | 'y' | 'z' | null, offset: 0..1 across the model, flip }.
// Without flip, everything beyond the plane (larger coordinate) is cut away.

export const SECTION_AXES = ['x', 'y', 'z'];
const AXIS_INDEX = { x: 0, y: 1, z: 2 };

export const NO_SECTION = { axis: null, offset: 0.5, flip: false };

// Where the plane sits along its axis, in metres.
export function sectionPosition(section, bounds) {
  const i = AXIS_INDEX[section.axis];
  return bounds.min[i] + section.offset * (bounds.max[i] - bounds.min[i]);
}

// Plane as { normal, constant } for three.js clipping: points with
// normal·p + constant < 0 are cut away.
export function sectionPlane(section, bounds) {
  if (!section.axis || !bounds) return null;
  const normal = [0, 0, 0];
  const position = sectionPosition(section, bounds);
  const sign = section.flip ? 1 : -1;
  normal[AXIS_INDEX[section.axis]] = sign;
  return { normal, constant: -sign * position };
}
