// A Postgres just for this project: data in .pgdata/, port 5433, loopback only,
// no password. Uses whatever Postgres programs are installed; touches nothing else.
//
//   npm run db:start   create (first time) + start, create databases, write apps/api/.env, migrate
//   npm run db:stop
//   npm run db:status

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const ROOT = join(import.meta.dirname, '..');
const DATA_DIR = join(ROOT, '.pgdata');
const PORT = 5433;
const USER = 'holocad';
const DATABASES = ['holocad', 'holocad_test'];
const ENV_FILE = join(ROOT, 'apps/api/.env');
const ENV_EXAMPLE = join(ROOT, 'apps/api/.env.example');

const urlFor = (db) => `postgres://${USER}@127.0.0.1:${PORT}/${db}`;

function findBinDir() {
  const onPath = spawnSync('sh', ['-c', 'command -v pg_ctl'], { encoding: 'utf8' }).stdout.trim();
  if (onPath) return join(onPath, '..');
  const candidates = [];
  for (const base of ['/Library/PostgreSQL', '/opt/homebrew/opt', '/usr/local/opt', '/usr/lib/postgresql']) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base).sort().reverse()) {
      candidates.push(join(base, entry, 'bin'));
    }
  }
  candidates.push('/Applications/Postgres.app/Contents/Versions/latest/bin');
  const found = candidates.find((dir) => existsSync(join(dir, 'pg_ctl')));
  if (!found) {
    throw new Error(
      'Could not find PostgreSQL (pg_ctl). Install it (e.g. `brew install postgresql@18`) and try again.',
    );
  }
  return found;
}

function run(bin, args) {
  execFileSync(join(findBinDir(), bin), args, { stdio: 'inherit' });
}

function isRunning() {
  const result = spawnSync(join(findBinDir(), 'pg_ctl'), ['-D', DATA_DIR, 'status'], { encoding: 'utf8' });
  return result.status === 0;
}

async function createDatabases() {
  const client = new pg.Client({ connectionString: urlFor('postgres') });
  await client.connect();
  try {
    for (const name of DATABASES) {
      const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [name]);
      if (rowCount === 0) {
        await client.query(`create database ${name}`);
        console.log(`created database ${name}`);
      }
    }
  } finally {
    await client.end();
  }
}

// Writes apps/api/.env only if it doesn't exist, so a hand-edited one is never overwritten.
function writeEnvFile() {
  if (existsSync(ENV_FILE)) {
    console.log('apps/api/.env already exists; left unchanged.');
    return;
  }
  copyFileSync(ENV_EXAMPLE, ENV_FILE);
  const env = readFileSync(ENV_FILE, 'utf8')
    .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${urlFor('holocad')}`)
    .replace(/^DATABASE_URL_TEST=.*$/m, `DATABASE_URL_TEST=${urlFor('holocad_test')}`);
  writeFileSync(ENV_FILE, env);
  console.log('wrote apps/api/.env pointing at the local database');
}

async function migrate() {
  const { createPool } = await import('../apps/api/src/db/pool.js');
  const { migrate: applyMigrations } = await import('../apps/api/src/db/migrate.js');
  const pool = createPool(urlFor('holocad'));
  try {
    await applyMigrations(pool);
  } finally {
    await pool.end();
  }
}

async function start() {
  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) {
    console.log(`initialising a new database cluster in .pgdata/ (port ${PORT})`);
    run('initdb', ['-D', DATA_DIR, '-U', USER, '-A', 'trust', '-E', 'UTF8']);
  }
  if (isRunning()) {
    console.log('local database is already running');
  } else {
    // TCP on loopback only; no Unix socket, so nothing depends on path length.
    run('pg_ctl', [
      '-D',
      DATA_DIR,
      '-l',
      join(DATA_DIR, 'server.log'),
      '-o',
      `-p ${PORT} -c listen_addresses=127.0.0.1 -c unix_socket_directories=''`,
      '-w',
      'start',
    ]);
  }
  await createDatabases();
  writeEnvFile();
  await migrate();
  console.log(`\nLocal database ready at ${urlFor('holocad')}`);
}

function stop() {
  if (!isRunning()) return console.log('local database is not running');
  run('pg_ctl', ['-D', DATA_DIR, '-m', 'fast', 'stop']);
}

function status() {
  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) return console.log('no local database yet; run `npm run db:start`');
  console.log(isRunning() ? `running on 127.0.0.1:${PORT}` : 'stopped');
}

const command = process.argv[2];
try {
  if (command === 'start') await start();
  else if (command === 'stop') stop();
  else if (command === 'status') status();
  else console.log('usage: node scripts/local-db.mjs start|stop|status');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
