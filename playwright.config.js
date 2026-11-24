// End-to-end tests: real Chrome driving the real app. Playwright starts its own copy
// of the stack (web :5273, API :3201, converter :8201) against the TEST database and
// a throwaway storage folder, so a running `npm run dev` and its data are untouched.
//
//   npm run test:e2e            headless
//   npm run test:e2e -- --ui    watch it run

import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const apiEnv = join(import.meta.dirname, 'apps/api/.env');
if (existsSync(apiEnv)) process.loadEnvFile(apiEnv); // DATABASE_URL_TEST (npm run db:start writes it)

if (!process.env.DATABASE_URL_TEST) {
  throw new Error('End-to-end tests need DATABASE_URL_TEST (run `npm run db:start` first).');
}

const PORTS = { web: 5273, api: 3201, converter: 8201 };
const storageDir = join(tmpdir(), 'holocad-e2e-storage');
const shared = { STORAGE_DIR: storageDir };

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000, // the first test of a run includes the dev server warming up
  expect: { timeout: 15_000 },
  fullyParallel: false, // one shared database and server
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORTS.web}`,
    // Fake camera, auto-granted: no permission prompt, no real webcam needed.
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
    permissions: ['camera'],
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: [
    {
      command: `uv run --project services/converter --directory services/converter uvicorn holocad_converter.app:app --host 127.0.0.1 --port ${PORTS.converter}`,
      url: `http://127.0.0.1:${PORTS.converter}/health`,
      env: shared,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'node e2e/reset.mjs && node apps/api/src/server.js',
      url: `http://127.0.0.1:${PORTS.api}/api/health`,
      env: {
        ...shared,
        DATABASE_URL: process.env.DATABASE_URL_TEST,
        API_PORT: String(PORTS.api),
        CONVERTER_URL: `http://127.0.0.1:${PORTS.converter}`,
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${PORTS.web} --strictPort`,
      cwd: 'apps/web',
      url: `http://localhost:${PORTS.web}`,
      env: { HOLOCAD_API_URL: `http://127.0.0.1:${PORTS.api}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
