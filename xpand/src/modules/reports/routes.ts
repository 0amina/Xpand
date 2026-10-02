import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { byCategory, summary } from './controller.js';

/**
 * Report routes. All require authentication and nothing more: every authenticated user sees the
 * same company-wide figures, optionally narrowed to one person with `?userId=`.
 */
export const reportsRouter = Router();

reportsRouter.use(requireAuth);

reportsRouter.get('/summary', asyncHandler(summary));
reportsRouter.get('/by-category', asyncHandler(byCategory));
