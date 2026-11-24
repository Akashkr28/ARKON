// Talks to the Python converter service (services/converter) over loopback HTTP.

export class ConverterError extends Error {
  constructor(message, { status, userFacing = false, retryable = false, cause } = {}) {
    super(message, { cause });
    this.status = status;
    // True when the message describes a problem with the user's file and is safe to show.
    this.userFacing = userFacing;
    // True when the converter couldn't be reached at all: try again later, don't fail the job.
    this.retryable = retryable;
  }
}

// The converter speaks snake_case (Python); the rest of the API uses camelCase.
const camel = (key) => key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

export function camelizeKeys(value) {
  if (Array.isArray(value)) return value.map(camelizeKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [camel(k), camelizeKeys(v)]));
  }
  return value;
}

function normalizeResult(body) {
  return {
    glbBytes: body.glb_bytes,
    partCount: body.part_count,
    triangleCount: body.triangle_count,
    bounds: body.bounds ?? null,
    seconds: body.seconds ?? null,
    parts: (body.parts ?? []).map((part) => ({
      index: part.index,
      name: part.name,
      parentName: part.parent_name ?? null,
      triangleCount: part.triangle_count,
      color: part.color ?? null,
      spec: part.spec ? camelizeKeys(part.spec) : null,
    })),
  };
}

export function createConverterClient(baseUrl, { timeoutMs = 10 * 60_000 } = {}) {
  async function health() {
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1500) });
      return res.ok ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  // Paths are relative to STORAGE_DIR, which both services share.
  async function convert({ inputPath, outputPath, quality }) {
    let res;
    try {
      res = await fetch(`${baseUrl}/convert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input_path: inputPath, output_path: outputPath, quality }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error.name === 'TimeoutError') {
        const minutes = Math.round(timeoutMs / 60_000);
        throw new ConverterError(
          `Conversion took longer than ${minutes} minute${minutes === 1 ? '' : 's'}. ` +
            'Try DRAFT quality, or split the assembly into smaller files.',
          { userFacing: true, cause: error },
        );
      }
      throw new ConverterError(`Converter is not reachable at ${baseUrl}`, { retryable: true, cause: error });
    }

    const body = await res.json().catch(() => ({}));
    if (res.ok) return normalizeResult(body);
    // 422 = the converter understood the request but the file itself is the problem.
    const detail = typeof body.detail === 'string' ? body.detail : `HTTP ${res.status}`;
    throw new ConverterError(detail, { status: res.status, userFacing: res.status === 422 });
  }

  return { health, convert };
}
