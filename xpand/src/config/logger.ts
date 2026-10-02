import { pino, type LoggerOptions } from 'pino';

import { env, isProduction } from './env.js';

/**
 * The shared application logger.
 *
 * In development we pipe through `pino-pretty` for readable, colorized output. In
 * production we emit newline-delimited JSON (pino's default), which log aggregators and
 * platforms parse natively — no pretty transport, which would only add overhead.
 *
 * The `transport` key is added only in non-production. Under `exactOptionalPropertyTypes`
 * we can't set it to `undefined`, so we omit it entirely rather than assign a nullish value.
 */
const options: LoggerOptions = { level: env.LOG_LEVEL };

if (!isProduction) {
  options.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:HH:MM:ss.l',
      ignore: 'pid,hostname',
    },
  };
}

export const logger = pino(options);
