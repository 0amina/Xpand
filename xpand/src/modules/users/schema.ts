import { z } from 'zod';

/**
 * A Telegram user id: a positive integer that may exceed 2^53, so it's validated as a digit
 * string and converted to BigInt. Accepts a JSON number too (coerced) for convenience.
 */
const telegramIdSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((s) => /^\d+$/.test(s), { message: 'id must be a positive integer' })
  .transform((s) => BigInt(s));

/**
 * Payload for "login" (create-on-first-contact upsert). Mirrors the profile Telegram gives
 * us. `firstName` is required because the column is NOT NULL.
 */
export const loginSchema = z.object({
  id: telegramIdSchema,
  username: z.string().trim().min(1).max(100).optional(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Path param `:id` for fetching a single user. */
export const userIdParamSchema = z.object({
  id: telegramIdSchema,
});
