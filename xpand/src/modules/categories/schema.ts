import { z } from 'zod';

/** The DB enum `category_type`. Declared locally so validation errors are clean 400s. */
export const CATEGORY_TYPES = ['INCOME', 'EXPENSE', 'BOTH'] as const;

/** Reusable positive-integer id (SERIAL columns). Coerces the string path param. */
export const intIdSchema = z.coerce
  .number({ invalid_type_error: 'id must be a number' })
  .int('id must be an integer')
  .positive('id must be positive');

export const categoryIdParamSchema = z.object({ id: intIdSchema });

/** `?type=` filter when listing categories. */
export const listCategoriesQuerySchema = z.object({
  type: z.enum(CATEGORY_TYPES).optional(),
});

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(50),
  type: z.enum(CATEGORY_TYPES),
  icon: z.string().trim().max(50).optional(),
  color: z.string().trim().max(20).optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

/**
 * Update payload — all fields optional, but at least one must be present (an empty PATCH is a
 * client mistake, so we reject it with a 400 rather than issuing a no-op UPDATE).
 */
export const updateCategorySchema = createCategorySchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
