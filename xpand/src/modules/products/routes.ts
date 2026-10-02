import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  create,
  getOne,
  linkPackaging,
  list,
  listPackaging,
  listSuppliers,
  remove,
  unlinkPackaging,
  update,
} from './controller.js';

/**
 * Product routes. Open to any authenticated user, reads and writes alike. The product owns the
 * write side of the product↔packaging link; supplier↔product is read-only here (managed from
 * the supplier side) — an ownership rule, not a permission.
 */
export const productsRouter = Router();

productsRouter.use(requireAuth);

productsRouter.get('/:id/packaging', asyncHandler(listPackaging));
productsRouter.put('/:id/packaging/:packagingId', asyncHandler(linkPackaging));
productsRouter.delete('/:id/packaging/:packagingId', asyncHandler(unlinkPackaging));
productsRouter.get('/:id/suppliers', asyncHandler(listSuppliers));

productsRouter.get('/', asyncHandler(list));
productsRouter.get('/:id', asyncHandler(getOne));
productsRouter.post('/', asyncHandler(create));
productsRouter.patch('/:id', asyncHandler(update));
productsRouter.delete('/:id', asyncHandler(remove));
