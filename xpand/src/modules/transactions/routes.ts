import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { create, getOne, list, remove, update } from './controller.js';

/**
 * Transaction routes. All require authentication, and that is the whole of it — every
 * authenticated user may read, edit and delete every transaction.
 */
export const transactionsRouter = Router();

transactionsRouter.use(requireAuth);

transactionsRouter.get('/', asyncHandler(list));
transactionsRouter.post('/', asyncHandler(create));
transactionsRouter.get('/:id', asyncHandler(getOne));
transactionsRouter.patch('/:id', asyncHandler(update));
transactionsRouter.delete('/:id', asyncHandler(remove));
