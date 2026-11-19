// Database rows → API responses (camelCase; bigint counts as numbers).

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

export function modelJson(row) {
  return {
    id: row.id,
    name: row.name,
    originalFilename: row.original_filename,
    sourceFormat: row.source_format,
    status: row.status,
    error: row.error,
    sourceBytes: toNumber(row.source_bytes),
    glbBytes: toNumber(row.glb_bytes),
    partCount: row.part_count,
    triangleCount: row.triangle_count,
    bounds: row.bounds,
    fileUrl: row.status === 'ready' ? `/api/models/${row.id}/file` : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function partJson(row) {
  return {
    index: row.part_index,
    name: row.name,
    parentName: row.parent_name,
    triangleCount: row.triangle_count,
    color: row.color,
  };
}

export function jobJson(row) {
  if (!row) return null;
  return {
    status: row.status,
    quality: row.quality,
    attempts: row.attempts,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}
