// Face/edge data from the converter (services/converter/holocad_converter/faces.py):
// finding the CAD face behind a mesh triangle, and saying what a face or edge is.

import { formatArea, formatSpecLength } from '../units';

// The doc's product for a part, or null (no data, or the part couldn't be mapped).
export function productForSpec(doc, specIndex) {
  const product = doc?.parts?.[specIndex];
  return product === null || product === undefined ? null : (doc.products[product] ?? null);
}

// A part's mesh is either the glTF node itself (one primitive) or one of several
// primitive meshes inside the node's group, in primitive order.
export function primitiveIndexOf(mesh) {
  if (mesh.userData.specIndex !== undefined) return 0;
  const siblings = mesh.parent?.children.filter((child) => child.isMesh) ?? [];
  return Math.max(0, siblings.indexOf(mesh));
}

// Index of the face whose triangle range holds `triangle` in `primitive`, or -1.
export function faceAtTriangle(product, primitive, triangle) {
  if (triangle === null || triangle === undefined) return -1;
  return product.faces.findIndex(
    ({ tri: [p, first, count] }) => p === primitive && triangle >= first && triangle < first + count,
  );
}

const AXES = [
  ['+X', [1, 0, 0]],
  ['−X', [-1, 0, 0]],
  ['+Y', [0, 1, 0]],
  ['−Y', [0, -1, 0]],
  ['+Z', [0, 0, 1]],
  ['−Z', [0, 0, -1]],
];

function direction(normal) {
  const axis = AXES.find(([, v]) => v.every((c, i) => Math.abs(c - normal[i]) < 1e-3));
  return axis ? axis[0] : normal.map((c) => c.toFixed(3)).join(', ');
}

// → { title, details: [string] } in the user's length unit.
export function describeFace(face, unit = 'mm') {
  const L = (mm) => formatSpecLength(mm, unit);
  const area = `Area ${formatArea(face.area, unit)}`;
  switch (face.type) {
    case 'plane':
      return { title: 'Flat face', details: [area, `Facing ${direction(face.normal)} (Y up)`] };
    case 'cylinder': {
      const whole = face.sweep >= 350;
      const small = face.sweep <= 100;
      let title;
      if (face.concave)
        title = whole
          ? `Hole Ø${L(2 * face.radius)}`
          : small
            ? `Fillet R${L(face.radius)}`
            : `Concave face R${L(face.radius)}`;
      else
        title = whole
          ? `Outer Ø${L(2 * face.radius)}`
          : small
            ? `Round R${L(face.radius)}`
            : `Cylindrical face R${L(face.radius)}`;
      return {
        title,
        details: [`Cylindrical · R${L(face.radius)} · ${face.sweep}° sweep`, `Length ${L(face.length)}`, area],
      };
    }
    case 'cone':
      return {
        title: 'Conical face',
        details: [
          `Half-angle ${face.half_angle ?? face.halfAngle}° (chamfer or countersink)`,
          `Reference R${L(face.radius)}`,
          area,
        ],
      };
    case 'sphere':
      return { title: `Spherical face R${L(face.radius)}`, details: [area] };
    case 'torus':
      return {
        title: `Toroidal face R${L(face.radius)}`,
        details: [`Tube R${L(face.radius)} · ring R${L(face.major_radius ?? face.majorRadius)}`, area],
      };
    case 'freeform':
      return { title: 'Freeform surface', details: [area] };
    default:
      return { title: `${face.type[0].toUpperCase()}${face.type.slice(1)} surface`, details: [area] };
  }
}

export function describeEdge(edge, unit = 'mm') {
  const L = (mm) => formatSpecLength(mm, unit);
  if (edge.type === 'line') return { title: 'Straight edge', details: [`Length ${L(edge.length)}`] };
  if (edge.type === 'circle') {
    return edge.full
      ? {
          title: `Circular edge Ø${L(2 * edge.radius)}`,
          details: [`R${L(edge.radius)}`, `Circumference ${L(edge.length)}`],
        }
      : { title: `Arc R${L(edge.radius)}`, details: [`Length ${L(edge.length)}`] };
  }
  return { title: `${edge.type[0].toUpperCase()}${edge.type.slice(1)} edge`, details: [`Length ${L(edge.length)}`] };
}

export function describeItem(product, item, unit) {
  if (!product || !item) return null;
  const data = item.kind === 'edge' ? product.edges[item.index] : product.faces[item.index];
  if (!data) return null;
  return item.kind === 'edge' ? describeEdge(data, unit) : describeFace(data, unit);
}
