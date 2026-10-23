import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { requireAdmin, requireVerified } from './auth/middleware.js';
import { pool } from './db.js';
import { runWithView } from './domain/context.js';
import { errorHandler, notFound } from './errors.js';
import { fromAcceptLanguage, runWithLang } from './i18n/index.js';
import { logger } from './logger.js';
import { adminRouter } from './routes/admin.js';
import { attachmentsRouter } from './routes/attachments.js';
import { authRouter } from './routes/auth.js';
import { commonRouter } from './routes/common.js';
import { contentRouter } from './routes/content.js';
import { eventsRouter, templateInstantiateRouter } from './routes/events.js';
import { liveRouter } from './routes/live.js';
import { meRouter } from './routes/me.js';
import { newsRouter } from './routes/news.js';
import { supportRouter } from './routes/support.js';
import { tr } from './i18n/index.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind the frontend proxy and Traefik: trust the forwarded client IP for rate limits.
  app.set('trust proxy', true);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-origin' } }));
  app.use(compression());
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' || (req.url?.endsWith('/locations') ?? false) },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    }),
  );
  app.use(express.json({ limit: '2.5mb' }));
  app.use(cookieParser());
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    // Messages in the app's language (sent by the frontend on every call).
    runWithLang(fromAcceptLanguage(req.get('accept-language')), () => runWithView(req.get('x-airsofthub-view') === 'player', next));
  });

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api/news', newsRouter);
  app.use('/api/support', supportRouter);
  app.use('/api/admin', requireAdmin, adminRouter);
  app.use('/api', commonRouter);
  app.use('/api', templateInstantiateRouter);
  app.use('/api/events', requireVerified, eventsRouter, contentRouter, liveRouter, attachmentsRouter);

  app.use('/api', (_req, _res, next) => next(notFound(tr`Unknown API route.`, 'unknown_route')));
  app.use(errorHandler);
  return app;
}
