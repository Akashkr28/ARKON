import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

// Load apps/api/.env (all keys, not just VITE_*) so DATABASE_URL_TEST is available.
export default defineConfig(({ mode }) => ({
  test: {
    env: loadEnv(mode, import.meta.dirname, ''),
    // Database tests share one test database; run files one after another.
    fileParallelism: false,
  },
}));
