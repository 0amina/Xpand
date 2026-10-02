import { InlineKeyboard } from 'grammy';

import { env } from '../../config/env.js';

/**
 * Inline keyboards, in particular the `web_app` buttons that launch the Mini App.
 *
 * Two constraints shape everything here:
 *
 *  - Telegram only accepts **HTTPS** URLs for `web_app` buttons. `http://localhost` is
 *    rejected outright, which is why local testing needs a tunnel (see the bot README).
 *  - `MINI_APP_URL` is optional. When it isn't configured every helper returns `undefined`,
 *    and callers send a text-only reply rather than a broken button. The bot stays useful for
 *    `/balance` and `/today` even before the frontend is deployed anywhere.
 *
 * Deep links are plain **paths** (`/add/expense`). The Mini App uses history routing, and
 * Telegram appends its own `#tgWebAppData=…` fragment which the router ignores. The host
 * serving the frontend must fall back to `index.html` for unknown paths — standard SPA
 * hosting, and what the Vite dev server already does.
 */

/** Absolute Mini App URL for a route, or `undefined` when MINI_APP_URL isn't configured. */
export function miniAppUrl(path = '/'): string | undefined {
  if (!env.MINI_APP_URL) return undefined;
  const base = env.MINI_APP_URL.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export const isMiniAppConfigured = (): boolean => Boolean(env.MINI_APP_URL);

/** A single button opening the Mini App at `path`. */
export function openAppKeyboard(label: string, path = '/'): InlineKeyboard | undefined {
  const url = miniAppUrl(path);
  if (!url) return undefined;
  return new InlineKeyboard().webApp(label, url);
}

/** The two entry shortcuts, side by side. Used by /start and /help. */
export function entryKeyboard(): InlineKeyboard | undefined {
  const income = miniAppUrl('/add/income');
  const expense = miniAppUrl('/add/expense');
  if (!income || !expense) return undefined;

  return new InlineKeyboard()
    .webApp('➕ Income', income)
    .webApp('➖ Expense', expense)
    .row()
    .webApp('◎ Open Xpand', miniAppUrl('/')!);
}

/**
 * Confirmation keyboard after a chat-logged transaction: undo, or open it in the app.
 *
 * Undo matters specifically because this entry path has no review step — the amount is typed
 * blind into a chat line, so a fat-fingered `2500` instead of `250` needs a one-tap fix. The
 * callback payload carries the row id; the handler re-checks ownership before deleting.
 */
export function savedKeyboard(transactionId: number): InlineKeyboard {
  const keyboard = new InlineKeyboard().text('↩️ Undo', `undo:${transactionId}`);

  const url = miniAppUrl(`/transactions/${transactionId}`);
  if (url) keyboard.webApp('✏️ Edit in app', url);

  return keyboard;
}
