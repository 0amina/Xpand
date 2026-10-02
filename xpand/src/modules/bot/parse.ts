import type { categories as CategoryModel, transaction_type } from '@prisma/client';

/**
 * Parsing for the quick-entry commands: `/expense 250.50 transport lunch with client`.
 *
 * Grammar is positional and deliberately tiny — amount, then category, then free text — so it
 * can be typed one-handed without remembering flags. Everything after the category is the
 * description, spaces and all.
 *
 *   /expense                          → no arguments, open the Mini App instead
 *   /expense 250                      → amount only; category still needed
 *   /expense 250 transport            → ready to save
 *   /expense 250 transport taxi fare  → with a description
 *   /expense 250,50 transport         → comma decimals accepted (fr-TN keyboards)
 */

/** Mirrors the Zod rule in `modules/transactions/schema.ts` — NUMERIC(12,2), must be > 0. */
const MAX_AMOUNT = 9_999_999_999.99;

export type ParseResult =
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'needs-category'; amount: number; description?: string }
  | { kind: 'ok'; amount: number; categoryTerm: string; description?: string };

/**
 * Split the raw argument string. Does not touch the database — category *resolution* is a
 * separate step (`resolveCategory`) so this stays pure and testable.
 */
export function parseQuickEntry(raw: string): ParseResult {
  const text = raw.trim();
  if (text === '') return { kind: 'empty' };

  const tokens = text.split(/\s+/);
  const amountToken = tokens[0];

  const amount = parseAmount(amountToken);
  if (amount === null) {
    return {
      kind: 'error',
      message: `"${amountToken}" is not a valid amount. Try <code>250</code> or <code>250.50</code>.`,
    };
  }
  if (amount <= 0) {
    return { kind: 'error', message: 'Amount must be greater than 0.' };
  }
  if (amount > MAX_AMOUNT) {
    return { kind: 'error', message: 'That amount is too large.' };
  }

  const categoryTerm = tokens[1];
  const description = tokens.slice(2).join(' ').trim();

  if (!categoryTerm) {
    return description
      ? { kind: 'needs-category', amount, description }
      : { kind: 'needs-category', amount };
  }

  return description
    ? { kind: 'ok', amount, categoryTerm, description }
    : { kind: 'ok', amount, categoryTerm };
}

/**
 * Parse a money token, or `null` if it isn't one.
 *
 * Accepts a comma as the decimal separator because that is what a French/Tunisian keyboard
 * produces, and rejects more than two decimals — the column is NUMERIC(12,2) and the API's
 * Zod schema would bounce it, so catching it here gives a better message than a 400.
 */
export function parseAmount(token: string | undefined): number | null {
  if (!token) return null;

  // One separator only: "1,234.50" (thousands grouping) is ambiguous enough to reject.
  const normalized = token.replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export type CategoryMatch =
  | { kind: 'found'; category: CategoryModel }
  | { kind: 'none'; available: CategoryModel[] }
  | { kind: 'ambiguous'; candidates: CategoryModel[] };

/**
 * Resolve a typed word to one of the seeded categories.
 *
 * Matching widens in stages — exact, then prefix, then substring — so `transport` wins
 * outright, `trans` still resolves, and a typo falls through to a list rather than guessing.
 * Ambiguity is reported instead of silently picking the first hit; charging the wrong category
 * is worse than one extra message.
 *
 * `candidates` must already be filtered to the transaction type: the API rejects an
 * INCOME-only category on an EXPENSE with a 400, so an incompatible one should never be
 * offered in the first place.
 */
export function resolveCategory(term: string, candidates: CategoryModel[]): CategoryMatch {
  const needle = term.trim().toLowerCase();

  // `sole` narrows a single-element array to its element; a bare `list[0]` is `T | undefined`
  // under `noUncheckedIndexedAccess` even after a length check.
  const sole = (list: CategoryModel[]): CategoryModel | undefined =>
    list.length === 1 ? list[0] : undefined;

  const exactHit = sole(candidates.filter((c) => c.name.toLowerCase() === needle));
  if (exactHit) return { kind: 'found', category: exactHit };

  const prefix = candidates.filter((c) => c.name.toLowerCase().startsWith(needle));
  const prefixHit = sole(prefix);
  if (prefixHit) return { kind: 'found', category: prefixHit };
  if (prefix.length > 1) return { kind: 'ambiguous', candidates: prefix };

  const substring = candidates.filter((c) => c.name.toLowerCase().includes(needle));
  const substringHit = sole(substring);
  if (substringHit) return { kind: 'found', category: substringHit };
  if (substring.length > 1) return { kind: 'ambiguous', candidates: substring };

  return { kind: 'none', available: candidates };
}

/** Categories usable for a given transaction type — mirrors the backend's compatibility rule. */
export function compatibleCategories(
  categories: CategoryModel[],
  type: transaction_type,
): CategoryModel[] {
  return categories.filter((c) => c.type === type || c.type === 'BOTH');
}
