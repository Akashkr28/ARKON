// Grab handles for shaping a part by hand: arrows on faces that change a dimension when
// pulled, and position pads that slide a hole, pocket or boss across the top face.
// Pure maths on the design (no three.js): positions are in the viewer's frame (metres,
// Y up), as the part's mesh.
//
// A handle drives a dimension directly when it's a number, or the parameter behind it
// when the dimension is just that parameter's name ("length"). A dimension computed by a
// real formula ("length - 2 * margin") can't be dragged; its handle says why.

import { isFormula } from './parameters';
import { FEATURE_TYPES } from './features';

// CAD (mm, Z up) → viewer (metres, Y up): (x, y, z) → (x, z, −y).
const at = (x, y, z) => [x / 1000, z / 1000, -y / 1000];
const X = [1, 0, 0];
const Y_CAD = [0, 0, -1]; // CAD +Y in the viewer
const UP = [0, 1, 0];
const DOWN = [0, -1, 0];

// How a handle's dimension can be changed.
export function driverOf(rawValue, parameters) {
  if (!isFormula(rawValue)) return { kind: 'number' };
  const name = rawValue.expr.trim();
  const parameter = parameters.find((p) => p.name === name);
  if (parameter && /^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(parameter.expression.trim())) {
    return { kind: 'parameter', parameterId: parameter.id, name };
  }
  return { kind: 'locked', reason: `Set by the formula “${rawValue.expr}”` };
}

const label = (type, key) => FEATURE_TYPES[type].params.find((p) => p.key === key)?.label ?? key;

// axis handle: dragging `distance` mm along `dir` changes the dimension by factor × distance.
function axis(feature, raw, parameters, key, origin, dir, factor) {
  return {
    id: `${feature.id}:${key}`,
    featureId: feature.id,
    kind: 'axis',
    keys: [key],
    origin,
    dir,
    factor,
    label: label(feature.type, key),
    values: { [key]: feature.params[key] },
    drivers: { [key]: driverOf(raw.params[key], parameters) },
  };
}

// position pad: slides (x, y) across the top face.
function pad(feature, raw, parameters, origin) {
  return {
    id: `${feature.id}:xy`,
    featureId: feature.id,
    kind: 'plane',
    keys: ['x', 'y'],
    origin,
    label: 'Position',
    values: { x: feature.params.x, y: feature.params.y },
    drivers: { x: driverOf(raw.params.x, parameters), y: driverOf(raw.params.y, parameters) },
  };
}

// feature: with numbers (resolved); raw: as stored (may hold formulas); top: highest Z of
// the built part (mm).
export function handlesFor(feature, raw, parameters, top) {
  if (!feature?.enabled) return [];
  const p = feature.params;
  switch (feature.type) {
    case 'box':
      return [
        axis(feature, raw, parameters, 'length', at(p.length / 2, 0, p.height / 2), X, 2),
        axis(feature, raw, parameters, 'width', at(0, p.width / 2, p.height / 2), Y_CAD, 2),
        axis(feature, raw, parameters, 'height', at(0, 0, p.height), UP, 1),
      ];
    case 'cylinder':
      return [
        axis(feature, raw, parameters, 'diameter', at(p.diameter / 2, 0, p.height / 2), X, 2),
        axis(feature, raw, parameters, 'height', at(0, 0, p.height), UP, 1),
      ];
    case 'tube':
      return [
        axis(feature, raw, parameters, 'outer', at(p.outer / 2, 0, p.height / 2), X, 2),
        axis(feature, raw, parameters, 'height', at(0, 0, p.height), UP, 1),
      ];
    case 'prism':
      return [
        axis(feature, raw, parameters, 'acrossFlats', at(p.acrossFlats / 2, 0, p.height / 2), X, 2),
        axis(feature, raw, parameters, 'height', at(0, 0, p.height), UP, 1),
      ];
    case 'hole':
      return [
        pad(feature, raw, parameters, at(p.x, p.y, top)),
        axis(feature, raw, parameters, 'diameter', at(p.x + p.diameter / 2, p.y, top), X, 2),
      ];
    case 'pocket':
      return [
        pad(feature, raw, parameters, at(p.x, p.y, top)),
        axis(feature, raw, parameters, 'length', at(p.x + p.length / 2, p.y, top), X, 2),
        axis(feature, raw, parameters, 'width', at(p.x, p.y + p.width / 2, top), Y_CAD, 2),
        axis(feature, raw, parameters, 'depth', at(p.x, p.y, top - p.depth), DOWN, 1),
      ];
    case 'boss':
      return [
        pad(feature, raw, parameters, at(p.x, p.y, top)),
        axis(feature, raw, parameters, 'diameter', at(p.x + p.diameter / 2, p.y, top - p.height / 2), X, 2),
        axis(feature, raw, parameters, 'height', at(p.x, p.y, top), UP, 1),
      ];
    default:
      return []; // fillets, chamfers, shell: edit their numbers in the panel
  }
}

export function lockedReason(handle) {
  const locked = handle.keys.map((k) => handle.drivers[k]).find((d) => d.kind === 'locked');
  return locked?.reason ?? null;
}

// Snap: whole millimetres, or tenths with the fine modifier (Shift).
export function snapValue(value, fine = false) {
  const step = fine ? 0.1 : 1;
  return Math.round(value / step) * step;
}

// New values for a drag: `moved` is mm along the axis (axis handles) or the CAD (x, y)
// offset in mm (pads), measured from where the drag started.
export function draggedValues(handle, moved, { fine = false } = {}) {
  if (handle.kind === 'axis') {
    const [key] = handle.keys;
    const min = 0.1;
    return { [key]: Math.max(min, snapValue(handle.values[key] + handle.factor * moved, fine)) };
  }
  return {
    x: snapValue(handle.values.x + moved[0], fine),
    y: snapValue(handle.values.y + moved[1], fine),
  };
}
