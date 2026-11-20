import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { tempStorage } from './helpers.js';

const converterUp = { health: async () => 'up' };

describe('database outages', () => {
  const unreachableDb = {
    query: async () => {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5433'), { code: 'ECONNREFUSED' });
    },
  };

  it('answers 503 with a hint instead of a generic 500', async () => {
    const { storage, cleanup } = await tempStorage();
    try {
      const app = createApp({ db: unreachableDb, converter: converterUp, storage, maxUploadBytes: 1024 });
      const res = await request(app).get('/api/models');
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/database is not reachable.*db:start/);
    } finally {
      await cleanup();
    }
  });

  it('still answers 500 for unexpected errors', async () => {
    const { storage, cleanup } = await tempStorage();
    const brokenDb = {
      query: async () => {
        throw new Error('column "nope" does not exist');
      },
    };
    try {
      const app = createApp({ db: brokenDb, converter: converterUp, storage, maxUploadBytes: 1024 });
      const original = console.error;
      console.error = () => {}; // the handler logs unexpected errors; keep test output clean
      let res;
      try {
        res = await request(app).get('/api/models');
      } finally {
        console.error = original;
      }
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Something went wrong on the server');
    } finally {
      await cleanup();
    }
  });
});

describe('health limits', () => {
  it('tells the web app the upload size limit', async () => {
    const workingDb = { query: async () => ({ rows: [] }) };
    const { storage, cleanup } = await tempStorage();
    try {
      const app = createApp({ db: workingDb, converter: converterUp, storage, maxUploadBytes: 5 * 1024 * 1024 });
      const res = await request(app).get('/api/health');
      expect(res.body.limits).toEqual({ maxUploadBytes: 5 * 1024 * 1024 });
    } finally {
      await cleanup();
    }
  });
});

describe('startup cleanup', () => {
  let cleanup;
  afterEach(() => cleanup?.());

  it('removes half-received uploads and half-written GLBs, and nothing else', async () => {
    const temp = await tempStorage();
    cleanup = temp.cleanup;
    const { storage } = temp;
    await writeFile(join(storage.tmpDir, 'abc'), 'partial upload');
    await mkdir(join(storage.tmpDir, 'nested'));
    await writeFile(storage.absolute('models/x.glb.partial'), 'half');
    await writeFile(storage.absolute('models/x.glb'), 'complete');
    await writeFile(storage.absolute('uploads/x.step'), 'source');

    const removed = await storage.removeLeftovers();

    expect(removed.sort()).toEqual(['models/x.glb.partial', 'tmp/abc', 'tmp/nested']);
    expect(await readdir(storage.tmpDir)).toEqual([]);
    expect(await readdir(storage.absolute('models'))).toEqual(['x.glb']);
    expect(await readdir(storage.absolute('uploads'))).toEqual(['x.step']);
  });
});
