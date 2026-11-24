// Linking the viewer's parts to the converter's measured specs, and reading them.
//
// The converter numbers parts by walking the glTF's scene nodes depth-first and
// counting every node that has a mesh (services/converter/holocad_converter/glb.py).
// three.js numbers meshes differently (a node with several primitives becomes several
// meshes), so we link through the glTF node: same JSON, same walk, same numbers.

// glTF node index → spec index.
export function specIndexByNode(json) {
  const byNode = new Map();
  const nodes = json?.nodes ?? [];
  const scene = json?.scenes?.[json.scene ?? 0];
  const visit = (nodeIndex) => {
    const node = nodes[nodeIndex];
    if (!node) return;
    if (node.mesh !== undefined) byNode.set(nodeIndex, byNode.size);
    for (const child of node.children ?? []) visit(child);
  };
  for (const root of scene?.nodes ?? []) visit(root);
  return byNode;
}

// Marks every object that is a glTF mesh node with `userData.specIndex`. Runs on the
// loaded original (the loader's associations point at it); clones copy userData.
export function tagSpecIndices(gltf) {
  const byNode = specIndexByNode(gltf.parser?.json);
  gltf.scene.traverse((object) => {
    const node = gltf.parser?.associations?.get(object)?.nodes;
    if (node !== undefined && byNode.has(node)) object.userData.specIndex = byNode.get(node);
  });
}

// A mesh is either the node itself or one primitive inside the node's group.
export function specIndexOf(mesh) {
  return mesh.userData.specIndex ?? mesh.parent?.userData.specIndex ?? null;
}

// Mass from a volume (mm³) and a density (kg/m³).
export function massKg(volumeMm3, density) {
  if (!volumeMm3 || !density) return null;
  return volumeMm3 * 1e-9 * density;
}

// Copies of one part (four brake discs) share a key, so a material picked for one
// applies to all of them.
export function productKey(spec, fallbackName) {
  return spec?.productName ?? fallbackName;
}

// The material a part is shown with: the user's pick, else the CAD file's.
export function effectiveMaterial(spec, override) {
  if (override) return { ...override, source: 'picked' };
  if (spec?.material?.densityKgM3) {
    return { name: spec.material.name ?? 'From CAD file', density: spec.material.densityKgM3, source: 'file' };
  }
  if (spec?.material?.name) return { name: spec.material.name, density: null, source: 'file' };
  return null;
}

// Totals over several parts. Parts without a known mass are counted, not guessed.
export function selectionTotals(entries) {
  let mass = 0;
  let volume = 0;
  let withMass = 0;
  let withVolume = 0;
  for (const { spec, material } of entries) {
    if (spec?.volumeMm3) {
      volume += spec.volumeMm3;
      withVolume += 1;
    }
    const kg = massKg(spec?.volumeMm3, material?.density);
    if (kg !== null) {
      mass += kg;
      withMass += 1;
    }
  }
  return {
    count: entries.length,
    massKg: withMass ? mass : null,
    volumeMm3: withVolume ? volume : null,
    missingMass: entries.length - withMass,
  };
}
