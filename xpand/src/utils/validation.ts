import { z } from 'zod';

/**
 * Shared Zod building blocks reused across modules. Kept here (rather than importing from a
 * sibling feature module) so validation primitives have one obvious home.
 */

/** A positive integer id (SERIAL PK). Coerces the string that arrives in a path param. */
export const intIdSchema = z.coerce
  .number({ invalid_type_error: 'id must be a number' })
  .int('id must be an integer')
  .positive('id must be positive');

/** `{ id }` path-param object built on {@link intIdSchema}. */
export const intIdParamSchema = z.object({ id: intIdSchema });

/**
 * A money value stored in NUMERIC(12,2): finite, at most 2 decimal places, within range.
 * `min` defaults to 0 (prices/costs are non-negative). Use for unit prices and costs.
 */
export function decimal2(min = 0) {
  return z
    .number({ invalid_type_error: 'must be a number' })
    .finite()
    .min(min, `must be ≥ ${min}`)
    .max(9_999_999_999.99, 'exceeds the maximum of 9,999,999,999.99')
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-9, {
      message: 'supports at most 2 decimal places',
    });
}
