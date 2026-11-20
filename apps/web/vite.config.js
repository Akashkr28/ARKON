import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// The MediaPipe wasm on the CDN must match the installed JS exactly. Resolve the
// package wherever npm workspaces put it (usually the repo-root node_modules).
const require = createRequire(import.meta.url);
const mediapipeDir = dirname(require.resolve('@mediapipe/tasks-vision'));
const mediapipeVersion = JSON.parse(readFileSync(join(mediapipeDir, 'package.json'))).version;

// 127.0.0.1 rather than localhost: on macOS "localhost" may resolve to ::1 first,
// and the API only listens on IPv4 loopback.
const apiTarget = process.env.HOLOCAD_API_URL ?? 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  define: { __MEDIAPIPE_VERSION__: JSON.stringify(mediapipeVersion) },
  // three is imported by drei, R3F, postprocessing and our own loader; keep one copy.
  resolve: { dedupe: ['three'] },
  optimizeDeps: { include: ['three', 'three/examples/jsm/loaders/GLTFLoader.js'] },
  server: {
    port: 5173,
    proxy: { '/api': apiTarget },
  },
});
