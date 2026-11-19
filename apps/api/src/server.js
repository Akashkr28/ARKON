import { config } from './config.js';
import { createPool } from './db/pool.js';
import { createApp } from './app.js';

const pool = createPool(config.databaseUrl);
const app = createApp({ db: pool });

// Loopback only: the web dev server proxies /api here, nothing else should reach it.
const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`HoloCAD API listening on http://127.0.0.1:${config.port}`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => pool.end().finally(() => process.exit(0)));
  // Don't hang forever on open keep-alive connections.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
