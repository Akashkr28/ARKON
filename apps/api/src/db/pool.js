import pg from 'pg';

export function createPool(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  // An idle client losing its connection (e.g. Postgres restarted) shouldn't crash the API.
  pool.on('error', (error) => console.error('Postgres idle client error:', error.message));
  return pool;
}
