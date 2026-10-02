import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  create,
  getOne,
  linkPackaging,
  linkProduct,
  list,
  listPackaging,
  listProducts,
  remove,
  unlinkPackaging,
  unlinkProduct,
  update,
} from './controller.js';

/**
 * Supplier routes. Open to any authenticated user, reads and writes alike. The supplier still
 * owns the write side of supplier↔product and supplier↔packaging links — a rule about which
 * module performs the write, not a permission.
 */
export const suppliersRouter = Router();

suppliersRouter.use(requireAuth);

// Relationship sub-resources (declared before `/:id` bare routes is unnecessary here since
// paths differ, but grouped for clarity).
suppliersRouter.get('/:id/products', asyncHandler(listProducts));
suppliersRouter.put('/:id/products/:productId', asyncHandler(linkProduct));
suppliersRouter.delete('/:id/products/:productId', asyncHandler(unlinkProduct));
suppliersRouter.get('/:id/packaging', asyncHandler(listPackaging));
suppliersRouter.put('/:id/packaging/:packagingId', asyncHandler(linkPackaging));
suppliersRouter.delete('/:id/packaging/:packagingId', asyncHandler(unlinkPackaging));

// CRUD
suppliersRouter.get('/', asyncHandler(list));
suppliersRouter.get('/:id', asyncHandler(getOne));
suppliersRouter.post('/', asyncHandler(create));
suppliersRouter.patch('/:id', asyncHandler(update));
suppliersRouter.delete('/:id', asyncHandler(remove));
