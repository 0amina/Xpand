import { Prisma } from '@prisma/client';

import { prisma } from '../../db/prisma.js';
import { AppError } from '../../utils/AppError.js';
import type { CreatePackagingInput, UpdatePackagingInput } from './schema.js';

/** Detail include: suppliers that provide it, and products that use it (with quantity). */
const detailInclude = {
  supplier_packaging: { include: { suppliers: true } },
  product_packaging: { include: { products: true } },
} satisfies Prisma.packagingInclude;

export function listPackaging(search?: string) {
  return prisma.packaging.findMany({
    ...(search
      ? {
          where: {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { unit: { contains: search, mode: 'insensitive' } },
            ],
          },
        }
      : {}),
    orderBy: { name: 'asc' },
  });
}

export function getPackagingById(id: number) {
  return prisma.packaging.findUnique({ where: { id }, include: detailInclude });
}

export function createPackaging(input: CreatePackagingInput) {
  return prisma.packaging.create({
    data: {
      name: input.name,
      unit: input.unit ?? null,
      unit_cost: input.unitCost ?? null,
    },
    include: detailInclude,
  });
}

export async function updatePackaging(id: number, input: UpdatePackagingInput) {
  await assertPackagingExists(id);
  return prisma.packaging.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.unit !== undefined ? { unit: input.unit } : {}),
      ...(input.unitCost !== undefined ? { unit_cost: input.unitCost } : {}),
    },
    include: detailInclude,
  });
}

/**
 * Delete packaging. Supplier and product links cascade (junction FKs are ON DELETE CASCADE);
 * packaging referenced by any transaction is refused with 409.
 */
export async function deletePackaging(id: number) {
  await assertPackagingExists(id);

  const inUse = await prisma.transactions.count({ where: { packaging_id: id } });
  if (inUse > 0) {
    throw AppError.conflict(
      `Cannot delete packaging ${id}: it is referenced by ${inUse} transaction(s)`,
    );
  }

  await prisma.packaging.delete({ where: { id } });
}

/** Suppliers that provide this packaging (read side of supplier↔packaging). */
export async function listPackagingSuppliers(packagingId: number) {
  await assertPackagingExists(packagingId);
  return prisma.supplier_packaging.findMany({
    where: { packaging_id: packagingId },
    include: { suppliers: true },
  });
}

/** Products that use this packaging (read side of product↔packaging). */
export async function listPackagingProducts(packagingId: number) {
  await assertPackagingExists(packagingId);
  return prisma.product_packaging.findMany({
    where: { packaging_id: packagingId },
    include: { products: true },
  });
}

async function assertPackagingExists(id: number): Promise<void> {
  const found = await prisma.packaging.findUnique({ where: { id }, select: { id: true } });
  if (!found) throw AppError.notFound('Packaging not found');
}
