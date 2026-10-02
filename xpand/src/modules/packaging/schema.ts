import { z } from 'zod';

import { decimal2 } from '../../utils/validation.js';

export const createPackagingSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(200),
  unit: z.string().trim().max(50).optional(),
  unitCost: decimal2().optional(),
});

export type CreatePackagingInput = z.infer<typeof createPackagingSchema>;

export const updatePackagingSchema = createPackagingSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdatePackagingInput = z.infer<typeof updatePackagingSchema>;

/** `?search=` matches name or unit, case-insensitive. */
export const listPackagingQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
});

export type ListPackagingQuery = z.infer<typeof listPackagingQuerySchema>;
