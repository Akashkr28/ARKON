import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { createStorage, facesPath } from '../src/storage.js';
import { ConverterError } from '../src/converterClient.js';

export const testDatabaseUrl = process.env.DATABASE_URL_TEST;

export async function freshTestDatabase() {
  const pool = createPool(testDatabaseUrl);
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(pool, { log: () => {} });
  return pool;
}

export async function tempStorage() {
  const root = await mkdtemp(join(tmpdir(), 'holocad-test-'));
  const storage = createStorage(root);
  await storage.init();
  return { storage, cleanup: () => rm(root, { recursive: true, force: true }) };
}

// A minimal but valid GLB: one root node with two mesh children. No binary chunk;
// the inspection code only reads the JSON.
export function makeGlb({
  parts = [
    { name: 'Part A', triangles: 12 },
    { name: 'Part B', triangles: 4 },
  ],
} = {}) {
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'Assembly', children: parts.map((_, i) => i + 1) },
      ...parts.map((part, i) => ({ name: part.name, mesh: i })),
    ],
    meshes: parts.map((_, i) => ({
      primitives: [{ attributes: { POSITION: i }, indices: parts.length + i, material: 0 }],
    })),
    accessors: [
      ...parts.map((part) => ({ count: part.triangles * 3, type: 'VEC3', componentType: 5126 })),
      ...parts.map((part) => ({ count: part.triangles * 3, type: 'SCALAR', componentType: 5125 })),
    ],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0.5, 0, 1] } }],
  };
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(20);
  header.write('glTF', 0, 'latin1');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + json.length, 8);
  header.writeUInt32LE(json.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, json]);
}

export const STEP_TEXT =
  "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('test'),'2;1');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n";

export const FAKE_FACES = {
  units: { length: 'mm' },
  products: [{ faces: [{ type: 'plane', area: 11200, normal: [0, 1, 0], tri: [0, 0, 2] }], edges: [] }],
  parts: [0],
};

// Stands in for the Python service: writes a GLB where asked, or fails on demand.
export function fakeConverter(storage) {
  const fake = {
    mode: 'ok', // 'ok' | 'bad-file' | 'crash' | 'unreachable'
    calls: [],
    async health() {
      return 'up';
    },
    async convert(request) {
      fake.calls.push(request);
      if (fake.mode === 'bad-file') {
        throw Object.assign(new Error("This doesn't look like a STEP file."), { userFacing: true });
      }
      if (fake.mode === 'crash') throw new Error('converter exploded');
      if (fake.mode === 'unreachable') {
        throw new ConverterError('Converter is not reachable at http://127.0.0.1:8001', { retryable: true });
      }
      const glb = makeGlb({ parts: [{ name: 'Base plate', triangles: 12 }] });
      await writeFile(storage.absolute(request.outputPath), glb);
      await writeFile(storage.absolute(facesPath(request.outputPath)), JSON.stringify(FAKE_FACES));
      return {
        glbBytes: glb.length,
        partCount: 1,
        triangleCount: 12,
        bounds: { min: [0, 0, 0], max: [0.1, 0.05, 0.08], units: 'm' },
        parts: [
          {
            index: 0,
            name: 'Base plate',
            parentName: 'Mini gearbox',
            triangleCount: 12,
            color: '#8c9199',
            spec: { partNumber: 'BP-1001', overallSizeMm: [140, 80, 8], volumeMm3: 89600 },
          },
        ],
      };
    },
  };
  return fake;
}

export const silentLog = { error: () => {}, info: () => {} };
