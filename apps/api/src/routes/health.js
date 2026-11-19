import { Router } from 'express';

export function healthRouter({ db }) {
  const router = Router();

  router.get('/health', async (req, res) => {
    const database = await db.query('select 1').then(
      () => 'up',
      () => 'down',
    );
    // TODO(step b): report the converter's health too.
    const ok = database === 'up';
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', database });
  });

  return router;
}
