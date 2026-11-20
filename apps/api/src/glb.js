import { open } from 'node:fs/promises';

// Lists the parts of an uploaded GLB the same way the converter does for STEP
// (services/converter/holocad_converter/glb.py): every node with a mesh,
// depth-first in scene order, which is how the viewer traverses it.

const JSON_CHUNK = 0x4e4f534a;
const MAX_JSON_BYTES = 64 * 1024 * 1024;

export class GlbError extends Error {}

async function readGltfJson(path) {
  const file = await open(path, 'r');
  try {
    const header = Buffer.alloc(20);
    await file.read(header, 0, 20, 0);
    if (header.toString('latin1', 0, 4) !== 'glTF') throw new GlbError('Not a GLB file');
    const chunkLength = header.readUInt32LE(12);
    if (header.readUInt32LE(16) !== JSON_CHUNK) throw new GlbError('GLB has no JSON chunk');
    if (chunkLength > MAX_JSON_BYTES) throw new GlbError('GLB JSON chunk is unreasonably large');
    const json = Buffer.alloc(chunkLength);
    await file.read(json, 0, chunkLength, 20);
    return JSON.parse(json.toString('utf8'));
  } catch (error) {
    if (error instanceof GlbError) throw error;
    throw new GlbError(`GLB could not be read: ${error.message}`);
  } finally {
    await file.close();
  }
}

function triangleCount(gltf, mesh) {
  let total = 0;
  for (const primitive of mesh.primitives ?? []) {
    const accessor = gltf.accessors?.[primitive.indices ?? primitive.attributes?.POSITION];
    total += Math.floor((accessor?.count ?? 0) / 3);
  }
  return total;
}

function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

function materialHex(gltf, materialIndex) {
  const factor = gltf.materials?.[materialIndex]?.pbrMetallicRoughness?.baseColorFactor;
  if (!factor) return null;
  return `#${factor
    .slice(0, 3)
    .map((c) => Math.round(linearToSrgb(c) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

export async function inspectGlb(path) {
  const gltf = await readGltfJson(path);
  const nodes = gltf.nodes ?? [];
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const parts = [];
  const visited = new Set();

  function visit(index, parentName) {
    const node = nodes[index];
    if (!node || visited.has(index)) return; // malformed files can contain cycles
    visited.add(index);
    const name = node.name || null;
    if (node.mesh !== undefined) {
      const mesh = gltf.meshes?.[node.mesh] ?? { primitives: [] };
      parts.push({
        index: parts.length,
        name: name ?? mesh.name ?? `Part ${parts.length + 1}`,
        parentName,
        triangleCount: triangleCount(gltf, mesh),
        color: materialHex(gltf, mesh.primitives?.[0]?.material),
      });
    }
    for (const child of node.children ?? []) visit(child, name ?? parentName);
  }

  for (const root of scene?.nodes ?? []) visit(root, null);
  return {
    parts,
    partCount: parts.length,
    triangleCount: parts.reduce((sum, p) => sum + p.triangleCount, 0),
  };
}
