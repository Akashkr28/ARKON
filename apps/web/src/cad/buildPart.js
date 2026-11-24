// Turns a feature list (cad/features.js) into CAD geometry with replicad (OpenCASCADE in
// WebAssembly), and the geometry into plain arrays for the viewer. Takes the replicad
// module as an argument, so the same code runs in the browser's CAD worker and in tests.
//
// A feature that can't be built (a fillet too big for its edges, a hole off the part)
// is skipped with a readable error; the rest of the part still builds.

import { FEATURE_TYPES, patternPoints } from './features';

const MM_TO_M = 0.001;
const EPS = 0.01; // mm: tools overshoot faces by this much so cuts go cleanly through

function bounds(shape) {
  const [[x0, y0, z0], [x1, y1, z1]] = shape.boundingBox.bounds;
  return { x0, y0, z0, x1, y1, z1 };
}

function edgeFilter(which, b) {
  if (which === 'vertical') return (e) => e.inDirection('Z');
  if (which === 'top') return (e) => e.inPlane('XY', b.z1);
  if (which === 'bottom') return (e) => e.inPlane('XY', b.z0);
  return undefined; // all edges
}

function fuseAll(r, tools) {
  return tools.reduce((all, tool) => {
    if (!all) return tool;
    const fused = all.fuse(tool);
    all.delete();
    tool.delete();
    return fused;
  }, null);
}

function buildBase(r, { type, params: p }) {
  switch (type) {
    case 'box':
      return r.makeBaseBox(p.length, p.width, p.height);
    case 'cylinder':
      return r.makeCylinder(p.diameter / 2, p.height);
    case 'tube': {
      if (p.inner >= p.outer) throw new Error('Inner diameter must be smaller than the outer diameter');
      const outer = r.makeCylinder(p.outer / 2, p.height);
      if (p.inner <= 0) return outer;
      const inner = r.makeCylinder(p.inner / 2, p.height + 2 * EPS, [0, 0, -EPS]);
      const tube = outer.cut(inner);
      outer.delete();
      inner.delete();
      return tube;
    }
    case 'prism': {
      const circumradius = p.acrossFlats / (2 * Math.cos(Math.PI / p.sides));
      return r.drawPolysides(circumradius, p.sides).sketchOnPlane('XY').extrude(p.height);
    }
    default:
      throw new Error(`Unknown base shape: ${type}`);
  }
}

function applyOperation(r, shape, { type, params: p }) {
  const b = bounds(shape);
  switch (type) {
    case 'hole': {
      const top = b.z1;
      const bottom = p.depth > 0 ? top - p.depth : b.z0 - EPS;
      const tools = patternPoints(p).flatMap(([x, y]) => {
        const out = [r.makeCylinder(p.diameter / 2, top - bottom + EPS, [x, y, bottom])];
        if (p.counterbore > p.diameter && p.counterboreDepth > 0) {
          out.push(r.makeCylinder(p.counterbore / 2, p.counterboreDepth + EPS, [x, y, top - p.counterboreDepth]));
        }
        return out;
      });
      return cutWith(shape, fuseAll(r, tools));
    }
    case 'pocket': {
      if (p.depth <= 0) throw new Error('Depth must be more than 0');
      const outline =
        p.cornerRadius > 0
          ? r.drawRoundedRectangle(p.length, p.width, Math.min(p.cornerRadius, Math.min(p.length, p.width) / 2 - EPS))
          : r.drawRectangle(p.length, p.width);
      const tool = outline.sketchOnPlane('XY', [p.x, p.y, b.z1 - p.depth]).extrude(p.depth + EPS);
      return cutWith(shape, tool);
    }
    case 'boss': {
      const tools = patternPoints(p).map(([x, y]) => r.makeCylinder(p.diameter / 2, p.height, [x, y, b.z1]));
      const tool = fuseAll(r, tools);
      const fused = shape.fuse(tool);
      tool.delete();
      return fused;
    }
    case 'fillet':
      return shape.fillet(p.radius, edgeFilter(p.edges, b));
    case 'chamfer':
      return shape.chamfer(p.distance, edgeFilter(p.edges, b));
    case 'shell':
      return shape.shell(p.thickness, (f) => f.inPlane('XY', b.z1));
    default:
      throw new Error(`Unknown operation: ${type}`);
  }
}

function cutWith(shape, tool) {
  const result = shape.cut(tool);
  tool.delete();
  return result;
}

// What went wrong, in words: OpenCASCADE throws opaque WebAssembly exceptions.
function explain(feature, error) {
  const message = error instanceof Error && !/WebAssembly/.test(error.message) ? error.message : null;
  if (message) return message;
  switch (feature.type) {
    case 'fillet':
      return 'Fillet radius too large for these edges (try a smaller radius)';
    case 'chamfer':
      return 'Chamfer too large for these edges';
    case 'shell':
      return 'Wall too thick for this shape';
    default:
      return 'This feature could not be built with these dimensions';
  }
}

// → { shape (replicad shape, or null), errors: { featureId: message } }
export function buildPart(r, features) {
  const errors = {};
  let shape = null;
  for (const feature of features) {
    if (!feature.enabled) continue;
    const isBase = FEATURE_TYPES[feature.type]?.base;
    try {
      if (isBase) {
        if (shape) throw new Error('Only the first shape can be a base shape; add operations after it');
        shape = buildBase(r, feature);
      } else {
        if (!shape) throw new Error('Start with a base shape (box, cylinder, tube or prism)');
        const next = applyOperation(r, shape, feature);
        if (!next || r.measureVolume(next) <= 0) throw new Error('This would leave no material');
        shape.delete();
        shape = next;
      }
    } catch (error) {
      errors[feature.id] = explain(feature, error);
    }
  }
  return { shape, errors };
}

// ---- for the viewer ----------------------------------------------------------------

// replicad's surface type names (some in French, as OpenCASCADE has them) → the names the
// rest of HoloCAD uses (the STEP converter's specs).
const SURFACE_NAMES = {
  PLANE: 'plane',
  CYLINDRE: 'cylinder',
  CYLINDER: 'cylinder',
  CONE: 'cone',
  SPHERE: 'sphere',
  TORUS: 'torus',
  BEZIER_SURFACE: 'freeform',
  BSPLINE_SURFACE: 'freeform',
  REVOLUTION_SURFACE: 'revolved',
  EXTRUSION_SURFACE: 'extruded',
  OFFSET_SURFACE: 'offset',
};

// CAD (mm, Z up) → viewer (metres, Y up): (x, y, z) → (x, z, −y), as the STEP converter does.
function toViewer(flat, scale) {
  const out = new Float32Array(flat.length);
  for (let i = 0; i < flat.length; i += 3) {
    out[i] = flat[i] * scale;
    out[i + 1] = flat[i + 2] * scale;
    out[i + 2] = -flat[i + 1] * scale;
  }
  return out;
}

// Mesh, edges and measured properties of a built part, as transferable arrays.
export function describePart(r, shape) {
  const b = bounds(shape);
  const size = Math.hypot(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
  const tolerance = Math.max(size * 0.0005, 0.005);
  const mesh = shape.mesh({ tolerance, angularTolerance: 10 });
  const edges = shape.meshEdges({ tolerance, angularTolerance: 10 });
  const volume = r.measureShapeVolumeProperties(shape);
  const centre = volume.centerOfMass;
  const faceTypes = {};
  for (const face of shape.faces) {
    const type = SURFACE_NAMES[face.geomType] ?? String(face.geomType).toLowerCase();
    faceTypes[type] = (faceTypes[type] ?? 0) + 1;
  }

  return {
    positions: toViewer(mesh.vertices, MM_TO_M),
    normals: toViewer(mesh.normals, 1),
    indices: Uint32Array.from(mesh.triangles),
    faceGroups: mesh.faceGroups.map(({ start, count }) => [start / 3, count / 3]), // in triangles
    edgeLines: toViewer(edges.lines, MM_TO_M),
    properties: {
      volumeMm3: volume.volume,
      surfaceAreaMm2: r.measureArea(shape),
      sizeMm: [b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0], // X × Y × Z as designed
      boundsMm: { min: [b.x0, b.y0, b.z0], max: [b.x1, b.y1, b.z1] },
      centreOfMassMm: [centre[0], centre[1], centre[2]],
      faces: shape.faces.length,
      edges: shape.edges.length,
      faceTypes,
    },
  };
}

// ---- assemblies --------------------------------------------------------------------

// One STEP file holding several designed parts, each placed, named and coloured (an
// assembly any CAD program opens with its parts separate).
// parts: [{ name, color, features, rotation: { angle (degrees), axis }, translation (mm) }]
// → { blob, skipped: [names that couldn't be built] }
export function assemblyStep(r, parts) {
  const shapes = [];
  const skipped = [];
  try {
    for (const part of parts) {
      let { shape } = buildPart(r, part.features);
      if (!shape) {
        skipped.push(part.name);
        continue;
      }
      if (part.rotation?.angle) shape = shape.rotate(part.rotation.angle, [0, 0, 0], part.rotation.axis);
      if (part.translation?.some((v) => v !== 0)) shape = shape.translate(part.translation);
      shapes.push({ shape, name: part.name, color: part.color });
    }
    if (!shapes.length) throw new Error('None of the parts could be built');
    return { blob: r.exportSTEP(shapes), skipped };
  } finally {
    for (const { shape } of shapes) shape.delete();
  }
}
