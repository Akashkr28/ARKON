import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createConversionWorker } from '../src/worker.js';
import {
  STEP_TEXT,
  fakeConverter,
  freshTestDatabase,
  makeGlb,
  silentLog,
  tempStorage,
  testDatabaseUrl,
} from './helpers.js';

// supertest only buffers known text types; collect binary responses ourselves.
function binaryParser(res, done) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
}

// Needs a real Postgres. Set DATABASE_URL_TEST in apps/api/.env to run it.
describe.skipIf(!testDatabaseUrl)('models API (against DATABASE_URL_TEST)', () => {
  let pool;
  let storage;
  let cleanupStorage;
  let converter;
  let worker;
  let app;

  beforeAll(async () => {
    pool = await freshTestDatabase();
    ({ storage, cleanup: cleanupStorage } = await tempStorage());
    converter = fakeConverter(storage);
    worker = createConversionWorker({ db: pool, converter, storage, log: silentLog });
    app = createApp({ db: pool, converter, storage, worker, maxUploadBytes: 64 * 1024 });
  });

  afterAll(async () => {
    await pool?.end();
    await cleanupStorage?.();
  });

  beforeEach(async () => {
    await pool.query('truncate models cascade');
    for (const dir of ['uploads', 'models', 'tmp']) {
      await rm(storage.absolute(dir), { recursive: true, force: true });
    }
    await storage.init();
    converter.mode = 'ok';
    converter.calls.length = 0;
  });

  const uploadStep = (name = 'gearbox.step', fields = {}) => {
    const req = request(app).post('/api/models');
    for (const [key, value] of Object.entries(fields)) req.field(key, value);
    return req.attach('file', Buffer.from(STEP_TEXT), name);
  };

  describe('uploading a STEP file', () => {
    it('queues it, converts it, and serves the GLB', async () => {
      const upload = await uploadStep('Mini Gearbox.step', { quality: 'draft' });
      expect(upload.status).toBe(201);
      expect(upload.body).toMatchObject({
        name: 'Mini Gearbox',
        originalFilename: 'Mini Gearbox.step',
        sourceFormat: 'step',
        status: 'queued',
        fileUrl: null,
      });
      const { id } = upload.body;

      expect(await worker.processNext()).toBe(true);
      expect(converter.calls).toEqual([
        { inputPath: `uploads/${id}.step`, outputPath: `models/${id}.glb`, quality: 'draft' },
      ]);

      const detail = await request(app).get(`/api/models/${id}`);
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({
        status: 'ready',
        partCount: 1,
        triangleCount: 12,
        bounds: { units: 'm' },
        fileUrl: `/api/models/${id}/file`,
        parts: [{ index: 0, name: 'Base plate', parentName: 'Mini gearbox', triangleCount: 12, color: '#8c9199' }],
        job: { status: 'done', quality: 'draft', attempts: 1 },
      });

      const file = await request(app).get(`/api/models/${id}/file`).buffer(true).parse(binaryParser);
      expect(file.status).toBe(200);
      expect(file.headers['content-type']).toBe('model/gltf-binary');
      expect(file.body.subarray(0, 4).toString()).toBe('glTF');
    });

    it('accepts .stp and a custom name', async () => {
      const res = await uploadStep('PART.STP', { name: '  Pump housing  ' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Pump housing');
    });

    it('says the file is not ready before conversion finishes', async () => {
      const { body } = await uploadStep();
      const res = await request(app).get(`/api/models/${body.id}/file`);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/queued/);
    });

    it('records a bad file with the converter’s message', async () => {
      converter.mode = 'bad-file';
      const { body } = await uploadStep();
      await worker.processNext();
      const res = await request(app).get(`/api/models/${body.id}`);
      expect(res.body).toMatchObject({
        status: 'failed',
        error: "This doesn't look like a STEP file.",
        job: { status: 'failed' },
      });
    });

    it('hides internal converter errors behind a generic message', async () => {
      converter.mode = 'crash';
      const { body } = await uploadStep();
      await worker.processNext();
      const res = await request(app).get(`/api/models/${body.id}`);
      expect(res.body.status).toBe('failed');
      expect(res.body.error).toMatch(/server problem/);
      expect(res.body.error).not.toMatch(/exploded/);
    });

    it('can retry a failed conversion at another quality', async () => {
      converter.mode = 'crash';
      const { body } = await uploadStep();
      await worker.processNext();

      converter.mode = 'ok';
      const retry = await request(app).post(`/api/models/${body.id}/retry`).send({ quality: 'fine' });
      expect(retry.status).toBe(202);
      expect(retry.body.status).toBe('queued');
      await worker.processNext();

      const res = await request(app).get(`/api/models/${body.id}`);
      expect(res.body).toMatchObject({ status: 'ready', error: null, job: { quality: 'fine' } });
    });

    it('refuses to retry while a conversion is pending', async () => {
      const { body } = await uploadStep();
      const res = await request(app).post(`/api/models/${body.id}/retry`).send({});
      expect(res.status).toBe(409);
    });
  });

  describe('uploading a GLB', () => {
    it('is ready immediately, with parts read from the file', async () => {
      const res = await request(app)
        .post('/api/models')
        .attach('file', makeGlb(), 'scan.glb');
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ sourceFormat: 'glb', status: 'ready', partCount: 2, triangleCount: 16 });

      const detail = await request(app).get(`/api/models/${res.body.id}`);
      expect(detail.body.parts.map((p) => [p.name, p.parentName, p.color])).toEqual([
        ['Part A', 'Assembly', '#ffbc00'],
        ['Part B', 'Assembly', '#ffbc00'],
      ]);
      expect(detail.body.job).toBeNull();
      expect(await worker.processNext()).toBe(false); // nothing to convert
    });

    it('cannot be "re-converted"', async () => {
      const { body } = await request(app).post('/api/models').attach('file', makeGlb(), 'a.glb');
      const res = await request(app).post(`/api/models/${body.id}/retry`).send({});
      expect(res.status).toBe(409);
    });
  });

  describe('rejecting bad uploads', () => {
    async function expectRejected(res, status, message) {
      expect(res.status).toBe(status);
      expect(res.body.error).toMatch(message);
      // Nothing left behind: no rows, no stray files.
      expect((await pool.query('select count(*)::int as n from models')).rows[0].n).toBe(0);
      expect(await readdir(storage.tmpDir)).toEqual([]);
      expect(await readdir(storage.absolute('uploads'))).toEqual([]);
    }

    it('needs a file', async () => {
      await expectRejected(await request(app).post('/api/models').field('name', 'x'), 400, /field named "file"/);
    });

    it('rejects unsupported extensions', async () => {
      const res = await request(app).post('/api/models').attach('file', Buffer.from('hi'), 'model.obj');
      await expectRejected(res, 400, /Only \.step, \.stp and \.glb/);
    });

    it('rejects files whose contents do not match the extension', async () => {
      const res = await request(app).post('/api/models').attach('file', Buffer.from('MZ fake exe'), 'model.step');
      await expectRejected(res, 400, /doesn't look like a STEP file/);
    });

    it('rejects a fake GLB', async () => {
      const res = await request(app).post('/api/models').attach('file', Buffer.from(STEP_TEXT), 'model.glb');
      await expectRejected(res, 400, /doesn't look like a GLB/);
    });

    it('rejects a GLB with a corrupt JSON chunk', async () => {
      const glb = makeGlb();
      glb.write('{{{{', 20, 'latin1');
      const res = await request(app).post('/api/models').attach('file', glb, 'broken.glb');
      await expectRejected(res, 400, /GLB could not be read/);
    });

    it('rejects files over the size limit with 413', async () => {
      const big = Buffer.concat([Buffer.from(STEP_TEXT), Buffer.alloc(70 * 1024, 0x20)]);
      const res = await request(app).post('/api/models').attach('file', big, 'big.step');
      await expectRejected(res, 413, /larger than/);
    });

    it('validates the quality field', async () => {
      await expectRejected(await uploadStep('a.step', { quality: 'ultra' }), 400, /quality/);
    });
  });

  describe('listing and deleting', () => {
    it('lists newest first', async () => {
      await uploadStep('first.step');
      await uploadStep('second.step');
      const res = await request(app).get('/api/models');
      expect(res.status).toBe(200);
      expect(res.body.models.map((m) => m.name)).toEqual(['second', 'first']);
    });

    it('deletes the row and its files', async () => {
      const { body } = await uploadStep();
      await worker.processNext();
      const source = storage.absolute(`uploads/${body.id}.step`);
      const glb = storage.absolute(`models/${body.id}.glb`);
      expect(existsSync(source) && existsSync(glb)).toBe(true);

      expect((await request(app).delete(`/api/models/${body.id}`)).status).toBe(204);
      expect(existsSync(source) || existsSync(glb)).toBe(false);
      expect((await request(app).get(`/api/models/${body.id}`)).status).toBe(404);
    });

    it('answers 404 for unknown and malformed ids', async () => {
      expect((await request(app).get('/api/models/00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await request(app).get('/api/models/not-a-uuid')).status).toBe(404);
      expect((await request(app).delete('/api/models/not-a-uuid')).status).toBe(404);
    });
  });

  describe('worker resilience', () => {
    it('re-queues jobs interrupted by a restart', async () => {
      const { body } = await uploadStep();
      await pool.query(`update conversion_jobs set status = 'running'`);
      await pool.query(`update models set status = 'converting'`);

      const restarted = createConversionWorker({ db: pool, converter, storage, log: silentLog });
      await restarted.start();
      await restarted.stop();

      const res = await request(app).get(`/api/models/${body.id}`);
      expect(res.body.status).toBe('ready'); // re-queued and converted by the restarted worker
    });

    it('cleans up when a model is deleted mid-conversion', async () => {
      const { body } = await uploadStep();
      const original = converter.convert;
      converter.convert = async (req) => {
        const result = await original(req);
        await pool.query('delete from models where id = $1', [body.id]);
        return result;
      };
      try {
        await worker.processNext();
      } finally {
        converter.convert = original;
      }
      expect(existsSync(storage.absolute(`models/${body.id}.glb`))).toBe(false);
    });

    it('wakes up immediately for a new upload', async () => {
      const live = createConversionWorker({ db: pool, converter, storage, log: silentLog, idlePollMs: 60_000 });
      const liveApp = createApp({ db: pool, converter, storage, worker: live, maxUploadBytes: 64 * 1024 });
      await live.start();
      try {
        const { body } = await request(liveApp).post('/api/models').attach('file', Buffer.from(STEP_TEXT), 'w.step');
        let status;
        for (let i = 0; i < 50 && status !== 'ready'; i++) {
          await new Promise((r) => setTimeout(r, 20));
          status = (await request(liveApp).get(`/api/models/${body.id}`)).body.status;
        }
        expect(status).toBe('ready'); // well before the 60 s idle poll
      } finally {
        await live.stop();
      }
    });
  });
});
