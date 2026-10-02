import { z } from 'zod';

import { intIdSchema } from '../categories/schema.js';
import { PAYMENT_METHODS, TRANSACTION_TYPES } from '../transactions/schema.js';

/** Path param `:id`. */
export const invoiceIdParamSchema = z.object({ id: intIdSchema });

export const INVOICE_STATUSES = ['PENDING', 'PROCESSING', 'READY', 'FAILED', 'CONFIRMED'] as const;

/**
 * Listing filters.
 *
 * `transactionId` answers "does this expense have a receipt filed against it?", which the
 * transaction detail screen needs and which would otherwise require fetching every invoice.
 */
export const listInvoicesQuerySchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  transactionId: intIdSchema.optional(),
});

export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

/**
 * An amount as the client sends it: a string, parsed to 2 decimals.
 *
 * Money crosses this API as a string everywhere (see the project's precision note) and the
 * column is `NUMERIC(12,2)`. Accepting a JSON number here would route every confirmation through
 * a float, which is the one thing the rest of the codebase is careful never to do.
 */
const amountStringSchema = z
  .string()
  .trim()
  .min(1, 'amount is required')
  .refine((s) => /^\d+(\.\d{1,2})?$/.test(s), {
    message: 'amount must be a positive number with at most 2 decimal places, e.g. "458.15"',
  })
  .refine((s) => Number(s) > 0, { message: 'amount must be greater than 0' })
  .refine((s) => Number(s) <= 9_999_999_999.99, { message: 'amount exceeds the maximum' });

/** A calendar date, `YYYY-MM-DD`, read at UTC midnight to match the DATE column. */
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'must be a real date' })
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

/**
 * What the user submits to turn a reviewed invoice into a transaction.
 *
 * This is the verification gate, and it is why the fields are **required** rather than inherited
 * from whatever OCR happened to read. The extracted draft only ever pre-fills the form; the
 * values that reach the ledger are the ones the user confirmed. Letting the request fall back to
 * `ocr_extracted_data` for anything missing would mean an unreviewed number could be saved by
 * submitting an empty body — exactly the outcome the review step exists to prevent.
 *
 * `supplierId` stays optional because an invoice may be from a supplier nobody has recorded yet,
 * and blocking the expense on creating a supplier row would be the wrong trade.
 */
export const confirmInvoiceSchema = z.object({
  categoryId: intIdSchema,
  type: z.enum(TRANSACTION_TYPES).default('EXPENSE'),
  amount: amountStringSchema,
  currency: z.string().trim().length(3).toUpperCase().default('TND'),
  transactionDate: dateSchema,
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  description: z.string().trim().max(1000).optional(),
  supplierId: intIdSchema.optional(),
  productId: intIdSchema.optional(),
  packagingId: intIdSchema.optional(),
  /** The invoice reference as verified by the user. Kept on the draft, and used in the fallback
   * description so the transaction is traceable to the paper without opening the attachment. */
  invoiceNumber: z.string().trim().max(64).optional(),
});

export type ConfirmInvoiceInput = z.infer<typeof confirmInvoiceSchema>;

/**
 * Attach an uploaded invoice to a transaction that already exists.
 *
 * Separate from `confirm` because the two do opposite things: `confirm` *creates* a transaction
 * from a draft, this one only files an image against an entry already in the ledger. Conflating
 * them is how you end up double-booking an expense that was already logged by hand.
 */
export const linkInvoiceSchema = z.object({
  transactionId: intIdSchema,
});

export type LinkInvoiceInput = z.infer<typeof linkInvoiceSchema>;
