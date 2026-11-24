// Throw these from route handlers; the message is safe to show to the client.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
}

// Network errors from the pg driver, plus Postgres codes for "can't log in",
// "database doesn't exist" and "server shutting down".
const DATABASE_UNAVAILABLE = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  '28P01',
  '28000',
  '3D000',
  '57P01',
  '57P03',
]);

export function isDatabaseUnavailable(error) {
  return (
    DATABASE_UNAVAILABLE.has(error?.code) ||
    /Connection terminated|timeout exceeded when trying to connect/i.test(error?.message ?? '')
  );
}

// Express 5 forwards rejected promises from async handlers here.
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, next) {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body is not valid JSON' });
    return;
  }
  if (isDatabaseUnavailable(error)) {
    console.error(`${req.method} ${req.path}: database unavailable (${error.code ?? error.message})`);
    res.status(503).json({ error: 'The database is not reachable. Start it with `npm run db:start`.' });
    return;
  }
  console.error(`${req.method} ${req.path} failed:`, error);
  res.status(500).json({ error: 'Something went wrong on the server' });
}
