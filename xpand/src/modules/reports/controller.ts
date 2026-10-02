import type { Request, Response } from 'express';

import { byCategoryQuerySchema, summaryQuerySchema } from './schema.js';
import { getByCategory, getSummary } from './service.js';

/**
 * GET /api/reports/summary — cash position, today's and this month's income/expenses, and net
 * movement. Company-wide unless narrowed with `?userId=`.
 */
export async function summary(req: Request, res: Response): Promise<void> {
  const query = summaryQuerySchema.parse(req.query);
  const data = await getSummary(query);
  res.status(200).json({ data });
}

/**
 * GET /api/reports/by-category — income and expenses grouped by category, over an optional
 * inclusive date range (`from`/`to`) and optional `type` filter.
 */
export async function byCategory(req: Request, res: Response): Promise<void> {
  const query = byCategoryQuerySchema.parse(req.query);
  const data = await getByCategory(query);
  res.status(200).json({ data });
}
