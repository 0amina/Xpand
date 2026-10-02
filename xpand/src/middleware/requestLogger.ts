import { pinoHttp } from 'pino-http';

import { logger } from '../config/logger.js';

/**
 * HTTP request logger. Reuses the shared pino instance so app logs and request logs share
 * one stream and formatting. pino-http attaches a child logger to each request as `req.log`
 * and emits a completion line with method, url, status, and response time.
 */
export const requestLogger = pinoHttp({
  logger,
  // Downgrade the noise: 4xx are client problems (warn), 5xx are ours (error), else info.
  customLogLevel(_req, res, err) {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
