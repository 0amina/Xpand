import type { Category, PaymentMethod, TransactionType } from '@/types/api';
import { readJSON, writeJSON } from './storage';

/**
 * Per-device memory of what this user actually picks.
 *
 * The single biggest lever on "minimal clicks" is putting the right chip under the thumb.
 * A cashier logging expenses hits `suppliers` and `transport` forty times a day and
 * `sponsoring` twice a year, so a fixed alphabetical order costs a scroll on almost every
 * entry. We track usage counts locally and sort the chip grid by them.
 *
 * Kept on-device on purpose: it is a UI preference, not business data, and there is no
 * backend column for it.
 */

const CATEGORY_KEY = 'recent-categories';
const PAYMENT_KEY = 'recent-payment-method';

/** `{ INCOME: { "8": 42 }, EXPENSE: { "2": 17 } }` — counts keyed by category id. */
type UsageCounts = Record<TransactionType, Record<string, number>>;

const EMPTY: UsageCounts = { INCOME: {}, EXPENSE: {} };

function readUsage(): UsageCounts {
  const stored = readJSON<Partial<UsageCounts>>(CATEGORY_KEY, EMPTY);
  return { INCOME: stored.INCOME ?? {}, EXPENSE: stored.EXPENSE ?? {} };
}

/** Record that a category was used for a transaction of this type. */
export function recordCategoryUse(type: TransactionType, categoryId: number): void {
  const usage = readUsage();
  const bucket = usage[type];
  bucket[String(categoryId)] = (bucket[String(categoryId)] ?? 0) + 1;

  // Halve every count once the leader gets large. Keeps the ordering responsive to a change
  // in habits instead of being locked in by a year of history, and bounds the numbers.
  const max = Math.max(...Object.values(bucket));
  if (max > 200) {
    for (const key of Object.keys(bucket)) {
      bucket[key] = Math.floor(bucket[key] / 2);
    }
  }

  writeJSON(CATEGORY_KEY, usage);
}

/**
 * Categories valid for `type`, most-used first.
 *
 * Filtering enforces the backend's category↔type rule client-side: an `INCOME`-only category
 * cannot take an `EXPENSE` transaction (the API answers 400), a `BOTH` category takes either.
 * Doing it here means the invalid option is never offered, rather than rejected after a tap.
 */
export function sortCategoriesByUse(categories: Category[], type: TransactionType): Category[] {
  const usage = readUsage()[type];

  return categories
    .filter((c) => c.type === type || c.type === 'BOTH')
    .sort((a, b) => {
      const diff = (usage[String(b.id)] ?? 0) - (usage[String(a.id)] ?? 0);
      // Alphabetical within an equal-usage group, so unused categories stay predictable.
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
}

/** The payment method to preselect: whatever was used last, defaulting to CASH. */
export function lastPaymentMethod(): PaymentMethod {
  return readJSON<PaymentMethod>(PAYMENT_KEY, 'CASH');
}

export function recordPaymentMethod(method: PaymentMethod): void {
  writeJSON(PAYMENT_KEY, method);
}
