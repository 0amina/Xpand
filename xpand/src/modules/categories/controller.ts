import type { Request, Response } from 'express';

import {
  categoryIdParamSchema,
  createCategorySchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
} from './schema.js';
import {
  createCategory,
  deleteCategory,
  getCategoryById,
  listCategories,
  updateCategory,
} from './service.js';
import { AppError } from '../../utils/AppError.js';

// Category rows are already flat and JSON-safe (no BigInt/Decimal), so no DTO mapping needed.

/** GET /api/categories — any authenticated user. Optional `?type=`. */
export async function list(req: Request, res: Response): Promise<void> {
  const { type } = listCategoriesQuerySchema.parse(req.query);
  const categories = await listCategories(type);
  res.status(200).json({ data: categories });
}

/** GET /api/categories/:id — any authenticated user. */
export async function getOne(req: Request, res: Response): Promise<void> {
  const { id } = categoryIdParamSchema.parse(req.params);
  const category = await getCategoryById(id);
  if (!category) {
    throw AppError.notFound('Category not found');
  }
  res.status(200).json({ data: category });
}

/** POST /api/categories */
export async function create(req: Request, res: Response): Promise<void> {
  const input = createCategorySchema.parse(req.body);
  const category = await createCategory(input);
  res.status(201).json({ data: category });
}

/** PATCH /api/categories/:id */
export async function update(req: Request, res: Response): Promise<void> {
  const { id } = categoryIdParamSchema.parse(req.params);
  const input = updateCategorySchema.parse(req.body);
  const category = await updateCategory(id, input);
  res.status(200).json({ data: category });
}

/** DELETE /api/categories/:id — 409 if the category is still in use. */
export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = categoryIdParamSchema.parse(req.params);
  await deleteCategory(id);
  res.status(204).send();
}
