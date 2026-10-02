import type { AuthenticatedUser } from './index.js';

/**
 * Augment Express's Request so handlers can read `req.user` in a type-safe way once auth
 * is wired up. The property is optional because it's only populated on authenticated routes.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- required to merge into Express types.
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
