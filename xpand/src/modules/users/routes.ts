import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { getMe, getOne, list, login } from './controller.js';

/**
 * User routes.
 *
 * Order matters: `/login` and `/me` are declared before `/:id` so those literal paths aren't
 * captured by the parameterized route.
 */
export const usersRouter = Router();

// Public: first-contact upsert. This is what establishes a user's identity.
usersRouter.post('/login', asyncHandler(login));

// Any authenticated user can read their own profile.
usersRouter.get('/me', requireAuth, asyncHandler(getMe));

// Open to any authenticated user, like everything else — there is no privileged tier.
usersRouter.get('/', requireAuth, asyncHandler(list));
usersRouter.get('/:id', requireAuth, asyncHandler(getOne));
