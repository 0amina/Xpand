import type { Prisma } from '@prisma/client';

import { DEFAULT_CURRENCY } from '../../config/constants.js';

/**
 * Message formatting for the bot.
 *
 * All messages use Telegram's **HTML** parse mode rather than MarkdownV2. MarkdownV2 requires
 * escaping eighteen characters — including `.` `-` `!` `(` `)` — inside every piece of text,
 * and a single missed one makes Telegram reject the whole message at runtime. HTML needs only
 * `&`, `<` and `>` escaped, which `esc()` below handles in one place.
 */

/** Escape user-supplied text for Telegram's HTML parse mode. */
export function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const AMOUNT_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format a money value for chat.
 *
 * Accepts what the services actually return: a Prisma `Decimal`, a plain number, or the string
 * form. The transactions layer stringifies Decimals with `.toString()` (so 50.00 arrives as
 * "50"), while the reports layer uses `.toFixed(2)` — this normalises both to two decimals.
 */
export function money(
  value: Prisma.Decimal | number | string | null | undefined,
  currency: string = DEFAULT_CURRENCY,
): string {
  const n = value === null || value === undefined ? 0 : Number(value.toString());
  return `${AMOUNT_FORMATTER.format(Number.isFinite(n) ? n : 0)} ${currency}`;
}

/** Same, with an explicit sign — for net figures where direction is the point. */
export function signedMoney(
  value: Prisma.Decimal | number | string | null | undefined,
  currency: string = DEFAULT_CURRENCY,
): string {
  const n = value === null || value === undefined ? 0 : Number(value.toString());
  const safe = Number.isFinite(n) ? n : 0;
  const sign = safe > 0 ? '+' : safe < 0 ? '−' : '';
  return `${sign}${AMOUNT_FORMATTER.format(Math.abs(safe))} ${currency}`;
}

/** `2026-09-08` from a Date, using UTC parts to match the DATE column's semantics. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const DAY_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** `8 Sep`, or `Today` / `Yesterday` where that reads better in a list. */
export function shortDate(date: Date, today = new Date()): string {
  const target = isoDate(date);
  const todayIso = isoDate(today);
  if (target === todayIso) return 'Today';

  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (target === isoDate(yesterday)) return 'Yesterday';

  return DAY_FORMATTER.format(date);
}

/** Title-case a seeded category name for display without renaming it in the DB. */
export function categoryLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Transfer',
  CHECK: 'Check',
  CARD: 'Card',
  OTHER: 'Other',
};

export function paymentLabel(method: string): string {
  return PAYMENT_LABELS[method] ?? method;
}
