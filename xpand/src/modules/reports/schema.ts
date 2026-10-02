import { z } from 'zod';

import { TRANSACTION_TYPES } from '../transactions/schema.js';

/** A calendar date string → Date at UTC midnight (matches the DATE column semantics). */
const dateSchema = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'must be a valid date (YYYY-MM-DD)' })
  .transform((s) => new Date(s));

/** Optional `userId` — narrows the report to one person. Omitted, the report covers everyone. */
const userIdSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((s) => /^\d+$/.test(s), { message: 'userId must be a positive integer' })
  .transform((s) => BigInt(s));

/**
 * Query for the summary/cash-position report.
 * - `on`: reference date defining "today" and "this month" (defaults to the server's today).
 * - `openingBalance`: overrides the configured OPENING_BALANCE for this call.
 */
export const summaryQuerySchema = z.object({
  on: dateSchema.optional(),
  openingBalance: z.coerce.number().finite().optional(),
  userId: userIdSchema.optional(),
});

export type SummaryQuery = z.infer<typeof summaryQuerySchema>;

/** Query for the by-category breakdown: optional inclusive date range and type filter. */
export const byCategoryQuerySchema = z
  .object({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    type: z.enum(TRANSACTION_TYPES).optional(),
    userId: userIdSchema.optional(),
  })
  .refine((q) => !(q.from && q.to) || q.from <= q.to, {
    message: '`from` must be on or before `to`',
    path: ['from'],
  });

export type ByCategoryQuery = z.infer<typeof byCategoryQuerySchema>;
