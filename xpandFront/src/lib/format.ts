import { DEFAULT_CURRENCY } from '@/types/api';

// --- Money ---------------------------------------------------------------------------------
// The API hands us 2-decimal strings ("2500.50"). We only ever parse them for *display* or
// for arithmetic whose result is immediately re-rounded — never to build a write payload.

const AMOUNT_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Parse an API money string to a number. Returns 0 for null/blank/garbage. */
export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** `"2500.5"` → `"2,500.50"`. Grouping only; no currency symbol. */
export function formatAmount(value: string | number | null | undefined): string {
  return AMOUNT_FORMATTER.format(toNumber(value));
}

/** `"2500.5"` → `"2,500.50 TND"`. */
export function formatMoney(
  value: string | number | null | undefined,
  currency: string = DEFAULT_CURRENCY,
): string {
  return `${formatAmount(value)} ${currency}`;
}

/** Same as `formatMoney` but with an explicit `+` / `−` for signed figures (net movement). */
export function formatSigned(
  value: string | number | null | undefined,
  currency: string = DEFAULT_CURRENCY,
): string {
  const n = toNumber(value);
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${AMOUNT_FORMATTER.format(Math.abs(n))} ${currency}`;
}

/**
 * Abbreviate large figures so the dashboard hero never wraps or shrinks awkwardly:
 * 1234 → "1.2k", 1_234_567 → "1.23M". Below 10 000 the exact value is kept.
 */
export function formatCompact(value: string | number | null | undefined): string {
  const n = toNumber(value);
  const abs = Math.abs(n);
  if (abs < 10_000) return AMOUNT_FORMATTER.format(n);
  if (abs < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

// --- Dates ---------------------------------------------------------------------------------
//
// `transaction_date` is a SQL DATE — a calendar day with no time and no timezone. Every date
// in this app is therefore handled as a plain `YYYY-MM-DD` **string**, and any `Date` object
// is built from *local* components.
//
// Why this matters: the backend computes report boundaries in UTC. For a user in Tunisia
// (UTC+1) at 00:30 on the 7th, the server's UTC "today" is still the 6th — so the dashboard
// would show yesterday's totals next to a form that files under today's date. We avoid the
// whole class of bug by sending our local day explicitly as `?on=` (see api/reports.ts) and
// never round-tripping a date through `new Date(string).toISOString()`.

/** Today as `YYYY-MM-DD`, in the **user's** timezone. */
export function todayISO(): string {
  return toISODate(new Date());
}

/** A `Date` → `YYYY-MM-DD` using local (not UTC) components. */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * `YYYY-MM-DD` → a local-midnight `Date`.
 *
 * Deliberately not `new Date("2026-09-06")`: the spec parses a bare date string as **UTC**,
 * which lands on the previous day for anyone west of Greenwich.
 */
export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Shift an ISO date by whole days. `addDays(todayISO(), -1)` → yesterday. */
export function addDays(iso: string, days: number): string {
  const date = fromISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/** First day of the month containing `iso`. */
export function startOfMonth(iso: string): string {
  const date = fromISODate(iso);
  return toISODate(new Date(date.getFullYear(), date.getMonth(), 1));
}

/** Last day of the month containing `iso`. */
export function endOfMonth(iso: string): string {
  const date = fromISODate(iso);
  return toISODate(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

const DAY_MONTH = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const WEEKDAY_LONG = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** `"2026-09-06"` → `"6 Sep"`, or `"6 Sep 2025"` when it falls outside the current year. */
export function formatDate(iso: string): string {
  const date = fromISODate(iso);
  const formatter = date.getFullYear() === new Date().getFullYear() ? DAY_MONTH : DAY_MONTH_YEAR;
  return formatter.format(date);
}

/** A full, human date: `"Saturday, 6 September"`. Used as list group headers. */
export function formatDateLong(iso: string): string {
  return WEEKDAY_LONG.format(fromISODate(iso));
}

/**
 * A relative day label where one is clearer than a date — "Today", "Yesterday", "Tomorrow" —
 * falling back to `formatDate`. This is what list headers and transaction rows show.
 */
export function formatRelativeDate(iso: string): string {
  const today = todayISO();
  if (iso === today) return 'Today';
  if (iso === addDays(today, -1)) return 'Yesterday';
  if (iso === addDays(today, 1)) return 'Tomorrow';
  return formatDate(iso);
}

/** An ISO timestamp → `"6 Sep, 14:32"`. For created/updated metadata. */
export function formatTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return '—';
  return `${formatDate(toISODate(date))}, ${date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

// --- Labels --------------------------------------------------------------------------------

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Transfer',
  CHECK: 'Check',
  CARD: 'Card',
  OTHER: 'Other',
};

export function formatPaymentMethod(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

/**
 * Category names are seeded lowercase and in French (`recettes`, `charges fixes`), so they
 * are title-cased for display but never renamed — the DB stays the source of truth.
 */
export function formatCategoryName(name: string | null | undefined): string {
  if (!name) return 'Uncategorized';
  return name.charAt(0).toUpperCase() + name.slice(1);
}
