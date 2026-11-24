// Putting parts together: what a picked face is (fitted from its mesh triangles), mates
// that hold one part against another, and solving where every part ends up.
//
// Everything is in the assembly's own frame: metres, Y up (the viewer's frame). A part's
// placement is { position: [x, y, z], quaternion: [x, y, z, w] }, taking its own
// coordinates into the assembly's.
//
// A mate attaches a MOVING part to a TARGET part. Each part is attached to at most one
// other, so mates form trees whose roots stay where you put them; moving a root carries
// everything attached to it. What a mate leaves free is stored on it and can be dragged:
//   contact  flat face against flat face: slide [u, v] across the face (mm), gap (mm),
//            turn about the face normal (angle, degrees)
//   axis     round face on round face's axis (pin in a hole): slide along the axis (mm),
//            turn about it (angle, degrees)

import { Matrix4, Quaternion, Vector3 } from 'three';

export const MATE_TYPES = {
  contact: { label: 'Face to face', needs: 'plane', hint: 'Pick two flat faces' },
  axis: { label: 'On axis', needs: 'cylinder', hint: 'Pick two round faces (a pin and a hole, a shaft and a bore)' },
};

const PLANE_TOLERANCE = 0.02; // normals within ~1° of each other: flat
const AXIS_TOLERANCE = 0.08; // normals this close to perpendicular to the axis: round

const v3 = (a) => new Vector3().fromArray(a);
const round = (x, digits = 6) => Number(x.toFixed(digits));
const arr = (v) => v.toArray().map((x) => round(x));

export const IDENTITY = Object.freeze({ position: [0, 0, 0], quaternion: [0, 0, 0, 1] });

// ---- small linear algebra -------------------------------------------------------------

// Eigenvectors of a symmetric 3×3 matrix (Jacobi rotations), smallest eigenvalue first.
export function symmetricEigen(m) {
  const a = m.map((row) => [...row]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep += 1) {
    const off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2;
    if (off < 1e-20) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k += 1) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k += 1) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k += 1) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return [0, 1, 2]
    .map((i) => ({ value: a[i][i], vector: [v[0][i], v[1][i], v[2][i]] }))
    .sort((x, y) => x.value - y.value);
}

// Two unit vectors perpendicular to n and to each other, chosen the same way every time.
export function basisOf(normal) {
  const n = v3(normal).normalize();
  const helper = Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const u = new Vector3().crossVectors(helper, n).normalize();
  const w = new Vector3().crossVectors(n, u).normalize();
  return [u, w];
}

// ---- what a face is -------------------------------------------------------------------

// points, normals: flat arrays, three corners (9 numbers) per triangle, in the part's own
// frame. → { type: 'plane', point, normal } | { type: 'cylinder', point, axis, radius,
// length } (point: the face's centre), or null.
export function fitFace(points, normals) {
  const triangles = Math.floor(points.length / 9);
  if (!triangles) return null;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const cross = new Vector3();
  const centroid = new Vector3();
  const areaNormal = new Vector3();
  let area = 0;
  for (let t = 0; t < triangles; t += 1) {
    a.fromArray(points, t * 9);
    b.fromArray(points, t * 9 + 3);
    c.fromArray(points, t * 9 + 6);
    cross.subVectors(b, a).cross(c.clone().sub(a));
    const twiceArea = cross.length();
    areaNormal.add(cross);
    area += twiceArea;
    centroid.addScaledVector(a.add(b).add(c), twiceArea / 3);
  }
  if (area < 1e-18) return null;
  centroid.divideScalar(area);

  // How the surface normals spread: all alike → flat; all perpendicular to one
  // direction → round about that direction.
  const n = new Vector3();
  const mean = new Vector3();
  const scatter = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const count = normals.length / 3;
  for (let i = 0; i < count; i += 1) {
    n.fromArray(normals, i * 3).normalize();
    mean.add(n);
    const e = n.toArray();
    for (let r = 0; r < 3; r += 1) for (let k = 0; k < 3; k += 1) scatter[r][k] += e[r] * e[k];
  }
  mean.divideScalar(count);
  const flat = mean.length() > 1 - PLANE_TOLERANCE;
  if (flat) {
    // The geometric normal (winding) is steadier than averaged shading normals.
    const normal = areaNormal.lengthSq() > 0 ? areaNormal.normalize() : mean.normalize();
    if (normal.dot(mean) < 0) normal.negate();
    return { type: 'plane', point: arr(centroid), normal: arr(normal) };
  }

  const [smallest] = symmetricEigen(scatter);
  const axis = v3(smallest.vector).normalize();
  let worst = 0;
  for (let i = 0; i < count; i += 1) worst = Math.max(worst, Math.abs(n.fromArray(normals, i * 3).normalize().dot(axis)));
  if (worst > AXIS_TOLERANCE) {
    // Neither flat nor round (a sphere, a freeform patch): treat it as the plane it
    // faces on average, which is what face-to-face needs.
    return { type: 'plane', point: arr(centroid), normal: arr(mean.normalize()), approximate: true };
  }

  // Circle through the points, seen down the axis (least squares, Kåsa's method).
  const [u, w] = basisOf(axis.toArray());
  const sums = { uu: 0, uw: 0, ww: 0, u: 0, w: 0, n: 0, uz: 0, wz: 0, z: 0 };
  let minAlong = Infinity;
  let maxAlong = -Infinity;
  const p = new Vector3();
  for (let i = 0; i < points.length / 3; i += 1) {
    p.fromArray(points, i * 3);
    const x = p.dot(u);
    const y = p.dot(w);
    const z = x * x + y * y;
    const along = p.dot(axis);
    minAlong = Math.min(minAlong, along);
    maxAlong = Math.max(maxAlong, along);
    sums.uu += x * x;
    sums.uw += x * y;
    sums.ww += y * y;
    sums.u += x;
    sums.w += y;
    sums.n += 1;
    sums.uz += x * z;
    sums.wz += y * z;
    sums.z += z;
  }
  // [uu uw u; uw ww w; u w n] [A B C]ᵀ = [uz wz z]ᵀ, circle x² + y² = A x + B y + C.
  const m = new Matrix4().set(sums.uu, sums.uw, sums.u, 0, sums.uw, sums.ww, sums.w, 0, sums.u, sums.w, sums.n, 0, 0, 0, 0, 1);
  if (Math.abs(m.determinant()) < 1e-30) return null;
  const solved = new Vector3(sums.uz, sums.wz, sums.z).applyMatrix4(m.invert());
  const cu = solved.x / 2;
  const cw = solved.y / 2;
  const radius = Math.sqrt(Math.max(0, solved.z + cu * cu + cw * cw));
  const centre = new Vector3()
    .addScaledVector(u, cu)
    .addScaledVector(w, cw)
    .addScaledVector(axis, (minAlong + maxAlong) / 2);
  return { type: 'cylinder', point: arr(centre), axis: arr(axis), radius: round(radius), length: round(maxAlong - minAlong) };
}

// A face's corners and normals in the part's own frame, ready for fitFace. `toPart`
// takes the mesh's coordinates into the part's (a Matrix4).
export function faceTriangles(geometry, firstTriangle, triangleCount, toPart) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const index = geometry.index;
  const normalMatrix = new Matrix4().copy(toPart).invert().transpose();
  const points = new Float32Array(triangleCount * 9);
  const normals = new Float32Array(triangleCount * 9);
  const p = new Vector3();
  for (let t = 0; t < triangleCount; t += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const slot = (firstTriangle + t) * 3 + corner;
      const vertex = index ? index.getX(slot) : slot;
      p.fromBufferAttribute(position, vertex).applyMatrix4(toPart).toArray(points, (t * 3 + corner) * 3);
      if (normal) p.fromBufferAttribute(normal, vertex).applyMatrix4(normalMatrix).normalize();
      else p.set(0, 0, 0);
      p.toArray(normals, (t * 3 + corner) * 3);
    }
  }
  if (!normal) {
    // No shading normals: use each triangle's own.
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    for (let t = 0; t < triangleCount; t += 1) {
      a.fromArray(points, t * 9);
      b.fromArray(points, t * 9 + 3);
      c.fromArray(points, t * 9 + 6);
      const n = b.sub(a).cross(c.sub(a)).normalize();
      for (let corner = 0; corner < 3; corner += 1) n.toArray(normals, (t * 3 + corner) * 3);
    }
  }
  return { points, normals };
}

// → "flat face" / "round face Ø12.0 mm" (lengths in mm, for labels).
export function describeGeometry(geometry) {
  if (!geometry) return 'face';
  if (geometry.type === 'cylinder') return `round face Ø${(geometry.radius * 2000).toFixed(1)} mm`;
  return geometry.approximate ? 'curved face' : 'flat face';
}

// ---- placements -----------------------------------------------------------------------

const quat = (q) => new Quaternion().fromArray(q);
const place = (position, quaternion) => ({ position: arr(position), quaternion: arr(quaternion.normalize()) });

// A point / direction of a part, in the assembly's frame.
export const pointToWorld = (placement, point) => v3(point).applyQuaternion(quat(placement.quaternion)).add(v3(placement.position));
export const directionToWorld = (placement, direction) => v3(direction).applyQuaternion(quat(placement.quaternion)).normalize();

// The face's frame on its part: a point, the direction that matters (normal or axis),
// and two directions across it.
function faceFrame(geometry, placement) {
  const along = geometry.type === 'cylinder' ? geometry.axis : geometry.normal;
  const [u, w] = basisOf(along);
  const q = quat(placement.quaternion);
  return {
    point: pointToWorld(placement, geometry.point),
    dir: directionToWorld(placement, along),
    u: u.applyQuaternion(q),
    w: w.applyQuaternion(q),
  };
}

// A new mate from two picked faces. moving/target: { componentId, geometry, label };
// placements: componentId → placement now. → mate, or throws with what went wrong.
export function createMate(type, moving, target, placements, id) {
  const spec = MATE_TYPES[type];
  if (!spec) throw new Error(`Unknown mate ${type}`);
  if (moving.componentId === target.componentId) throw new Error('Pick faces on two different parts');
  if (moving.geometry?.type !== spec.needs || target.geometry?.type !== spec.needs) throw new Error(spec.hint);
  const movingPlacement = placements[moving.componentId] ?? IDENTITY;
  const targetPlacement = placements[target.componentId] ?? IDENTITY;
  const qMoving = quat(movingPlacement.quaternion);
  const qTarget = quat(targetPlacement.quaternion);

  // Turn the moving part as little as possible: its face normal against the target's
  // (contact), or its axis along the target's, whichever way round is nearer (axis).
  const from = directionToWorld(movingPlacement, type === 'contact' ? moving.geometry.normal : moving.geometry.axis);
  const to = directionToWorld(targetPlacement, type === 'contact' ? target.geometry.normal : target.geometry.axis);
  if (type === 'contact') to.negate();
  else if (from.dot(to) < 0) to.negate();
  const aligned = new Quaternion().setFromUnitVectors(from, to).multiply(qMoving);
  // Kept relative to the target, so turning the target turns the moving part with it.
  const relative = qTarget.clone().invert().multiply(aligned);
  return {
    id,
    type,
    moving: { componentId: moving.componentId, geometry: moving.geometry, label: moving.label },
    target: { componentId: target.componentId, geometry: target.geometry, label: target.label },
    relative: arr(relative.normalize()),
    slide: type === 'contact' ? [0, 0] : 0,
    gap: 0,
    angle: 0,
  };
}

// Where a mate puts its moving part, given where the target part is.
export function solveMate(mate, targetPlacement) {
  const target = faceFrame(mate.target.geometry, targetPlacement);
  const q = new Quaternion()
    .setFromAxisAngle(target.dir, (mate.angle * Math.PI) / 180)
    .multiply(quat(targetPlacement.quaternion))
    .multiply(quat(mate.relative));
  const goal = target.point.clone();
  if (mate.type === 'contact') {
    const [su, sw] = mate.slide;
    goal
      .addScaledVector(target.u, su / 1000)
      .addScaledVector(target.w, sw / 1000)
      .addScaledVector(target.dir, mate.gap / 1000);
  } else {
    goal.addScaledVector(target.dir, mate.slide / 1000);
  }
  // The moving face's own point lands on the goal.
  const offset = v3(mate.moving.geometry.point).applyQuaternion(q);
  return place(goal.sub(offset), q);
}

// The part each part is attached to (one mate per moving part: the newest wins).
export function mateOf(mates, componentId) {
  return mates.findLast((m) => m.moving.componentId === componentId) ?? null;
}

// Would attaching `moving` to `target` close a loop (target already hangs off moving)?
export function wouldLoop(mates, movingId, targetId) {
  const seen = new Set();
  for (let id = targetId; id && !seen.has(id); id = mateOf(mates, id)?.target.componentId) {
    if (id === movingId) return true;
    seen.add(id);
  }
  return false;
}

// components: [{ id, position, quaternion }]; → { componentId: placement }. Parts with a
// mate follow their target (solved first); the rest stay where they were put.
export function solveAssembly(components, mates) {
  const byId = new Map(components.map((c) => [c.id, c]));
  const placements = {};
  const solving = new Set();
  const solve = (id) => {
    if (placements[id]) return placements[id];
    const component = byId.get(id);
    const own = { position: component.position, quaternion: component.quaternion };
    const mate = mateOf(mates, id);
    if (!mate || !byId.has(mate.target.componentId) || solving.has(id)) {
      placements[id] = own;
      return own;
    }
    solving.add(id);
    placements[id] = solveMate(mate, solve(mate.target.componentId));
    solving.delete(id);
    return placements[id];
  };
  for (const component of components) solve(component.id);
  return placements;
}

// ---- dragging -------------------------------------------------------------------------

// ray: { origin: [x, y, z], direction: [x, y, z] } in the assembly's frame.
export function rayPlane(ray, point, normal) {
  const n = v3(normal);
  const d = v3(ray.direction);
  const along = n.dot(d);
  if (Math.abs(along) < 1e-6) return null; // edge-on
  const t = n.dot(v3(point).sub(v3(ray.origin))) / along;
  return t < 0 ? null : v3(ray.origin).addScaledVector(d, t);
}

// Distance along the line (from `point`, in its units) where the ray passes closest.
export function rayLine(ray, point, direction) {
  const dir = v3(direction).normalize();
  const rd = v3(ray.direction).normalize();
  const w0 = v3(point).sub(v3(ray.origin));
  const b = dir.dot(rd);
  const denom = 1 - b * b;
  if (denom < 1e-6) return null; // looking straight down the line
  return (b * rd.dot(w0) - dir.dot(w0)) / denom;
}

// What dragging a part does: a free part moves in the plane facing the viewer through the
// grabbed point; a mated part slides the way its mate allows.
//   → { kind: 'free' | 'contact' | 'axis', point, normal | dir, u, w }
export function dragFrame(mate, targetPlacement, grabPoint, viewDirection) {
  if (!mate) return { kind: 'free', point: grabPoint, normal: viewDirection };
  const frame = faceFrame(mate.target.geometry, targetPlacement);
  if (mate.type === 'contact') {
    return { kind: 'contact', point: frame.point.toArray(), normal: frame.dir.toArray(), u: frame.u.toArray(), w: frame.w.toArray() };
  }
  return { kind: 'axis', point: frame.point.toArray(), dir: frame.dir.toArray() };
}

// Where the pointer is in a drag frame: a point (free), [u, v] mm (contact), mm (axis).
export function dragPosition(frame, ray) {
  if (frame.kind === 'axis') {
    const s = rayLine(ray, frame.point, frame.dir);
    return s === null ? null : s * 1000;
  }
  const hit = rayPlane(ray, frame.point, frame.normal);
  if (!hit) return null;
  if (frame.kind === 'free') return hit.toArray();
  const offset = hit.sub(v3(frame.point));
  return [offset.dot(v3(frame.u)) * 1000, offset.dot(v3(frame.w)) * 1000];
}

export const snapMm = (mm, fine = false) => {
  const step = fine ? 0.1 : 1;
  return Number((Math.round(mm / step) * step).toFixed(4));
};

// Turn a free part by `degrees` about one of the assembly's axes (through its own origin).
export function turned(placement, axis, degrees) {
  const q = new Quaternion().setFromAxisAngle(v3(axis).normalize(), (degrees * Math.PI) / 180).multiply(quat(placement.quaternion));
  return place(v3(placement.position), q);
}

// Turn a mate's part over (face against face ⇄ facing the same way; pin pointing the other
// way along the axis): half a turn about a direction across the target face.
export function flippedRelative(mate) {
  const along = mate.target.geometry.type === 'cylinder' ? mate.target.geometry.axis : mate.target.geometry.normal;
  const [u] = basisOf(along);
  // Turning about u in the target's frame, about the moving face's point, so it stays put:
  // the solve re-anchors the point, so only the orientation changes here.
  return arr(new Quaternion().setFromAxisAngle(u, Math.PI).multiply(quat(mate.relative)).normalize());
}

// Bounding box of a part's points after placing it: for laying new parts out side by side.
export function placedBounds(box, placement) {
  const corners = [];
  for (const x of [box.min[0], box.max[0]])
    for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) corners.push(pointToWorld(placement, [x, y, z]));
  const min = [0, 1, 2].map((k) => Math.min(...corners.map((c) => c.getComponent(k))));
  const max = [0, 1, 2].map((k) => Math.max(...corners.map((c) => c.getComponent(k))));
  return { min, max };
}

// A placement as CAD sees it (mm, Z up): turn `angle` degrees about `axis` through the
// origin, then move by `translation`. For writing STEP assemblies.
export function cadTransform(placement) {
  const q = quat(placement.quaternion).normalize();
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const angle = (2 * Math.acos(Math.min(1, q.w)) * 180) / Math.PI;
  const s = Math.sqrt(Math.max(0, 1 - q.w * q.w));
  // The axis in CAD terms: viewer (x, y, z) → CAD (x, −z, y). No turn: any axis will do.
  const axis = s < 1e-9 ? [0, 0, 1] : [q.x / s, -q.z / s, q.y / s];
  return {
    rotation: { angle: round(angle, 6), axis: axis.map((v) => round(v, 9) + 0) },
    translation: toCadMm(placement.position),
  };
}

// CAD (mm, Z up) ⇄ assembly (metres, Y up), for the panel's position fields.
export const toCadMm = ([x, y, z]) => [x * 1000, -z * 1000, y * 1000].map((v) => round(v, 3) + 0);
export const fromCadMm = ([x, y, z]) => [x / 1000, z / 1000, -y / 1000];
// The CAD X, Y and Z axes in the assembly's frame.
export const CAD_AXES = { x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] };
