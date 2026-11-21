import { Box3, EdgesGeometry, Matrix4, Raycaster, Sphere, Vector2, Vector3 } from 'three';
import { MEASURE } from '../config';
import { isPickable } from './picking';

// Measurement snapping, CAD-style: corners first, then edges, then any point on a
// surface. "Edges" are feature edges (where faces meet at a real angle), not the
// triangle edges of the tessellation, which would be meaningless to snap to.

const raycaster = new Raycaster();
const pointerNdc = new Vector2();
const hits = [];
const edgeCache = new WeakMap(); // geometry -> Float32Array of segment endpoints (local)

const a = new Vector3();
const b = new Vector3();
const world = new Vector3();
const projected = new Vector3();
const best = new Vector3();

function featureEdges(geometry) {
  let positions = edgeCache.get(geometry);
  if (!positions) {
    const edges = new EdgesGeometry(geometry, MEASURE.featureEdgeAngleDeg);
    positions = edges.attributes.position.array;
    edges.dispose();
    edgeCache.set(geometry, positions);
  }
  return positions;
}

function toScreen(point, camera, size, out) {
  projected.copy(point).project(camera);
  out.x = ((projected.x + 1) / 2) * size.width;
  out.y = ((1 - projected.y) / 2) * size.height;
  return out;
}

// Closest point on segment [p, q] (screen space) to c, as a 0..1 parameter.
function segmentParameter(p, q, c) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-9) return 0;
  return Math.min(1, Math.max(0, ((c.x - p.x) * dx + (c.y - p.y) * dy) / lengthSq));
}

const screenA = new Vector2();
const screenB = new Vector2();
const screenOnEdge = new Vector2();
const cursor = new Vector2();

// meshById: part id -> mesh. `size` must stay current (pass the R3F size object).
export function createSceneQueries({ root, content, group, camera, size, meshById }) {
  function visibleHit(screenX, screenY) {
    pointerNdc.set((screenX / size.width) * 2 - 1, 1 - (screenY / size.height) * 2);
    raycaster.setFromCamera(pointerNdc, camera);
    hits.length = 0;
    raycaster.intersectObject(root, true, hits);
    return hits.find(isPickable) ?? null;
  }

  function snapAt(screenX, screenY) {
    const hit = visibleHit(screenX, screenY);
    if (!hit) return null;
    const mesh = hit.object;
    cursor.set(screenX, screenY);

    // Candidates behind the surface under the cursor are hidden from view; ignore
    // them (with some slack, since a corner sits right on the surface's border).
    const slack = hit.distance * 0.02;
    const planes = mesh.material.clippingPlanes ?? [];
    const reachable = (point) =>
      point.distanceTo(camera.position) <= hit.distance + slack &&
      !planes.some((plane) => plane.distanceToPoint(point) < -1e-6); // not cut away

    const edges = featureEdges(mesh.geometry);
    let kind = 'face';
    let bestPixels = Infinity;
    best.copy(hit.point);

    // Corners: feature-edge endpoints.
    for (let i = 0; i < edges.length; i += 3) {
      world.set(edges[i], edges[i + 1], edges[i + 2]).applyMatrix4(mesh.matrixWorld);
      const pixels = toScreen(world, camera, size, screenA).distanceTo(cursor);
      if (pixels < MEASURE.snapVertexPx && pixels < bestPixels && reachable(world)) {
        bestPixels = pixels;
        best.copy(world);
        kind = 'vertex';
      }
    }

    // Edges, only if no corner was close enough.
    if (kind === 'face') {
      for (let i = 0; i < edges.length; i += 6) {
        a.set(edges[i], edges[i + 1], edges[i + 2]).applyMatrix4(mesh.matrixWorld);
        b.set(edges[i + 3], edges[i + 4], edges[i + 5]).applyMatrix4(mesh.matrixWorld);
        toScreen(a, camera, size, screenA);
        toScreen(b, camera, size, screenB);
        const t = segmentParameter(screenA, screenB, cursor);
        const pixels = screenOnEdge.copy(screenA).lerp(screenB, t).distanceTo(cursor);
        if (pixels < MEASURE.snapEdgePx && pixels < bestPixels) {
          world.copy(a).lerp(b, t); // screen interpolation ≈ world for short segments
          if (!reachable(world)) continue;
          bestPixels = pixels;
          best.copy(world);
          kind = 'edge';
        }
      }
    }

    return {
      partId: mesh.userData.partId,
      local: mesh.worldToLocal(best.clone()).toArray(),
      metres: content.worldToLocal(best.clone()).toArray(),
      kind,
    };
  }

  function partsBounds(partIds) {
    const ids = new Set(partIds);
    // Boxed in the group's own space, so neither the answer nor its tightness depends on
    // how the model is turned (or where it is mid-animation).
    const box = new Box3();
    const partBox = new Box3();
    const toGroup = new Matrix4();
    const groupInverse = new Matrix4().copy(group.matrixWorld).invert();
    root.updateWorldMatrix(true, true);
    root.traverse((object) => {
      if (!object.isMesh || !object.visible || !ids.has(object.userData.partId)) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      toGroup.multiplyMatrices(groupInverse, object.matrixWorld);
      box.union(partBox.copy(object.geometry.boundingBox).applyMatrix4(toGroup));
    });
    if (box.isEmpty()) return null;
    const sphere = box.getBoundingSphere(new Sphere());
    return { center: sphere.center.toArray(), radius: sphere.radius };
  }

  function worldPointOf(point, out) {
    const mesh = meshById.get(point.partId);
    return mesh ? out.fromArray(point.local).applyMatrix4(mesh.matrixWorld) : null;
  }

  return { snapAt, partsBounds, worldPointOf };
}
