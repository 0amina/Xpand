import { createHmac } from 'node:crypto';

import type { RequestHandler } from 'express';
import { Bot, webhookCallback } from 'grammy';

import { botMode, env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { BOT_COMMANDS, createBot } from './bot.js';
import { miniAppUrl } from './keyboards.js';

/**
 * Bot lifecycle: construction, update transport, and shutdown.
 *
 * Two transports, chosen by `BOT_MODE`:
 *
 *  - **polling** — we repeatedly ask Telegram for updates. Needs no public URL, so it is the
 *    only option that works on a laptop, and the default in development. Exactly one process
 *    may poll a given bot token: a second one makes Telegram return 409 and the two steal
 *    updates from each other.
 *  - **webhook** — Telegram POSTs updates to us. Needs a public HTTPS URL, scales across
 *    instances, and is what production should use.
 *
 * The bot shares the process with the HTTP API. That keeps one connection pool and one
 * deployment, and lets handlers call services directly. If the bot ever needs to scale
 * separately, `startBot()` is the only thing that has to move.
 */

/** The single instance, so `stopBot` can reach what `startBot` created. */
let instance: Bot | undefined;

/**
 * Secret echoed by Telegram in `X-Telegram-Bot-Api-Secret-Token` on every webhook call.
 *
 * Derived from the bot token when not configured explicitly. A random value would be
 * regenerated on each restart — fine for one process, but with several instances behind a load
 * balancer each would register a different secret and reject the others' traffic. Deriving it
 * keeps it stable and unguessable without adding required configuration.
 */
function webhookSecret(token: string): string {
  if (env.BOT_WEBHOOK_SECRET) return env.BOT_WEBHOOK_SECRET;
  return createHmac('sha256', token).update('xpand-webhook-secret').digest('hex');
}

/** Path the webhook is mounted on. Unguessable-ish, but the secret header is the real guard. */
export const WEBHOOK_PATH = '/telegram/webhook';

/**
 * Register the command menu and the ☰ button.
 *
 * `setMyCommands` populates autocomplete and the in-chat command list; `setChatMenuButton`
 * turns the ☰ next to the message box into a Mini App launcher, which is the most discoverable
 * entry point there is. The latter needs an HTTPS URL, so it is skipped when MINI_APP_URL is
 * unset.
 *
 * Both are best-effort: a network hiccup while registering menus must not stop the bot from
 * answering commands.
 */
async function registerMenus(bot: Bot): Promise<void> {
  try {
    await bot.api.setMyCommands([...BOT_COMMANDS]);
    logger.info({ count: BOT_COMMANDS.length }, 'Registered bot commands');
  } catch (err) {
    logger.warn({ err }, 'Could not register bot commands');
  }

  const url = miniAppUrl('/');
  if (!url) {
    logger.warn('MINI_APP_URL is not set — the bot will answer without Mini App buttons');
    return;
  }

  try {
    await bot.api.setChatMenuButton({
      menu_button: { type: 'web_app', text: 'Xpand', web_app: { url } },
    });
    logger.info({ url }, 'Set Mini App menu button');
  } catch (err) {
    logger.warn({ err }, 'Could not set the Mini App menu button');
  }
}

/**
 * Start the bot, if one is configured.
 *
 * Resolves as soon as the bot is *ready*, not when it stops. In polling mode `bot.start()`
 * runs until shutdown, so it is deliberately not awaited — awaiting it would hang startup
 * forever.
 */
export async function startBot(): Promise<void> {
  if (botMode === 'off') {
    logger.info(
      env.TELEGRAM_BOT_TOKEN
        ? 'Bot disabled (BOT_MODE=off)'
        : 'Bot disabled (no TELEGRAM_BOT_TOKEN configured)',
    );
    return;
  }

  const token = env.TELEGRAM_BOT_TOKEN!; // botMode is only non-'off' when a token exists.
  const bot = createBot(token);
  instance = bot;

  // Fetches the bot's own identity. Doing it explicitly surfaces a bad token here, at startup,
  // rather than on the first update.
  await bot.init();
  logger.info({ username: bot.botInfo.username, mode: botMode }, 'Telegram bot initialising');

  await registerMenus(bot);

  if (botMode === 'webhook') {
    const url = `${env.BOT_WEBHOOK_URL!.replace(/\/+$/, '')}${WEBHOOK_PATH}`;
    await bot.api.setWebhook(url, {
      secret_token: webhookSecret(token),
      // Updates we never handle. Narrowing this cuts pointless traffic.
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    });
    logger.info({ url }, 'Telegram webhook registered');
    return;
  }

  // Polling. A previously-registered webhook would make Telegram refuse to serve getUpdates,
  // so clear it first — this is the usual cause of "the bot is running but never replies"
  // after switching a deployment back to local development.
  await bot.api.deleteWebhook({ drop_pending_updates: true });

  void bot.start({
    allowed_updates: ['message', 'callback_query'],
    onStart: (info) => logger.info({ username: info.username }, 'Telegram bot polling for updates'),
  });
}

/**
 * Express handler for webhook mode.
 *
 * grammy verifies the secret-token header itself and answers 401 on a mismatch, so an attacker
 * who finds the path still cannot inject updates. Returns `undefined` when not in webhook mode
 * so `app.ts` can skip mounting the route entirely.
 */
export function botWebhookHandler(): RequestHandler | undefined {
  if (botMode !== 'webhook' || !instance || !env.TELEGRAM_BOT_TOKEN) return undefined;

  return webhookCallback(instance, 'express', {
    secretToken: webhookSecret(env.TELEGRAM_BOT_TOKEN),
  });
}

/** Stop polling / drain handlers. Called from the server's graceful shutdown. */
export async function stopBot(): Promise<void> {
  if (!instance) return;
  try {
    await instance.stop();
    logger.info('Telegram bot stopped');
  } catch (err) {
    logger.warn({ err }, 'Error stopping the Telegram bot');
  } finally {
    instance = undefined;
  }
}

export { createBot } from './bot.js';
