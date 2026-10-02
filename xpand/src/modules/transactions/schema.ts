import { z } from 'zod';

import { intIdSchema } from '../categories/schema.js';

export const TRANSACTION_TYPES = ['INCOME', 'EXPENSE'] as const;
export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CHECK', 'CARD', 'OTHER'] as const;

export const transactionIdParamSchema = z.object({ id: intIdSchema });

/**
 * A monetary amount. The DB column is NUMERIC(12,2) with a CHECK (amount > 0) that Prisma
 * does NOT enforce (introspection warned about the dropped check constraint) — so this Zod
 * rule is the real guard. Positive, finite, at most 2 decimal places, within NUMERIC(12,2).
 */
const amountSchema = z
  .number({ invalid_type_error: 'amount must be a number' })
  .positive('amount must be greater than 0')
  .finite()
  .max(9_999_999_999.99, 'amount exceeds the maximum of 9,999,999,999.99')
  .refine(
    (n) => Number.isInteger(Math.round(n * 100)) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-9,
    {
      message: 'amount supports at most 2 decimal places',
    },
  );

/**
 * A calendar date (the column is DATE, no time). Accepts either `YYYY-MM-DD` or a full ISO
 * string and coerces to a Date. We validate the `YYYY-MM-DD` shape explicitly so bad input is
 * a 400 rather than an Invalid Date sneaking through.
 */
const dateSchema = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'transactionDate must be a valid date' })
  .transform((s) => new Date(s));

export const createTransactionSchema = z.object({
  categoryId: intIdSchema,
  type: z.enum(TRANSACTION_TYPES),
  amount: amountSchema,
  currency: z
    .string()
    .trim()
    .length(3, 'currency must be a 3-letter code')
    .toUpperCase()
    .optional(),
  description: z.string().trim().max(1000).optional(),
  transactionDate: dateSchema,
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  // Optional links to other entities (those modules are out of scope but the columns exist).
  supplierId: intIdSchema.optional(),
  productId: intIdSchema.optional(),
  packagingId: intIdSchema.optional(),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

/** Update payload: every field optional, but the body must not be empty. */
export const updateTransactionSchema = createTransactionSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

/**
 * Filters for listing. `from`/`to` bound the transaction_date range (inclusive). `userId`
 * narrows to one person's entries; omit it to get everyone's.
 */
export const listTransactionsQuerySchema = z
  .object({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    categoryId: intIdSchema.optional(),
    type: z.enum(TRANSACTION_TYPES).optional(),
    userId: z
      .union([z.string(), z.number()])
      .transform((v) => String(v))
      .refine((s) => /^\d+$/.test(s), { message: 'userId must be a positive integer' })
      .transform((s) => BigInt(s))
      .optional(),
  })
  .refine((q) => !(q.from && q.to) || q.from <= q.to, {
    message: '`from` must be on or before `to`',
    path: ['from'],
  });

export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;
