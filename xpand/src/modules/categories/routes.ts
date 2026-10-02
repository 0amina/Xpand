import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { create, getOne, list, remove, update } from './controller.js';

/**
 * Category routes. Reads and writes alike are open to any authenticated user.
 */
export const categoriesRouter = Router();

categoriesRouter.get('/', requireAuth, asyncHandler(list));
categoriesRouter.get('/:id', requireAuth, asyncHandler(getOne));

categoriesRouter.post('/', requireAuth, asyncHandler(create));
categoriesRouter.patch('/:id', requireAuth, asyncHandler(update));
categoriesRouter.delete('/:id', requireAuth, asyncHandler(remove));
