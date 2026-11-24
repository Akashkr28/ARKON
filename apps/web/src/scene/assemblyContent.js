// The geometry behind each part of an assembly: a design built by the CAD engine, or a
// model file (bundled or uploaded) loaded like the viewer loads it. Kept out of the store
// (three.js objects); the store only says what's loading and what's ready.

import { Box3, Group } from 'three';
import { buildInWorker } from '../cad/cadClient';
import { resolveFeatures, resolveParameters } from '../cad/parameters';
import { findModelEntry } from '../models/catalog';
import { primitiveIndexOf } from '../models/partFaces';
import { specIndexOf, tagSpecIndices } from '../models/partSpecs';
import { facesUrl, specsUrl } from '../actions/specActions';
import { massKg } from '../models/partSpecs';
import { designObject } from './designObject';
import { loadOnce } from './useModelFile';

const builds = new Map(); // features JSON -> Promise<part> (same design twice: built once)
const facesDocs = new Map(); // modelId -> Promise<faces doc | null>
const objects = new Map(); // componentId -> { key, object, box }

function facesDoc(modelId) {
  if (!facesDocs.has(modelId)) {
    const url = facesUrl(findModelEntry(modelId));
    const promise = url
      ? fetch(url)
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null)
      : Promise.resolve(null);
    facesDocs.set(modelId, promise);
  }
  return facesDocs.get(modelId);
}

// The converter's face data for a part of a model, if it has any (synchronous: loaded
// with the part).
const loadedFaces = new Map(); // modelId -> faces doc
export const facesFor = (modelId) => loadedFaces.get(modelId) ?? null;

// A model's mass from its converter specs: parts with a known material and volume.
// → { massKg (null: none known), partsWithoutMass }
async function modelMass(modelId) {
  const url = specsUrl(findModelEntry(modelId));
  if (!url) return { massKg: null, partsWithoutMass: null };
  try {
    const res = await fetch(url);
    if (!res.ok) return { massKg: null, partsWithoutMass: null };
    const body = await res.json();
    let total = 0;
    let known = 0;
    let missing = 0;
    for (const part of body.parts ?? []) {
      const kg = massKg(part.spec?.volumeMm3, part.spec?.material?.densityKgM3);
      if (kg === null) missing += 1;
      else {
        total += kg;
        known += 1;
      }
    }
    return { massKg: known ? total : null, partsWithoutMass: missing };
  } catch {
    return { massKg: null, partsWithoutMass: null };
  }
}

async function designContent(design, name) {
  const { values } = resolveParameters(design.parameters);
  const { features } = resolveFeatures(design.features, values);
  const key = JSON.stringify(features);
  if (!builds.has(key)) {
    const promise = buildInWorker(features, { keep: false }).then(({ part }) => {
      if (!part) throw new Error('This design has nothing to build');
      return part;
    });
    promise.catch(() => builds.delete(key));
    builds.set(key, promise);
  }
  const part = await builds.get(key);
  const object = designObject(part, name);
  object.name = ''; // the assembly names the part; no second level of the same name
  return { object, info: { volumeMm3: part.properties.volumeMm3, sizeMm: part.properties.sizeMm } };
}

async function modelContent(modelId) {
  const entry = findModelEntry(modelId);
  if (!entry) throw new Error('This model is no longer in the library');
  const [gltf, faces, mass] = await Promise.all([loadOnce(entry.url), facesDoc(modelId), modelMass(modelId)]);
  if (faces) loadedFaces.set(modelId, faces);
  tagSpecIndices(gltf);
  const object = gltf.scene.clone(true);
  // Face lookups go through userData.assemblyFace. The viewer's own spec links
  // (userData.specIndex) belong to the model open in VIEW, so they're taken off here.
  const meshes = [];
  object.traverse((child) => child.isMesh && meshes.push(child));
  for (const mesh of meshes) {
    const specIndex = specIndexOf(mesh);
    if (specIndex !== null) mesh.userData.assemblyFace = { modelId, specIndex, primitive: primitiveIndexOf(mesh) };
  }
  object.traverse((child) => delete child.userData.specIndex);
  // Its own materials, so painting this part never touches the loaded model's (shared with
  // the viewer and other copies).
  for (const mesh of meshes) {
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
  }
  return { object, info: mass };
}

// → { object, box: { min, max } (metres, the part's own frame), info: { volumeMm3 (designs),
//   massKg / partsWithoutMass (models, from their specs), sizeMm } }
export async function loadContent(component) {
  const { source } = component;
  const key = source.kind === 'design' ? JSON.stringify(source.design.features) + JSON.stringify(source.design.parameters) : source.modelId;
  const cached = objects.get(component.id);
  if (cached?.key === key) return cached;
  const { object, info } =
    source.kind === 'design' ? await designContent(source.design, component.name) : await modelContent(source.modelId);
  const bounds = new Box3().setFromObject(object);
  const box = bounds.isEmpty() ? { min: [0, 0, 0], max: [0, 0, 0] } : { min: bounds.min.toArray(), max: bounds.max.toArray() };
  const [sx, sy, sz] = bounds.isEmpty() ? [0, 0, 0] : bounds.getSize(bounds.min.clone()).toArray();
  const sizeMm = info.sizeMm ?? [sx * 1000, sz * 1000, sy * 1000]; // X × Y × Z, Z up
  const entry = { key, object, box, info: { ...info, sizeMm } };
  objects.set(component.id, entry);
  return entry;
}

export const contentOf = (componentId) => objects.get(componentId) ?? null;

// The assembly as one three.js scene: a group per part (userData.componentId), placed.
// Parts still loading are left out. Copies share geometry and materials with the loaded
// parts (an object has one parent, and this may be built more than once).
export function assemblyScene(components, placements, name = '') {
  const root = new Group();
  root.name = name;
  for (const component of components) {
    const content = contentOf(component.id);
    if (!content) continue;
    const node = new Group();
    node.name = component.name;
    node.userData.componentId = component.id;
    const placement = placements[component.id] ?? component;
    node.position.fromArray(placement.position);
    node.quaternion.fromArray(placement.quaternion);
    node.add(content.object.clone());
    root.add(node);
  }
  return root;
}

export function forgetContent(componentId) {
  objects.delete(componentId);
}
