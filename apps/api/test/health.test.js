import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const workingDb = { query: async () => ({ rows: [{ '?column?': 1 }] }) };
const brokenDb = {
  query: async () => {
    throw new Error('connection refused');
  },
};
const converterUp = { health: async () => 'up' };
const converterDown = { health: async () => 'down' };

function app({ db = workingDb, converter = converterUp } = {}) {
  return createApp({ db, converter });
}

describe('GET /api/health', () => {
  it('reports ok when the database and converter answer', async () => {
    const res = await request(app()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up', converter: 'up', limits: {} });
  });

  it('reports degraded with 503 when the database is down', async () => {
    const res = await request(app({ db: brokenDb })).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'degraded', database: 'down', converter: 'up' });
  });

  it('reports degraded with 503 when the converter is down', async () => {
    const res = await request(app({ converter: converterDown })).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'degraded', database: 'up', converter: 'down' });
  });
});

describe('unknown routes and bad input', () => {
  it('returns a JSON 404 for unknown API routes', async () => {
    const res = await request(app()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/GET \/nope/);
  });

  it('returns 400 for malformed JSON bodies', async () => {
    const res = await request(app())
      .post('/api/health')
      .set('content-type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not valid JSON/);
  });
});
