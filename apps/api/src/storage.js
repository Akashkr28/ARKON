import { mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

// Files live under one root, shared with the converter. The database stores paths
// relative to it ("uploads/<id>.step", "models/<id>.glb"), never absolute ones.
export function createStorage(root) {
  const tmpDir = join(root, 'tmp');

  async function init() {
    for (const dir of ['uploads', 'models', 'tmp']) {
      await mkdir(join(root, dir), { recursive: true });
    }
  }

  // Leftovers from a crash: half-received uploads in tmp/ and half-written GLBs
  // (*.partial) from the converter. Safe at startup, when nothing is in flight.
  async function removeLeftovers() {
    const removed = [];
    for (const name of await readdir(tmpDir)) {
      await rm(join(tmpDir, name), { recursive: true, force: true });
      removed.push(`tmp/${name}`);
    }
    for (const name of await readdir(join(root, 'models'))) {
      if (!name.endsWith('.partial')) continue;
      await rm(join(root, 'models', name), { force: true });
      removed.push(`models/${name}`);
    }
    return removed;
  }

  function absolute(relative) {
    const full = resolve(root, relative);
    if (!full.startsWith(root + sep)) throw new Error(`Path escapes storage root: ${relative}`);
    return full;
  }

  async function moveIn(fromAbsolute, relative) {
    await rename(fromAbsolute, absolute(relative));
  }

  async function remove(relative) {
    if (relative) await rm(absolute(relative), { force: true });
  }

  return {
    root,
    tmpDir,
    init,
    removeLeftovers,
    absolute,
    moveIn,
    remove,
    uploadPath: (id, extension) => `uploads/${id}.${extension}`,
    glbPath: (id) => `models/${id}.glb`,
  };
}

export async function readHead(path, length = 64) {
  const file = await open(path, 'r');
  try {
    const { buffer, bytesRead } = await file.read(Buffer.alloc(length), 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}
