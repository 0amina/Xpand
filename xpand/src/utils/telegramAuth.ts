import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Validation of Telegram Mini App `initData`.
 *
 * When Telegram opens a Mini App it hands the page an `initData` query string describing who
 * opened it, signed with a key derived from the bot token. Because only Telegram and we know
 * that token, a valid signature proves the caller really is that Telegram user — which is
 * what replaces the old spoofable `x-telegram-id` header.
 *
 * The algorithm is fixed by Telegram (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 *
 *   1. Take every `key=value` pair except `hash`, sort them by key, join with `\n`.
 *      That is the *data check string*.
 *   2. secret_key = HMAC_SHA256(key: "WebAppData", message: <bot token>)
 *   3. expected  = HMAC_SHA256(key: secret_key,   message: <data check string>)  → hex
 *   4. Constant-time compare `expected` against the `hash` field.
 *
 * Note the unusual step 2: the literal string `"WebAppData"` is the HMAC *key* and the bot
 * token is the *message*, not the other way round. Swapping them is the classic bug here and
 * produces a validator that rejects everything.
 */

/**
 * How long a signature stays acceptable.
 *
 * `auth_date` is set when Telegram opened the Mini App, and the same initData is reused for
 * every request the page makes during that session. So this is really "how long may a Mini App
 * session run before the user must reopen it" — too short and a long data-entry session dies
 * mid-form. A day is Telegram's own suggested order of magnitude and bounds replay of a
 * leaked string to that window.
 */
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

/** The Telegram profile carried inside a validated `initData`. */
export interface TelegramInitDataUser {
  id: bigint;
  firstName: string;
  // `| undefined` spelled out because the project runs with `exactOptionalPropertyTypes`,
  // under which `?:` alone forbids explicitly assigning undefined.
  lastName?: string | undefined;
  username?: string | undefined;
  languageCode?: string | undefined;
  isPremium?: boolean | undefined;
}

export interface ValidatedInitData {
  user: TelegramInitDataUser;
  authDate: Date;
  /** Present when the Mini App was opened from an inline button / deep link. */
  startParam?: string | undefined;
}

export type InitDataFailure =
  'malformed' | 'missing-hash' | 'bad-signature' | 'expired' | 'missing-user';

export class InitDataError extends Error {
  readonly reason: InitDataFailure;

  constructor(reason: InitDataFailure, message: string) {
    super(message);
    this.name = 'InitDataError';
    this.reason = reason;
  }
}

/**
 * Verify an `initData` string and extract the user.
 *
 * @param initData Raw query string exactly as Telegram produced it. It must NOT be decoded or
 *   re-encoded first — the signature covers the values as sent, so any normalisation on the
 *   way in (a proxy re-encoding `+`, a client running `decodeURIComponent`) breaks it.
 * @param botToken The bot token from @BotFather.
 * @throws {InitDataError} when the payload is malformed, unsigned, forged, or stale.
 */
export function validateInitData(initData: string, botToken: string): ValidatedInitData {
  if (!initData || typeof initData !== 'string') {
    throw new InitDataError('malformed', 'initData is empty');
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    throw new InitDataError('missing-hash', 'initData has no hash field');
  }

  // Step 1 — data check string: every pair except `hash`, sorted by key, joined with newlines.
  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  // Steps 2 and 3. Note the key/message order in the first HMAC — see the module comment.
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // Step 4 — constant-time compare so a wrong hash can't be discovered byte by byte through
  // response timing. `timingSafeEqual` throws on a length mismatch, hence the guard.
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(hash, 'utf8');
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    throw new InitDataError('bad-signature', 'initData signature does not match');
  }

  // Freshness. A valid signature is forever otherwise, so a string captured from a device or
  // a log would grant permanent access.
  const authDateRaw = params.get('auth_date');
  const authDateSeconds = Number(authDateRaw);
  if (!authDateRaw || !Number.isFinite(authDateSeconds)) {
    throw new InitDataError('malformed', 'initData has no valid auth_date');
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - authDateSeconds;
  if (ageSeconds > MAX_AUTH_AGE_SECONDS) {
    throw new InitDataError('expired', `initData is ${ageSeconds}s old; reopen the app`);
  }

  // `user` is a JSON blob inside the query string. It is absent when a Mini App is opened
  // from a channel or an inline query without user context — we have no identity then.
  const userRaw = params.get('user');
  if (!userRaw) {
    throw new InitDataError('missing-user', 'initData carries no user');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(userRaw) as Record<string, unknown>;
  } catch {
    throw new InitDataError('malformed', 'initData user field is not valid JSON');
  }

  const id = parsed.id;
  const firstName = parsed.first_name;
  if (typeof id !== 'number' || !Number.isInteger(id) || typeof firstName !== 'string') {
    throw new InitDataError('malformed', 'initData user is missing id or first_name');
  }

  return {
    user: {
      // BIGINT in the DB — Telegram ids can exceed 2^53. JSON.parse already gave us a number,
      // but ids that large do not occur yet and Telegram sends them as JSON numbers regardless.
      id: BigInt(id),
      firstName,
      lastName: typeof parsed.last_name === 'string' ? parsed.last_name : undefined,
      username: typeof parsed.username === 'string' ? parsed.username : undefined,
      languageCode: typeof parsed.language_code === 'string' ? parsed.language_code : undefined,
      isPremium: parsed.is_premium === true,
    },
    authDate: new Date(authDateSeconds * 1000),
    startParam: params.get('start_param') ?? undefined,
  };
}

export { MAX_AUTH_AGE_SECONDS };
