import { config } from './config.js';
import { createPool } from './db/pool.js';
import { createApp } from './app.js';
import { createConverterClient } from './converterClient.js';
import { createStorage } from './storage.js';
import { createConversionWorker } from './worker.js';

const pool = createPool(config.databaseUrl);
const converter = createConverterClient(config.converterUrl, { timeoutMs: config.conversionTimeoutMs });
const storage = createStorage(config.storageDir);
await storage.init();
const leftovers = await storage.removeLeftovers();
if (leftovers.length) console.log(`Removed ${leftovers.length} leftover file(s) from an earlier run`);

// TODO(scale-out): the worker assumes one API instance. Run it as its own process
// (and drop requeueInterruptedJobs' assumption) before running several.
const worker = createConversionWorker({ db: pool, converter, storage });
const app = createApp({ db: pool, converter, storage, worker, maxUploadBytes: config.maxUploadBytes });

// Loopback only: the web dev server proxies /api here, nothing else should reach it.
const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`HoloCAD API listening on http://127.0.0.1:${config.port} (storage: ${storage.root})`);
  worker.start();
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  // Don't hang forever on a long conversion or open keep-alive connections.
  setTimeout(() => process.exit(1), 5000).unref();
  server.close(() =>
    worker
      .stop()
      .then(() => pool.end())
      .finally(() => process.exit(0)),
  );
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
