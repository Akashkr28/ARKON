import express from 'express';
import { healthRouter } from './routes/health.js';
import { errorHandler, notFoundHandler } from './errors.js';

// Dependencies are passed in so tests can supply a test database (or a fake).
export function createApp({ db }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', healthRouter({ db }));
  // TODO(step c): model upload / list / file / delete routes.

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
