/**
 * Application-wide constants. Business values that never change at runtime live here so
 * they have a single source of truth and can be imported without pulling in heavier modules.
 */

/**
 * The 11 fixed transaction categories Xpand tracks. These mirror the rows already seeded
 * in the database. Kept here as a typed constant so application code (validation, bot
 * command parsing, reports) can reference them without a round-trip to the DB.
 *
 * NOTE: this is a convenience mirror, not the source of truth — the `categories` table is.
 */
export const TRANSACTION_CATEGORIES = [
  'salaries',
  'suppliers',
  'transport',
  'packaging',
  'sponsoring',
  'subscriptions',
  'prets',
  'investissements',
  'recettes',
  'divers',
  'charges fixes',
] as const;

export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number];

/**
 * Image types accepted for an invoice upload.
 *
 * Images only, deliberately: Tesseract is an image OCR engine. A PDF would need either its text
 * layer read (not OCR at all) or rasterising to pixels first (native dependencies), so rather
 * than accept a PDF and fail at the OCR step, uploads reject it up front with a message telling
 * the user to photograph the invoice. See the invoices README for the extension path.
 */
export const INVOICE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type InvoiceMimeType = (typeof INVOICE_MIME_TYPES)[number];

/** File extension written to disk for each accepted type. */
export const INVOICE_EXTENSIONS: Record<InvoiceMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Category an invoice draft is pre-filled with. An invoice is a supplier bill, so `suppliers`
 * is the right default — but it is only a suggestion: the user can change it before confirming,
 * and the category↔type rule is enforced on confirm exactly as it is for a hand-typed expense.
 */
export const INVOICE_DEFAULT_CATEGORY = 'suppliers';

/** How long to let in-flight requests finish before force-closing during shutdown (ms). */
export const SHUTDOWN_GRACE_PERIOD_MS = 10_000;

/**
 * Default currency. Matches the `transactions.currency` column default (TND). Reports assume a
 * single currency and do NOT convert — see the README's report assumptions.
 */
export const DEFAULT_CURRENCY = 'TND';
