import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { create, getOne, list, listProducts, listSuppliers, remove, update } from './controller.js';

/**
 * Packaging routes. Open to any authenticated user, reads and writes alike. Relationships are
 * read-only here (managed from the supplier and product sides).
 */
export const packagingRouter = Router();

packagingRouter.use(requireAuth);

packagingRouter.get('/:id/suppliers', asyncHandler(listSuppliers));
packagingRouter.get('/:id/products', asyncHandler(listProducts));

packagingRouter.get('/', asyncHandler(list));
packagingRouter.get('/:id', asyncHandler(getOne));
packagingRouter.post('/', asyncHandler(create));
packagingRouter.patch('/:id', asyncHandler(update));
packagingRouter.delete('/:id', asyncHandler(remove));
