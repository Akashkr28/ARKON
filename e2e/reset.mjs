// Runs before the end-to-end API starts: a clean test database and empty storage,
// so every run begins from the same state. Never touches the dev database.
import { rm } from 'node:fs/promises';
import { createPool } from '../apps/api/src/db/pool.js';
import { migrate } from '../apps/api/src/db/migrate.js';

const url = process.env.DATABASE_URL;
if (!url || !url.includes('test')) {
  console.error(`Refusing to reset "${url}": end-to-end tests only use a *test* database.`);
  process.exit(1);
}

const pool = createPool(url);
try {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(pool, { log: () => {} });
} finally {
  await pool.end();
}
await rm(process.env.STORAGE_DIR, { recursive: true, force: true });
console.log('e2e: test database and storage reset');
