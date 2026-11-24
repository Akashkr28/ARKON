// A designed part is a list of features, applied in order: one base shape, then
// operations (holes, pockets, bosses, fillets, chamfers, shell). Every dimension is a
// plain number in millimetres (angles in degrees), so the list is the whole design:
// change a number and the part rebuilds. Pure data and rules; cad/buildPart.js turns it
// into geometry.
//
// Axes (CAD convention): X right, Y back, Z up. Base shapes stand on Z = 0, centred on
// X and Y. "Top" operations work down from the highest face, at an (x, y) position.

const length = (key, label, value, min = 0.01) => ({ key, label, kind: 'length', value, min });
const count = (key, label, value, min = 1, max = 64) => ({ key, label, kind: 'count', value, min, max });
const angle = (key, label, value) => ({ key, label, kind: 'angle', value, min: -360, max: 360 });
const choice = (key, label, value, options) => ({ key, label, kind: 'choice', value, options });

const EDGE_SETS = [
  ['vertical', 'Vertical edges'],
  ['top', 'Top edges'],
  ['bottom', 'Bottom edges'],
  ['all', 'All edges'],
];
const PATTERNS = [
  ['single', 'Single'],
  ['line', 'Row along X'],
  ['grid', 'Grid'],
  ['circle', 'Circle'],
];

// Parameters of a hole/boss pattern, shared by both.
const patternParams = [
  choice('pattern', 'Pattern', 'single', PATTERNS),
  count('count', 'Count (row / circle)', 4),
  count('rows', 'Rows (grid)', 2),
  length('pitch', 'Pitch / spacing (X)', 30),
  length('rowPitch', 'Row spacing (Y)', 30),
  length('patternRadius', 'Circle radius', 30),
  angle('startAngle', 'Start angle', 0),
];

export const FEATURE_TYPES = {
  // ---- base shapes ----
  box: {
    label: 'Box',
    base: true,
    params: [length('length', 'Length (X)', 100), length('width', 'Width (Y)', 60), length('height', 'Height (Z)', 20)],
  },
  cylinder: {
    label: 'Cylinder',
    base: true,
    params: [length('diameter', 'Diameter', 60), length('height', 'Height', 40)],
  },
  tube: {
    label: 'Tube',
    base: true,
    params: [length('outer', 'Outer diameter', 60), length('inner', 'Inner diameter', 40), length('height', 'Height', 80)],
  },
  prism: {
    label: 'Polygon prism',
    base: true,
    params: [count('sides', 'Sides', 6, 3, 64), length('acrossFlats', 'Across flats', 40), length('height', 'Height', 20)],
  },
  // ---- operations ----
  hole: {
    label: 'Hole',
    params: [
      length('x', 'X position', 0, -1e6),
      length('y', 'Y position', 0, -1e6),
      length('diameter', 'Diameter', 10),
      length('depth', 'Depth (0 = through)', 0, 0),
      length('counterbore', 'Counterbore Ø (0 = none)', 0, 0),
      length('counterboreDepth', 'Counterbore depth', 5, 0),
      ...patternParams,
    ],
  },
  pocket: {
    label: 'Pocket',
    params: [
      length('x', 'X position', 0, -1e6),
      length('y', 'Y position', 0, -1e6),
      length('length', 'Length (X)', 40),
      length('width', 'Width (Y)', 20),
      length('depth', 'Depth', 5),
      length('cornerRadius', 'Corner radius', 0, 0),
    ],
  },
  boss: {
    label: 'Boss',
    params: [
      length('x', 'X position', 0, -1e6),
      length('y', 'Y position', 0, -1e6),
      length('diameter', 'Diameter', 20),
      length('height', 'Height', 15),
      ...patternParams,
    ],
  },
  fillet: {
    label: 'Fillet',
    params: [length('radius', 'Radius', 3), choice('edges', 'Edges', 'vertical', EDGE_SETS)],
  },
  chamfer: {
    label: 'Chamfer',
    params: [length('distance', 'Distance', 1), choice('edges', 'Edges', 'top', EDGE_SETS)],
  },
  shell: {
    label: 'Shell (hollow, open top)',
    params: [length('thickness', 'Wall thickness', 2)],
  },
};

export const BASE_TYPES = Object.keys(FEATURE_TYPES).filter((t) => FEATURE_TYPES[t].base);
export const OPERATION_TYPES = Object.keys(FEATURE_TYPES).filter((t) => !FEATURE_TYPES[t].base);

let nextId = 1;
export function newFeatureId() {
  return `f${Date.now().toString(36)}${(nextId++).toString(36)}`;
}

export function defaultParams(type) {
  return Object.fromEntries(FEATURE_TYPES[type].params.map((p) => [p.key, p.value]));
}

export function makeFeature(type, params = {}) {
  if (!FEATURE_TYPES[type]) throw new Error(`Unknown feature type: ${type}`);
  return { id: newFeatureId(), type, enabled: true, params: { ...defaultParams(type), ...params } };
}

// Keeps a value inside its parameter's limits; whole numbers for counts.
export function clampParam(type, key, value) {
  const spec = FEATURE_TYPES[type]?.params.find((p) => p.key === key);
  if (!spec) return value;
  if (spec.kind === 'choice') return spec.options.some(([v]) => v === value) ? value : spec.value;
  let number = Number(value);
  if (!Number.isFinite(number)) return spec.value;
  if (spec.kind === 'count') number = Math.round(number);
  if (spec.min !== undefined) number = Math.max(spec.min, number);
  if (spec.max !== undefined) number = Math.min(spec.max, number);
  return number;
}

// Which parameters matter for this feature as set (e.g. no "Rows" unless it's a grid).
export function visibleParams(feature) {
  const { pattern } = feature.params;
  return FEATURE_TYPES[feature.type].params.filter((p) => {
    if (p.key === 'count') return pattern === 'line' || pattern === 'circle' || pattern === 'grid';
    if (p.key === 'rows') return pattern === 'grid';
    if (p.key === 'pitch') return pattern === 'line' || pattern === 'grid';
    if (p.key === 'rowPitch') return pattern === 'grid';
    if (p.key === 'patternRadius' || p.key === 'startAngle') return pattern === 'circle';
    if (p.key === 'counterboreDepth') return feature.params.counterbore > 0;
    return true;
  });
}

// (x, y) of every copy in a hole/boss pattern, around the feature's position.
export function patternPoints({
  x = 0,
  y = 0,
  pattern = 'single',
  count: n = 1,
  rows = 1,
  pitch = 0,
  rowPitch = pitch,
  patternRadius = 0,
  startAngle = 0,
}) {
  if (pattern === 'line') {
    const offset = ((n - 1) * pitch) / 2;
    return Array.from({ length: n }, (_, i) => [x - offset + i * pitch, y]);
  }
  if (pattern === 'grid') {
    const ox = ((n - 1) * pitch) / 2;
    const oy = ((rows - 1) * rowPitch) / 2;
    const points = [];
    for (let j = 0; j < rows; j += 1) for (let i = 0; i < n; i += 1) points.push([x - ox + i * pitch, y - oy + j * rowPitch]);
    return points;
  }
  if (pattern === 'circle') {
    return Array.from({ length: n }, (_, i) => {
      const a = ((startAngle + (360 * i) / n) * Math.PI) / 180;
      return [x + patternRadius * Math.cos(a), y + patternRadius * Math.sin(a)];
    });
  }
  return [[x, y]];
}

// One line for the feature list, e.g. "4 × Ø10 through, circle R30". Takes the
// feature with its formulas already worked out (cad/parameters.js).
export function describeFeature(feature) {
  const p = feature.params;
  const n = (v) => `${Number(Number(v).toPrecision(6))}`;
  const copies = patternPoints(p).length;
  const times = copies > 1 ? `${copies} × ` : '';
  switch (feature.type) {
    case 'box':
      return `${n(p.length)} × ${n(p.width)} × ${n(p.height)} mm`;
    case 'cylinder':
      return `Ø${n(p.diameter)} × ${n(p.height)} mm`;
    case 'tube':
      return `Ø${n(p.outer)} / Ø${n(p.inner)} × ${n(p.height)} mm`;
    case 'prism':
      return `${p.sides} sides, ${n(p.acrossFlats)} AF × ${n(p.height)} mm`;
    case 'hole':
      return `${times}Ø${n(p.diameter)} ${p.depth > 0 ? `× ${n(p.depth)} deep` : 'through'}${p.counterbore > 0 ? `, ⌴Ø${n(p.counterbore)}` : ''}`;
    case 'pocket':
      return `${n(p.length)} × ${n(p.width)} × ${n(p.depth)} deep`;
    case 'boss':
      return `${times}Ø${n(p.diameter)} × ${n(p.height)} mm`;
    case 'fillet':
      return `R${n(p.radius)}, ${p.edges} edges`;
    case 'chamfer':
      return `${n(p.distance)} mm, ${p.edges} edges`;
    case 'shell':
      return `${n(p.thickness)} mm walls`;
    default:
      return '';
  }
}

// A starting design: a plate with four mounting holes and rounded corners, driven by
// named parameters, so changing "length" moves the holes with the edge.
export function starterDesign() {
  return {
    name: 'Mounting plate',
    appearance: { materialId: 'aluminium', color: null, finish: 'satin' },
    parameters: [
      { id: 'p-length', name: 'length', expression: '120' },
      { id: 'p-width', name: 'width', expression: '80' },
      { id: 'p-thickness', name: 'thickness', expression: '10' },
      { id: 'p-margin', name: 'margin', expression: '15' },
    ],
    features: [
      makeFeature('box', { length: { expr: 'length' }, width: { expr: 'width' }, height: { expr: 'thickness' } }),
      // A hole 15 mm in from each corner.
      makeFeature('hole', {
        diameter: 8,
        pattern: 'grid',
        count: 2,
        rows: 2,
        pitch: { expr: 'length - 2 * margin' },
        rowPitch: { expr: 'width - 2 * margin' },
      }),
      makeFeature('fillet', { radius: 6, edges: 'vertical' }),
    ],
  };
}
