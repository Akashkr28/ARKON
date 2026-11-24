import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../errors.js';
import { GlbError, inspectGlb } from '../glb.js';
import { withTransaction } from '../db/transaction.js';
import {
  deleteModel,
  enqueueConversion,
  findLatestJob,
  findModel,
  findParts,
  findPartSpecs,
  insertModel,
  listModels,
  replaceParts,
} from '../models/modelQueries.js';
import { jobJson, modelJson, partJson } from '../models/modelJson.js';
import { createUploadMiddleware, defaultModelName, detectFormat } from '../models/upload.js';

const Quality = z.enum(['draft', 'standard', 'fine']);
const UploadFields = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  quality: Quality.default('standard'),
});
const RetryBody = z.object({ quality: Quality.optional() }).default({});
const ModelId = z.uuid();

function parseOrThrow(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HttpError(400, `${issue.path.join('.') || 'body'}: ${issue.message}`);
  }
  return result.data;
}

export function modelsRouter({ db, storage, worker, maxUploadBytes }) {
  const router = Router();
  const upload = createUploadMiddleware({ storage, maxBytes: maxUploadBytes });

  async function loadModelOr404(id) {
    // A malformed id can't exist; answer 404 rather than letting Postgres reject it.
    const model = ModelId.safeParse(id).success ? await findModel(db, id) : null;
    if (!model) throw new HttpError(404, 'Model not found');
    return model;
  }

  async function storeGlb({ id, name, file, sourcePath }) {
    let inspection;
    try {
      inspection = await inspectGlb(storage.absolute(sourcePath));
    } catch (error) {
      if (error instanceof GlbError) throw new HttpError(400, error.message);
      throw error;
    }
    return withTransaction(db, async (tx) => {
      const row = await insertModel(tx, {
        id,
        name,
        originalFilename: file.originalname,
        sourceFormat: 'glb',
        sourcePath,
        sourceBytes: file.size,
        status: 'ready',
        glbPath: sourcePath, // an uploaded GLB is its own viewable file
        glbBytes: file.size,
        partCount: inspection.partCount,
        triangleCount: inspection.triangleCount,
      });
      await replaceParts(tx, id, inspection.parts);
      return row;
    });
  }

  async function storeStep({ id, name, file, sourcePath, quality }) {
    return withTransaction(db, async (tx) => {
      const row = await insertModel(tx, {
        id,
        name,
        originalFilename: file.originalname,
        sourceFormat: 'step',
        sourcePath,
        sourceBytes: file.size,
        status: 'queued',
      });
      await enqueueConversion(tx, id, quality);
      return row;
    });
  }

  router.post('/models', upload, async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Attach the CAD file in a form field named "file"');
    const file = req.file;
    let sourcePath = null;
    try {
      const fields = parseOrThrow(UploadFields, req.body ?? {});
      const format = await detectFormat(file);
      const id = randomUUID();
      const name = fields.name ?? defaultModelName(file.originalname);
      sourcePath = storage.uploadPath(id, format);
      await storage.moveIn(file.path, sourcePath);

      const row =
        format === 'glb'
          ? await storeGlb({ id, name, file, sourcePath })
          : await storeStep({ id, name, file, sourcePath, quality: fields.quality });
      if (format === 'step') worker?.wake();
      sourcePath = null; // stored successfully; keep the file
      res.status(201).json(modelJson(row));
    } finally {
      await rm(file.path, { force: true }); // tmp copy, if it was never moved
      if (sourcePath) await storage.remove(sourcePath); // moved, but the insert failed
    }
  });

  router.get('/models', async (req, res) => {
    const rows = await listModels(db);
    res.json({ models: rows.map(modelJson) });
  });

  router.get('/models/:id', async (req, res) => {
    const model = await loadModelOr404(req.params.id);
    const [parts, job] = await Promise.all([findParts(db, model.id), findLatestJob(db, model.id)]);
    res.json({ ...modelJson(model), parts: parts.map(partJson), job: jobJson(job) });
  });

  // Engineering data per part (STEP uploads; null for GLB uploads, which carry no CAD data).
  router.get('/models/:id/specs', async (req, res) => {
    const model = await loadModelOr404(req.params.id);
    if (model.status !== 'ready') {
      throw new HttpError(409, `Model is ${model.status}, not ready yet`);
    }
    const rows = await findPartSpecs(db, model.id);
    res.json({
      units: { length: 'mm', area: 'mm2', volume: 'mm3', mass: 'kg', density: 'kg/m3', position: 'm (viewer axes)' },
      parts: rows.map((row) => ({ index: row.part_index, name: row.name, spec: row.spec })),
    });
  });

  // Face and edge data for the viewer's inspector (STEP uploads only; GLBs have no CAD faces).
  router.get('/models/:id/faces', async (req, res) => {
    const model = await loadModelOr404(req.params.id);
    if (model.status !== 'ready') {
      throw new HttpError(409, `Model is ${model.status}, not ready yet`);
    }
    const path = model.source_format === 'step' ? storage.facesPath(model.glb_path) : null;
    if (!path) throw new HttpError(404, 'No face data: GLB uploads carry no CAD faces');
    await new Promise((resolve, reject) => {
      res.sendFile(storage.absolute(path), { headers: { 'Content-Type': 'application/json' } }, (error) => {
        if (!error) return resolve();
        if (error.code === 'ENOENT') {
          return reject(new HttpError(404, 'No face data for this model yet; convert it again to add it'));
        }
        return reject(error);
      });
    });
  });

  router.get('/models/:id/file', async (req, res) => {
    const model = await loadModelOr404(req.params.id);
    if (model.status !== 'ready') {
      throw new HttpError(409, `Model is ${model.status}, not ready to view yet`);
    }
    const safeName = model.name.replace(/[^\w.-]+/g, '_');
    await new Promise((resolve, reject) => {
      res.sendFile(
        storage.absolute(model.glb_path),
        {
          headers: {
            'Content-Type': 'model/gltf-binary',
            'Content-Disposition': `inline; filename="${safeName}.glb"`,
          },
        },
        (error) => {
          if (!error) return resolve();
          if (error.code === 'ENOENT') return reject(new HttpError(404, 'Model file is missing from storage'));
          return reject(error);
        },
      );
    });
  });

  // Re-run conversion: after a failure, or to re-mesh at another quality.
  router.post('/models/:id/retry', async (req, res) => {
    const model = await loadModelOr404(req.params.id);
    const body = parseOrThrow(RetryBody, req.body);
    if (model.source_format !== 'step') throw new HttpError(409, 'Only STEP uploads can be converted again');
    if (model.status === 'queued' || model.status === 'converting') {
      throw new HttpError(409, 'Model is already being converted');
    }
    const previous = await findLatestJob(db, model.id);
    const quality = body.quality ?? previous?.quality ?? 'standard';
    await withTransaction(db, (tx) => enqueueConversion(tx, model.id, quality));
    worker?.wake();
    res.status(202).json(modelJson(await findModel(db, model.id)));
  });

  router.delete('/models/:id', async (req, res) => {
    await loadModelOr404(req.params.id);
    const removed = await deleteModel(db, req.params.id);
    if (removed) {
      await storage.remove(removed.source_path);
      if (removed.glb_path !== removed.source_path) await storage.remove(removed.glb_path);
      await storage.remove(storage.facesPath(removed.glb_path));
    }
    res.status(204).end();
  });

  return router;
}
