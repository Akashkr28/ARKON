import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const workingDb = { query: async () => ({ rows: [{ '?column?': 1 }] }) };
const brokenDb = {
  query: async () => {
    throw new Error('connection refused');
  },
};

describe('GET /api/health', () => {
  it('reports ok when the database answers', async () => {
    const res = await request(createApp({ db: workingDb })).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('reports degraded with 503 when the database is down', async () => {
    const res = await request(createApp({ db: brokenDb })).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'degraded', database: 'down' });
  });
});

describe('unknown routes and bad input', () => {
  it('returns a JSON 404 for unknown API routes', async () => {
    const res = await request(createApp({ db: workingDb })).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/GET \/nope/);
  });

  it('returns 400 for malformed JSON bodies', async () => {
    const res = await request(createApp({ db: workingDb }))
      .post('/api/health')
      .set('content-type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not valid JSON/);
  });
});
