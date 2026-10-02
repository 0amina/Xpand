import type { category_type } from '@prisma/client';

import { prisma } from '../../db/prisma.js';
import { AppError } from '../../utils/AppError.js';
import type { CreateCategoryInput, UpdateCategoryInput } from './schema.js';

/** List categories, optionally filtered by type. Alphabetical by name. */
export function listCategories(type?: category_type) {
  return prisma.categories.findMany({
    ...(type ? { where: { type } } : {}),
    orderBy: { name: 'asc' },
  });
}

export function getCategoryById(id: number) {
  return prisma.categories.findUnique({ where: { id } });
}

/**
 * Create a category. Names are unique in the DB; we pre-check for a friendlier 409 than the
 * raw Prisma P2002, and the unique constraint still backstops any race.
 */
export async function createCategory(input: CreateCategoryInput) {
  const existing = await prisma.categories.findUnique({ where: { name: input.name } });
  if (existing) {
    throw AppError.conflict(`A category named "${input.name}" already exists`);
  }

  return prisma.categories.create({
    data: {
      name: input.name,
      type: input.type,
      icon: input.icon ?? null,
      color: input.color ?? null,
    },
  });
}

export async function updateCategory(id: number, input: UpdateCategoryInput) {
  const category = await getCategoryById(id);
  if (!category) {
    throw AppError.notFound('Category not found');
  }

  // If the name is changing, make sure it won't collide with a different category.
  if (input.name && input.name !== category.name) {
    const clash = await prisma.categories.findUnique({ where: { name: input.name } });
    if (clash) {
      throw AppError.conflict(`A category named "${input.name}" already exists`);
    }
  }

  return prisma.categories.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
    },
  });
}

/**
 * Delete a category.
 *
 * Defined behavior for a category still in use: refuse with 409. The FK from transactions →
 * categories is ON DELETE NO ACTION, so deleting an in-use category would otherwise surface
 * as an opaque DB error. We check the transaction count first and return a clear message
 * (deleting the category would strand or require reassigning its transactions).
 */
export async function deleteCategory(id: number) {
  const category = await getCategoryById(id);
  if (!category) {
    throw AppError.notFound('Category not found');
  }

  const inUse = await prisma.transactions.count({ where: { category_id: id } });
  if (inUse > 0) {
    throw AppError.conflict(
      `Cannot delete category "${category.name}": it is used by ${inUse} transaction(s)`,
    );
  }

  await prisma.categories.delete({ where: { id } });
}
