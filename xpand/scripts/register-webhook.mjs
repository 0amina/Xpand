/**
 * Point Telegram at a deployment's webhook, as a one-off.
 *
 *   npm run bot:register
 *
 * Needed because serverless deployments cannot register themselves. A long-lived server does it
 * at boot — it boots once, so `setWebhook` costs nothing. A serverless function cold-starts per
 * burst of traffic, and registering on each one would spend three Telegram API calls before
 * answering the update that caused the cold start, while `drop_pending_updates` discarded the
 * queue it was about to read. So this runs by hand, after the first deploy and again whenever
 * `BOT_WEBHOOK_URL` changes.
 *
 * Reads `TELEGRAM_BOT_TOKEN` and `BOT_WEBHOOK_URL` from the environment (so `.env` works
 * locally, and `vercel env pull` works against a deployment). Also registers the command menu
 * and the ☰ Mini App button, which have the same "once per deployment" shape.
 *
 * Idempotent: run it as often as you like. It prints what Telegram reports back, so the webhook
 * can be verified rather than assumed.
 */

import { env } from '../dist/config/env.js';
import { registerWebhook } from '../dist/modules/bot/index.js';

if (!env.TELEGRAM_BOT_TOKEN) {
  console.error('✖ TELEGRAM_BOT_TOKEN is not set — nothing to register.');
  process.exit(1);
}

if (!env.BOT_WEBHOOK_URL) {
  console.error(
    '✖ BOT_WEBHOOK_URL is not set.\n' +
      '  It must be the public HTTPS base URL of the backend, e.g. https://xpand-api.vercel.app',
  );
  process.exit(1);
}

const url = await registerWebhook();

// Read it back from Telegram rather than trusting our own call: `getWebhookInfo` is the only
// thing that proves the registration landed, and `last_error_message` is where a wrong URL or a
// bad TLS chain shows up.
const response = await fetch(
  `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`,
);
const info = await response.json();

console.log(`\n✔ Webhook registered: ${url}\n`);
console.log('Telegram reports:');
console.log(JSON.stringify(info.result, null, 2));

if (info.result?.last_error_message) {
  console.log(
    `\n⚠ Telegram's last delivery attempt failed: ${info.result.last_error_message}\n` +
      '  That is usually a stale error from before this registration. Send the bot a /start and\n' +
      '  run this script again to confirm it clears.',
  );
}

// `registerWebhook` opens a Prisma-free path, but importing env/bot pulls in the logger's
// transport; exit explicitly so a lingering handle cannot keep the script alive.
process.exit(0);
