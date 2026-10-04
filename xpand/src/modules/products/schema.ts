import { z } from 'zod';

import { decimal2 } from '../../utils/validation.js';

export const createProductSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(200),
  sku: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  unitPrice: decimal2().optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

/**
 * Update payload. As with suppliers, the nullable fields accept an explicit `null` so an edit
 * form can clear a SKU or a unit price rather than only ever setting one.
 */
export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').max(200).optional(),
    sku: z.string().trim().min(1).max(100).nullish(),
    description: z.string().trim().max(2000).nullish(),
    unitPrice: decimal2().nullish(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

/** `?search=` matches name or SKU, case-insensitive. */
export const listProductsQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
});

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

/**
 * Body for linking packaging to a product. `quantity` is how many packaging units the product
 * consumes; the DB enforces CHECK (quantity > 0), mirrored here as a positive integer.
 */
export const productPackagingLinkSchema = z.object({
  quantity: z
    .number()
    .int('quantity must be an integer')
    .positive('quantity must be > 0')
    .optional(),
});

export type ProductPackagingLinkInput = z.infer<typeof productPackagingLinkSchema>;
