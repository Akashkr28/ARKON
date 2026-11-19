// Talks to the Python converter service (services/converter) over loopback HTTP.

export class ConverterError extends Error {
  constructor(message, { status, userFacing = false } = {}) {
    super(message);
    this.status = status;
    // True when the message describes a problem with the user's file and is safe to show.
    this.userFacing = userFacing;
  }
}

// The converter speaks snake_case (Python); the rest of the API uses camelCase.
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
    })),
  };
}

export function createConverterClient(baseUrl) {
  async function health() {
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1500) });
      return res.ok ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  // Paths are relative to STORAGE_DIR, which both services share.
  async function convert({ inputPath, outputPath, quality }, { timeoutMs = 10 * 60_000 } = {}) {
    let res;
    try {
      res = await fetch(`${baseUrl}/convert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input_path: inputPath, output_path: outputPath, quality }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error.name === 'TimeoutError' ? 'timed out' : 'is not reachable';
      throw new ConverterError(`Converter ${reason} at ${baseUrl}`, { cause: error });
    }

    const body = await res.json().catch(() => ({}));
    if (res.ok) return normalizeResult(body);
    // 422 = the converter understood the request but the file itself is the problem.
    const detail = typeof body.detail === 'string' ? body.detail : `HTTP ${res.status}`;
    throw new ConverterError(detail, { status: res.status, userFacing: res.status === 422 });
  }

  return { health, convert };
}
