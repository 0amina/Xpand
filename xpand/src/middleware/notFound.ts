import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../utils/AppError.js';

/**
 * Catch-all for unmatched routes. Registered after all real routes, it turns "no route
 * matched" into a proper 404 AppError and hands it to the global error handler, so 404s
 * flow through the same response envelope as every other error.
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}
