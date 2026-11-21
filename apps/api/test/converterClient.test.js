import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { ConverterError, createConverterClient } from '../src/converterClient.js';

// A tiny stand-in for the Python service, so these tests don't need it running.
let server;
let baseUrl;
const responses = {
  '/health': [200, { status: 'ok' }],
  'good.step': [
    200,
    {
      glb_bytes: 4500,
      part_count: 1,
      triangle_count: 12,
      bounds: { min: [0, 0, 0], max: [1, 1, 1], units: 'm' },
      parts: [
        {
          index: 0,
          name: 'Base plate',
          parent_name: 'Gearbox',
          triangle_count: 12,
          color: '#8c9199',
          spec: { part_number: 'BP-1001', volume_mm3: 89600, features: { holes: [{ diameter: 8, depth: 8, count: 4 }] } },
        },
      ],
    },
  ],
  'bad.step': [422, { detail: "This doesn't look like a STEP file." }],
  'boom.step': [500, { detail: 'internal' }],
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const key = req.url === '/health' ? '/health' : JSON.parse(body).input_path;
      if (key === 'slow.step') return; // never answer
      const [status, payload] = responses[key];
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server.closeAllConnections(); // the "slow" request is still open
  return new Promise((resolve) => server.close(resolve));
});

describe('converter client', () => {
  it('reports health', async () => {
    expect(await createConverterClient(baseUrl).health()).toBe('up');
    expect(await createConverterClient('http://127.0.0.1:9').health()).toBe('down');
  });

  it('returns the conversion result in camelCase', async () => {
    const result = await createConverterClient(baseUrl).convert({
      inputPath: 'good.step',
      outputPath: 'models/x.glb',
      quality: 'standard',
    });
    expect(result).toEqual({
      glbBytes: 4500,
      partCount: 1,
      triangleCount: 12,
      bounds: { min: [0, 0, 0], max: [1, 1, 1], units: 'm' },
      seconds: null,
      parts: [
        {
          index: 0,
          name: 'Base plate',
          parentName: 'Gearbox',
          triangleCount: 12,
          color: '#8c9199',
          spec: { partNumber: 'BP-1001', volumeMm3: 89600, features: { holes: [{ diameter: 8, depth: 8, count: 4 }] } },
        },
      ],
    });
  });

  it('marks file problems (422) as safe to show the user', async () => {
    const attempt = createConverterClient(baseUrl).convert({ inputPath: 'bad.step', outputPath: 'x.glb' });
    await expect(attempt).rejects.toMatchObject({
      message: "This doesn't look like a STEP file.",
      userFacing: true,
    });
  });

  it('keeps server errors internal', async () => {
    const attempt = createConverterClient(baseUrl).convert({ inputPath: 'boom.step', outputPath: 'x.glb' });
    await expect(attempt).rejects.toMatchObject({ status: 500, userFacing: false });
  });

  it('marks an unreachable converter as retryable', async () => {
    const attempt = createConverterClient('http://127.0.0.1:9').convert({ inputPath: 'a', outputPath: 'b' });
    await expect(attempt).rejects.toBeInstanceOf(ConverterError);
    await expect(attempt).rejects.toMatchObject({ retryable: true, userFacing: false });
    await expect(attempt).rejects.toThrow(/not reachable/);
  });

  it('turns a timeout into advice for the user', async () => {
    const attempt = createConverterClient(baseUrl, { timeoutMs: 1 }).convert({
      inputPath: 'slow.step',
      outputPath: 'x.glb',
    });
    await expect(attempt).rejects.toMatchObject({ userFacing: true, retryable: false });
    await expect(attempt).rejects.toThrow(/took longer than .* DRAFT quality/);
  });
});
