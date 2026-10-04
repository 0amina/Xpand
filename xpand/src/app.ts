import cors from 'cors';
import express, { type Application, type Request, type Response } from 'express';
import helmet from 'helmet';

// Side-effect import: installs BigInt JSON serialization before any response is sent.
import './utils/serialization.js';

import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFound.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { requestLogger } from './middleware/requestLogger.js';
import { WEBHOOK_PATH, botWebhookHandler } from './modules/bot/index.js';
import { categoriesRouter } from './modules/categories/routes.js';
import { invoicesRouter } from './modules/invoices/routes.js';
import { packagingRouter } from './modules/packaging/routes.js';
import { productsRouter } from './modules/products/routes.js';
import { reportsRouter } from './modules/reports/routes.js';
import { suppliersRouter } from './modules/suppliers/routes.js';
import { transactionsRouter } from './modules/transactions/routes.js';
import { usersRouter } from './modules/users/routes.js';

/**
 * Builds and configures the Express application. Kept separate from `server.ts` so the app
 * can be constructed without binding a port — useful later for integration tests.
 *
 * Middleware order matters and is intentional:
 *   1. helmet            — set security headers before anything else runs.
 *   2. cors              — resolve cross-origin access next.
 *   3. requestLogger     — attach a per-request logger early so downstream logs are correlated.
 *   4. body parsers      — make JSON/urlencoded bodies available to handlers.
 *   5. rateLimiter       — throttle before doing real work.
 *   6. routes            — health check now; feature modules later.
 *   7. notFound + error  — catch-alls, always last.
 */
export function createApp(): Application {
  const app = express();

  // Behind Telegram's infrastructure / a reverse proxy, trust the first proxy hop so client
  // IPs (used by the rate limiter) and protocol are read from X-Forwarded-* headers.
  app.set('trust proxy', 1);

  app.use(helmet());

  app.use(
    cors({
      // Whitelist from env. If the list is empty, no cross-origin browser is allowed.
      origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false,
      credentials: true,
    }),
  );

  app.use(requestLogger);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  /**
   * Telegram webhook (only live when BOT_MODE=webhook).
   *
   * Mounted before the rate limiter on purpose: Telegram bursts updates from its own IPs, and
   * throttling them would silently drop user commands. The route is protected instead by the
   * secret token grammy verifies on every call.
   *
   * The handler is resolved per-request rather than at mount time because the bot is started
   * after the app is built — this way neither has to wait for the other. Resolving it is async
   * so that on a serverless host, where nothing ran `startBot()`, the first update can initialise
   * the bot itself instead of finding no handler and 404-ing every command.
   *
   * A failure to resolve is a 500 rather than a crash: Telegram retries a 5xx, so a cold start
   * that could not reach `getMe` loses nothing.
   */
  app.post(WEBHOOK_PATH, (req, res, next) => {
    void (async () => {
      let handler;
      try {
        handler = await botWebhookHandler();
      } catch (err) {
        next(err);
        return;
      }

      if (!handler) {
        res.status(404).json({ error: { message: 'Webhook mode is not enabled', statusCode: 404 } });
        return;
      }
      await handler(req, res, next);
    })();
  });

  app.use(rateLimiter);

  /**
   * Liveness/health probe. Intentionally does not touch the database — it answers "is the
   * process up and serving?", which is what orchestrators and uptime checks need.
   */
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Feature module routers.
  app.use('/api/users', usersRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/suppliers', suppliersRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/packaging', packagingRouter);
  app.use('/api/invoices', invoicesRouter);

  // Anything that fell through the routes above is a 404 → funnel into the error handler.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
