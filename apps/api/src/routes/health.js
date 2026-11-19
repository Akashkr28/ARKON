import { Router } from 'express';

export function healthRouter({ db, converter }) {
  const router = Router();

  router.get('/health', async (req, res) => {
    const [database, converterStatus] = await Promise.all([
      db.query('select 1').then(
        () => 'up',
        () => 'down',
      ),
      converter.health(),
    ]);
    const ok = database === 'up' && converterStatus === 'up';
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      database,
      converter: converterStatus,
    });
  });

  return router;
}
