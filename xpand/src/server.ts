import type { Server } from 'node:http';

import { createApp } from './app.js';
import { SHUTDOWN_GRACE_PERIOD_MS } from './config/constants.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { disconnectPrisma } from './db/prisma.js';
import { shutdownOcr } from './modules/invoices/ocr.js';
import { startBot, stopBot } from './modules/bot/index.js';

/**
 * Entry point: build the app, start listening, and wire up graceful shutdown.
 */
const app = createApp();

const server: Server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV },
    `Xpand backend listening on http://localhost:${env.PORT}`,
  );
});

/**
 * Start the Telegram bot alongside the API.
 *
 * Deliberately not awaited and never fatal: a bad token or a Telegram outage must not stop the
 * HTTP API from serving the Mini App. A failure here is logged and the API carries on without
 * chat commands.
 */
void startBot().catch((err: unknown) => {
  logger.error({ err }, 'Telegram bot failed to start — the API is unaffected');
});

/**
 * Graceful shutdown.
 *
 * On SIGTERM/SIGINT we:
 *   1. Stop accepting new connections (server.close) while letting in-flight requests finish.
 *   2. Close the Prisma connection pool.
 *   3. Exit 0.
 *
 * A hard timeout guards against requests that never drain — after the grace period we force
 * the process down so deploys/restarts aren't held hostage. `isShuttingDown` makes a second
 * signal (e.g. an impatient Ctrl-C) a no-op rather than a double-teardown.
 */
let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, 'Shutdown signal received — draining connections');

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, SHUTDOWN_GRACE_PERIOD_MS);
  // Don't let this timer keep the event loop alive on its own.
  forceExit.unref();

  try {
    // Stop pulling new work in before closing anything the handlers depend on.
    await stopBot();

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    logger.info('HTTP server closed');

    // The Tesseract worker holds a worker thread; leaving it running would stop the process
    // exiting even after the server and the pool are closed.
    await shutdownOcr();
    logger.info('OCR worker released');

    await disconnectPrisma();
    logger.info('Prisma disconnected');

    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Last-resort safety nets: log the fault and shut down cleanly rather than dying silently
// or lingering in a half-broken state.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  void shutdown('uncaughtException');
});
