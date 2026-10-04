import { createHmac } from 'node:crypto';

import type { RequestHandler } from 'express';
import { Bot, webhookCallback } from 'grammy';

import { botMode, env, isServerless } from '../../config/env.js';
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

/** Updates we actually handle. Narrowing this cuts pointless traffic, in both transports. */
const ALLOWED_UPDATES = ['message', 'callback_query'] as const;

/**
 * The initialised bot, constructed on first use and cached for the life of the process.
 *
 * The cache is the whole point. On a long-lived server `startBot()` warms it once at boot. On a
 * serverless host there is no boot — each cold start builds the app and then serves a single
 * webhook POST — so the first update pays for `init()` (one `getMe` call) and every subsequent
 * update on that same warm instance reuses it. Caching the *promise* rather than the bot means
 * two updates arriving together cannot both start an init.
 *
 * A rejected init clears the cache, so a transient Telegram outage at cold start does not
 * poison the instance for as long as it lives.
 */
let botPromise: Promise<Bot> | undefined;

function readyBot(): Promise<Bot> {
  botPromise ??= (async () => {
    const token = env.TELEGRAM_BOT_TOKEN!; // Callers check botMode first, which implies a token.
    const bot = createBot(token);
    // Fetches the bot's own identity. Doing it explicitly surfaces a bad token here rather than
    // as an obscure failure on the first update.
    await bot.init();
    instance = bot;
    return bot;
  })().catch((err: unknown) => {
    botPromise = undefined;
    throw err;
  });

  return botPromise;
}

/**
 * Point Telegram at this deployment's webhook URL.
 *
 * Separate from `startBot()` because the two hosts need it at different times. A long-lived
 * server can register on boot: it boots once. A serverless deployment must **not** — there is a
 * cold start per burst of traffic, and re-registering on each one would spend three Telegram API
 * calls before answering the update that triggered it, while `drop_pending_updates` threw away
 * the very updates that were queued. There it is a one-off deploy step instead:
 * `npm run bot:register`.
 */
export async function registerWebhook(): Promise<string> {
  if (!env.BOT_WEBHOOK_URL) {
    throw new Error('BOT_WEBHOOK_URL must be set to register a webhook.');
  }

  const bot = await readyBot();
  const url = `${env.BOT_WEBHOOK_URL.replace(/\/+$/, '')}${WEBHOOK_PATH}`;

  await bot.api.setWebhook(url, {
    secret_token: webhookSecret(env.TELEGRAM_BOT_TOKEN!),
    allowed_updates: [...ALLOWED_UPDATES],
    drop_pending_updates: true,
  });

  await registerMenus(bot);

  logger.info({ url }, 'Telegram webhook registered');
  return url;
}

/**
 * Start the bot, if one is configured. For a long-lived server only.
 *
 * Resolves as soon as the bot is *ready*, not when it stops. In polling mode `bot.start()`
 * runs until shutdown, so it is deliberately not awaited — awaiting it would hang startup
 * forever.
 *
 * Does nothing on a serverless host: there is no process to own a poller, and webhook
 * registration is a deploy step there (see `registerWebhook`). The webhook route itself needs no
 * startup at all — it initialises the bot on demand.
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

  if (isServerless) {
    logger.info(
      { mode: botMode },
      'Serverless runtime — the webhook route initialises the bot per instance; ' +
        'register the URL once with `npm run bot:register`',
    );
    return;
  }

  const bot = await readyBot();
  logger.info({ username: bot.botInfo.username, mode: botMode }, 'Telegram bot initialising');

  if (botMode === 'webhook') {
    await registerWebhook();
    return;
  }

  await registerMenus(bot);

  // Polling. A previously-registered webhook would make Telegram refuse to serve getUpdates,
  // so clear it first — this is the usual cause of "the bot is running but never replies"
  // after switching a deployment back to local development.
  await bot.api.deleteWebhook({ drop_pending_updates: true });

  void bot.start({
    allowed_updates: [...ALLOWED_UPDATES],
    onStart: (info) => logger.info({ username: info.username }, 'Telegram bot polling for updates'),
  });
}

/**
 * Express handler for webhook mode, initialising the bot if this instance has not yet done so.
 *
 * Async because of that lazy init, which is what makes the route work on a serverless host where
 * nothing ran `startBot()`. The handler itself is rebuilt per call — it is a thin closure over
 * the cached bot, so this costs nothing worth caching.
 *
 * grammy verifies the secret-token header itself and answers 401 on a mismatch, so an attacker
 * who finds the path still cannot inject updates. Resolves to `undefined` when the bot is not in
 * webhook mode, so `app.ts` can answer 404 rather than pretending to accept updates.
 */
export async function botWebhookHandler(): Promise<RequestHandler | undefined> {
  if (botMode !== 'webhook' || !env.TELEGRAM_BOT_TOKEN) return undefined;

  const bot = await readyBot();

  return webhookCallback(bot, 'express', {
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
    botPromise = undefined;
  }
}

export { createBot } from './bot.js';
