import type { NextFunction, Request, Response, RequestHandler } from 'express';

/**
 * Wraps an async route handler so any rejected promise is forwarded to Express's error
 * pipeline via `next(err)`. Express 4 does not catch rejections from async handlers on its
 * own, so without this a thrown/awaited error inside a controller would hang the request.
 *
 * Usage (later, in module routes):
 *   router.get('/', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
