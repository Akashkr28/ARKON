import express from 'express';
import { healthRouter } from './routes/health.js';
import { modelsRouter } from './routes/models.js';
import { errorHandler, notFoundHandler } from './errors.js';

// Dependencies are passed in so tests can supply a test database, temp storage
// and a fake converter.
export function createApp({ db, converter, storage, worker, maxUploadBytes }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', healthRouter({ db, converter, limits: { maxUploadBytes } }));
  if (storage) app.use('/api', modelsRouter({ db, storage, worker, maxUploadBytes }));

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
