import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../..');

function readInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) throw new Error(`${name} must be a whole number, got "${raw}"`);
  return value;
}

export const config = {
  // Not plain PORT: dev launchers often set PORT for the web server, and the API
  // would silently pick it up and collide.
  port: readInt('API_PORT', 3001),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://localhost:5432/holocad',
  // Relative paths are resolved from the repo root so web, api and converter agree.
  storageDir: resolve(repoRoot, process.env.STORAGE_DIR ?? 'storage'),
  converterUrl: process.env.CONVERTER_URL ?? 'http://127.0.0.1:8001',
  maxUploadBytes: readInt('MAX_UPLOAD_MB', 200) * 1024 * 1024,
};
