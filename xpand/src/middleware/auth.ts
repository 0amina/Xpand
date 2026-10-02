import type { NextFunction, Request, Response } from 'express';

import { env, isProduction } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { findOrCreateFromTelegram } from '../modules/users/service.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { InitDataError, validateInitData } from '../utils/telegramAuth.js';

/**
 * Authentication.
 *
 * Two paths, tried in this order:
 *
 * 1. **Telegram Mini App initData** — `Authorization: tma <initData>`. The string is signed
 *    with a key derived from the bot token, so a valid signature proves the caller is that
 *    Telegram user. This is the real mechanism and the only one available in production.
 *
 * 2. **`x-telegram-id` header (development only)** — the original stub, kept so the frontend
 *    and curl still work in a browser tab where there is no initData. It trusts an unsigned
 *    header, so it is **hard-disabled when NODE_ENV=production**, regardless of configuration.
 *
 * On the initData path the user is created on first contact. Telegram has already vouched for
 * the identity and initData carries the full profile, so requiring a separate `/login` round
 * trip before the first real request would add a hop and buy nothing.
 *
 * Authentication is the *only* gate. There are no roles: anyone who proves they are a Telegram
 * user Xpand knows about may read and write every record. Access is controlled by who is given
 * the bot, not by what the app grants them once they are in — so there is no `requireRole`
 * counterpart to this middleware, and no route returns 403 for lack of permission.
 */

/** Pulls `<initData>` out of an `Authorization: tma <initData>` header. */
function readInitDataHeader(req: Request): string | undefined {
  const header = req.header('authorization');
  if (!header) return undefined;

  const [scheme, ...rest] = header.split(' ');
  // Telegram's convention for this scheme is `tma`; accept it case-insensitively.
  if (scheme?.toLowerCase() !== 'tma') return undefined;

  const value = rest.join(' ').trim();
  return value.length > 0 ? value : undefined;
}

export const requireAuth = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    // --- Path 1: signed Mini App initData ---
    const initData = readInitDataHeader(req);

    if (initData) {
      if (!env.TELEGRAM_BOT_TOKEN) {
        // Someone sent initData but we cannot check it. Never fall through to the dev path
        // here — that would turn a missing token into an auth bypass.
        throw AppError.unauthorized('Server cannot verify Telegram data (no bot token configured)');
      }

      try {
        const { user } = validateInitData(initData, env.TELEGRAM_BOT_TOKEN);
        req.user = await findOrCreateFromTelegram(user);
        return next();
      } catch (err) {
        if (err instanceof InitDataError) {
          // Log the reason for operators; tell the client only that it failed, and how to
          // recover. Distinguishing "forged" from "expired" to the caller aids probing.
          req.log?.warn({ reason: err.reason }, 'initData rejected');
          throw AppError.unauthorized(
            err.reason === 'expired'
              ? 'Your session has expired — please reopen the app.'
              : 'Invalid Telegram session data.',
          );
        }
        throw err;
      }
    }

    // --- Path 2: development header stub ---
    const raw = req.header('x-telegram-id');

    if (isProduction) {
      // Be explicit about *why* rather than emitting a bare 401: in production this header is
      // never accepted, and a caller still sending it is running an outdated client.
      throw AppError.unauthorized(
        raw
          ? 'The x-telegram-id header is not accepted in production. Open the app through Telegram.'
          : 'Missing Telegram authentication.',
      );
    }

    if (!raw) {
      throw AppError.unauthorized(
        'Missing authentication — send `Authorization: tma <initData>` or, in development, `x-telegram-id`.',
      );
    }

    // Reject anything that isn't a plain positive integer before touching BigInt(), which
    // would otherwise throw a SyntaxError on bad input.
    if (!/^\d+$/.test(raw)) {
      throw AppError.unauthorized('x-telegram-id must be a positive integer');
    }

    const user = await prisma.users.findUnique({
      where: { id: BigInt(raw) },
      select: { id: true },
    });

    if (!user) {
      // Unlike the initData path, this identity is unverified — so it must not auto-create.
      // The caller has to go through POST /api/users/login first.
      throw AppError.unauthorized('Unknown user — log in first');
    }

    req.user = { id: user.id };
    next();
  },
);
