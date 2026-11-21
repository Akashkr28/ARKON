// SQL for models, parts and conversion jobs. `db` is a pool or a transaction client.

const MODEL_COLUMNS = `
  id, name, original_filename, source_format, source_path, source_bytes, status, error,
  glb_path, glb_bytes, part_count, triangle_count, bounds, created_at, updated_at
`;

export async function insertModel(db, model) {
  const { rows } = await db.query(
    `insert into models (id, name, original_filename, source_format, source_path, source_bytes,
                         status, glb_path, glb_bytes, part_count, triangle_count)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning ${MODEL_COLUMNS}`,
    [
      model.id,
      model.name,
      model.originalFilename,
      model.sourceFormat,
      model.sourcePath,
      model.sourceBytes,
      model.status,
      model.glbPath ?? null,
      model.glbBytes ?? null,
      model.partCount ?? null,
      model.triangleCount ?? null,
    ],
  );
  return rows[0];
}

export async function replaceParts(db, modelId, parts) {
  await db.query('delete from model_parts where model_id = $1', [modelId]);
  if (parts.length === 0) return;
  await db.query(
    `insert into model_parts (model_id, part_index, name, parent_name, triangle_count, color, spec)
     select $1, * from unnest($2::int[], $3::text[], $4::text[], $5::int[], $6::text[], $7::jsonb[])`,
    [
      modelId,
      parts.map((p) => p.index),
      parts.map((p) => p.name),
      parts.map((p) => p.parentName ?? null),
      parts.map((p) => p.triangleCount),
      parts.map((p) => p.color ?? null),
      parts.map((p) => (p.spec ? JSON.stringify(p.spec) : null)),
    ],
  );
}

export async function enqueueConversion(db, modelId, quality) {
  await db.query(`update models set status = 'queued', error = null where id = $1`, [modelId]);
  const { rows } = await db.query(
    `insert into conversion_jobs (model_id, quality) values ($1, $2) returning id`,
    [modelId, quality],
  );
  return rows[0].id;
}

export async function listModels(db, { limit = 100 } = {}) {
  const { rows } = await db.query(
    `select ${MODEL_COLUMNS} from models order by created_at desc, id limit $1`,
    [limit],
  );
  return rows;
}

export async function findModel(db, id) {
  const { rows } = await db.query(`select ${MODEL_COLUMNS} from models where id = $1`, [id]);
  return rows[0] ?? null;
}

// Kept out of findParts: specs can run to a few KB per part, and only the spec sheet needs them.
export async function findPartSpecs(db, modelId) {
  const { rows } = await db.query(
    `select part_index, name, spec from model_parts where model_id = $1 order by part_index`,
    [modelId],
  );
  return rows;
}

export async function findParts(db, modelId) {
  const { rows } = await db.query(
    `select part_index, name, parent_name, triangle_count, color
     from model_parts where model_id = $1 order by part_index`,
    [modelId],
  );
  return rows;
}

export async function findLatestJob(db, modelId) {
  const { rows } = await db.query(
    `select id, status, quality, attempts, created_at, started_at, finished_at
     from conversion_jobs where model_id = $1 order by created_at desc, id desc limit 1`,
    [modelId],
  );
  return rows[0] ?? null;
}

export async function deleteModel(db, id) {
  const { rows } = await db.query(
    `delete from models where id = $1 returning source_path, glb_path`,
    [id],
  );
  return rows[0] ?? null;
}

// --- Worker ------------------------------------------------------------------

// Takes the oldest queued job. SKIP LOCKED lets several workers share the queue
// without ever taking the same job twice.
export async function claimNextJob(db) {
  const { rows } = await db.query(
    `update conversion_jobs
     set status = 'running', attempts = attempts + 1, started_at = now()
     where id = (
       select id from conversion_jobs
       where status = 'queued'
       order by created_at, id
       for update skip locked
       limit 1
     )
     returning id, model_id, quality`,
  );
  return rows[0] ?? null;
}

export async function markConverting(db, modelId) {
  const { rows } = await db.query(
    `update models set status = 'converting', error = null where id = $1 returning source_path`,
    [modelId],
  );
  return rows[0] ?? null;
}

// Returns false if the model was deleted while it was being converted.
export async function completeConversion(db, { jobId, modelId, glbPath, result }) {
  const { rowCount } = await db.query(
    `update models
     set status = 'ready', error = null, glb_path = $2, glb_bytes = $3,
         part_count = $4, triangle_count = $5, bounds = $6
     where id = $1`,
    [modelId, glbPath, result.glbBytes, result.partCount, result.triangleCount, result.bounds],
  );
  if (rowCount === 0) return false;
  await replaceParts(db, modelId, result.parts);
  await finishJob(db, jobId, 'done', null);
  return true;
}

export async function failConversion(db, { jobId, modelId, userMessage, detail }) {
  await db.query(`update models set status = 'failed', error = $2 where id = $1`, [
    modelId,
    userMessage,
  ]);
  await finishJob(db, jobId, 'failed', detail);
}

export async function finishJob(db, jobId, status, error) {
  await db.query(
    `update conversion_jobs set status = $2, error = $3, finished_at = now() where id = $1`,
    [jobId, status, error],
  );
}

// Puts a claimed job back in the queue without counting it as an attempt
// (used when the converter wasn't reachable, which isn't the job's fault).
export async function requeueJob(db, { jobId, modelId }) {
  await db.query(
    `update conversion_jobs
     set status = 'queued', started_at = null, attempts = greatest(attempts - 1, 0)
     where id = $1`,
    [jobId],
  );
  await db.query(`update models set status = 'queued' where id = $1 and status = 'converting'`, [modelId]);
}

// After a crash or restart, jobs left "running" will never finish; put them back.
// Only safe while a single API instance runs the worker.
export async function requeueInterruptedJobs(db) {
  const { rowCount } = await db.query(
    `update conversion_jobs set status = 'queued', started_at = null where status = 'running'`,
  );
  await db.query(`update models set status = 'queued' where status = 'converting'`);
  return rowCount;
}
