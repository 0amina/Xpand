import { z } from 'zod';

import { decimal2 } from '../../utils/validation.js';

/** Create payload. Only `name` is required (matches the NOT NULL column); rest are optional. */
export const createSupplierSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(200),
  contactPerson: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email('email must be valid').max(200).optional(),
  address: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

/** Update payload: all optional, but the body must not be empty. */
export const updateSupplierSchema = createSupplierSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

/** `?search=` does a case-insensitive partial match on name / contact / email / phone. */
export const listSuppliersQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
});

export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;

/** Body for linking a supplier to a product or packaging: an optional negotiated unit price. */
export const supplierLinkSchema = z.object({
  unitPrice: decimal2().optional(),
});

export type SupplierLinkInput = z.infer<typeof supplierLinkSchema>;
