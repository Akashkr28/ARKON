import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

const testUrl = process.env.DATABASE_URL_TEST;

// Needs a real Postgres. Set DATABASE_URL_TEST in apps/api/.env to run it.
describe.skipIf(!testUrl)('migrations (against DATABASE_URL_TEST)', () => {
  let pool;

  beforeAll(async () => {
    pool = createPool(testUrl);
    // Start from a clean schema so the test exercises every migration.
    await pool.query('drop schema public cascade; create schema public;');
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('creates the tables, and running again is a no-op', async () => {
    const applied = [];
    await migrate(pool, { log: (line) => applied.push(line) });
    expect(applied).toEqual(['applied 001_initial.sql', 'applied 002_part_specs.sql']);

    const again = [];
    await migrate(pool, { log: (line) => again.push(line) });
    expect(again).toEqual([]);

    const { rows } = await pool.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' order by table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'conversion_jobs',
      'model_parts',
      'models',
      'schema_migrations',
    ]);
  });

  it('keeps updated_at current on model updates', async () => {
    const { rows: [model] } = await pool.query(
      `insert into models (name, original_filename, source_format, source_path, source_bytes)
       values ('Test', 'test.step', 'step', 'uploads/x.step', 10)
       returning id, updated_at`,
    );
    await new Promise((r) => setTimeout(r, 20));
    const { rows: [updated] } = await pool.query(
      `update models set status = 'converting' where id = $1 returning updated_at`,
      [model.id],
    );
    expect(updated.updated_at.getTime()).toBeGreaterThan(model.updated_at.getTime());
  });
});
