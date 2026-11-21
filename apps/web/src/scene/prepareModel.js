import { Box3, Group, Sphere, Vector3 } from 'three';
import { VIEW } from '../config';

const FALLBACK_DIRECTION = new Vector3(0, 1, 0);

// GLTFLoader rewrites names ("Base plate" → "Base_plate", duplicates get "_1") but
// keeps the original in userData.name. A multi-material part is a group of meshes,
// so fall back to the parent's name.
function partName(mesh, index) {
  return (
    mesh.userData.name ||
    mesh.parent?.userData.name ||
    mesh.name ||
    mesh.parent?.name ||
    `Part ${index + 1}`
  );
}

const nodeName = (node) => node.userData.name || node.name || null;

// The named assembly nodes above a part, outermost first (e.g. [Sentinel Mk I,
// Left arm] for a gauntlet). Group ids only need to be unique while this model is open.
function assemblyPath(mesh, content, partNameValue) {
  const path = [];
  for (let node = mesh.parent; node && node !== content; node = node.parent) {
    const name = nodeName(node);
    // A multi-material part is a named group of unnamed meshes; that group IS the
    // part, not an assembly level above it.
    const isThePartItself = node === mesh.parent && !nodeName(mesh) && name === partNameValue;
    if (name && !isThePartItself) path.unshift({ id: `group-${node.id}`, name });
  }
  return path;
}

// For one mesh, work out how far (in its parent's local space) it should move
// when the model is exploded by a factor of 1.
function computeExplodeOffset(mesh, worldCenter, radius) {
  const direction = worldCenter.clone();
  if (direction.lengthSq() < 1e-8) direction.copy(FALLBACK_DIRECTION);
  direction.normalize();

  // Parents may be scaled/rotated, so convert both endpoints into the parent's
  // space and take the difference rather than transforming the direction.
  const toParent = mesh.parent.matrixWorld.clone().invert();
  const from = worldCenter.clone().applyMatrix4(toParent);
  const to = worldCenter.clone().addScaledVector(direction, radius).applyMatrix4(toParent);
  return to.sub(from);
}

// Clones a loaded glTF scene, centres it, normalises its size, and gathers
// per-part data for exploding and picking.
export function prepareModel(gltfScene) {
  const content = gltfScene.clone(true);
  const root = new Group();
  root.add(content);

  const bounds = new Box3().setFromObject(content);
  const sphere = bounds.getBoundingSphere(new Sphere());
  const unitScale = VIEW.modelRadius / (sphere.radius || 1);
  content.position.sub(sphere.center);
  root.scale.setScalar(unitScale);
  root.updateMatrixWorld(true);

  const meshes = [];
  content.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });

  const parts = meshes.map((mesh, index) => {
    const id = `part-${index}`;
    mesh.userData.partId = id;

    const worldBounds = new Box3().setFromObject(mesh);
    const worldCenter = worldBounds.getCenter(new Vector3());
    const size = worldBounds.getSize(new Vector3()).divideScalar(unitScale);
    const name = partName(mesh, index);

    return {
      id,
      mesh,
      basePosition: mesh.position.clone(),
      explodeOffset: computeExplodeOffset(mesh, worldCenter, VIEW.modelRadius),
      pull: new Vector3(), // current world-space pull, animated toward the store value
      originalMaterial: mesh.material,
      info: {
        id,
        name,
        path: assemblyPath(mesh, content, name),
        vertexCount: mesh.geometry.attributes.position?.count ?? 0,
        size: size.toArray().map((v) => Number(v.toFixed(3))),
      },
    };
  });

  // The viewer shows every model at the same size; this is how to get back to real
  // lengths (metres, per the glTF spec) for dimensions and measurements.
  const metresPerSceneUnit = 1 / unitScale;
  const modelSize = bounds.getSize(new Vector3()).toArray();

  return { root, parts, metresPerSceneUnit, modelSize };
}
