import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { isProduction } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import type { ErrorResponse } from '../types/index.js';

/**
 * Global error handler — the last middleware in the stack.
 *
 * Express identifies error-handling middleware by its four-arg signature, so `next` must
 * stay in the list even though it's unused (hence the underscore prefix).
 *
 * Responsibilities:
 *  - Normalize any thrown value into a status code + client-safe message.
 *  - Translate known error shapes (AppError, ZodError) into meaningful responses.
 *  - Never leak internal details (stack, cause) to clients in production.
 *  - Log with severity proportional to the status code.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let statusCode = 500;
  let message = 'Internal server error';
  let details: unknown;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
  } else if (err instanceof ZodError) {
    // Validation failures from Zod schemas become 400s with the field-level issues attached.
    statusCode = 400;
    message = 'Validation failed';
    details = err.issues;
  } else if (err instanceof Error) {
    message = err.message;
  }

  // Log through the per-request logger (falls back to nothing if unavailable). 5xx are our
  // bugs and deserve the full error; 4xx are client mistakes and log at warn.
  const log = req.log;
  if (statusCode >= 500) {
    log?.error({ err }, 'Request failed');
  } else {
    log?.warn({ err: { message, statusCode } }, 'Request rejected');
  }

  // In production, hide the specifics of unexpected 500s from clients.
  if (statusCode >= 500 && isProduction) {
    message = 'Internal server error';
    details = undefined;
  }

  const body: ErrorResponse = {
    error: {
      message,
      statusCode,
      ...(details !== undefined ? { details } : {}),
    },
  };

  res.status(statusCode).json(body);
}
