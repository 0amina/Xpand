import { Prisma } from '@prisma/client';

import { prisma } from '../../db/prisma.js';
import { AppError } from '../../utils/AppError.js';
import type { CreateProductInput, UpdateProductInput } from './schema.js';

/** Detail include: suppliers that carry the product, and packaging it uses (with quantity). */
const detailInclude = {
  supplier_products: { include: { suppliers: true } },
  product_packaging: { include: { packaging: true } },
} satisfies Prisma.productsInclude;

export function listProducts(search?: string) {
  return prisma.products.findMany({
    ...(search
      ? {
          where: {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { sku: { contains: search, mode: 'insensitive' } },
            ],
          },
        }
      : {}),
    orderBy: { name: 'asc' },
  });
}

export function getProductById(id: number) {
  return prisma.products.findUnique({ where: { id }, include: detailInclude });
}

/** Create a product. SKU is unique when present; pre-checked for a clean 409. */
export async function createProduct(input: CreateProductInput) {
  if (input.sku) await assertSkuFree(input.sku);

  return prisma.products.create({
    data: {
      name: input.name,
      sku: input.sku ?? null,
      description: input.description ?? null,
      unit_price: input.unitPrice ?? null,
    },
    include: detailInclude,
  });
}

export async function updateProduct(id: number, input: UpdateProductInput) {
  const product = await prisma.products.findUnique({ where: { id }, select: { sku: true } });
  if (!product) throw AppError.notFound('Product not found');

  if (input.sku && input.sku !== product.sku) await assertSkuFree(input.sku);

  return prisma.products.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.sku !== undefined ? { sku: input.sku } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.unitPrice !== undefined ? { unit_price: input.unitPrice } : {}),
    },
    include: detailInclude,
  });
}

/**
 * Delete a product. Supplier and packaging links cascade (junction FKs are ON DELETE CASCADE);
 * a product referenced by any transaction is refused with 409.
 */
export async function deleteProduct(id: number) {
  await assertProductExists(id);

  const inUse = await prisma.transactions.count({ where: { product_id: id } });
  if (inUse > 0) {
    throw AppError.conflict(
      `Cannot delete product ${id}: it is referenced by ${inUse} transaction(s)`,
    );
  }

  await prisma.products.delete({ where: { id } });
}

// --- Relationship: product ↔ packaging (quantity) ---

export async function listProductPackaging(productId: number) {
  await assertProductExists(productId);
  return prisma.product_packaging.findMany({
    where: { product_id: productId },
    include: { packaging: true },
  });
}

/** Link (or update the quantity of) packaging for a product. Idempotent upsert. */
export async function linkProductPackaging(productId: number, packagingId: number, quantity = 1) {
  await assertProductExists(productId);
  await assertPackagingExists(packagingId);

  return prisma.product_packaging.upsert({
    where: { product_id_packaging_id: { product_id: productId, packaging_id: packagingId } },
    create: { product_id: productId, packaging_id: packagingId, quantity },
    update: { quantity },
    include: { packaging: true },
  });
}

export async function unlinkProductPackaging(productId: number, packagingId: number) {
  const link = await prisma.product_packaging.findUnique({
    where: { product_id_packaging_id: { product_id: productId, packaging_id: packagingId } },
  });
  if (!link) {
    throw AppError.notFound(`Product ${productId} is not linked to packaging ${packagingId}`);
  }
  await prisma.product_packaging.delete({
    where: { product_id_packaging_id: { product_id: productId, packaging_id: packagingId } },
  });
}

/** List suppliers that carry this product (read side of supplier↔product). */
export async function listProductSuppliers(productId: number) {
  await assertProductExists(productId);
  return prisma.supplier_products.findMany({
    where: { product_id: productId },
    include: { suppliers: true },
  });
}

// --- Existence / uniqueness guards ---

async function assertProductExists(id: number): Promise<void> {
  const found = await prisma.products.findUnique({ where: { id }, select: { id: true } });
  if (!found) throw AppError.notFound('Product not found');
}
async function assertPackagingExists(id: number): Promise<void> {
  const found = await prisma.packaging.findUnique({ where: { id }, select: { id: true } });
  if (!found) throw AppError.notFound(`Packaging ${id} not found`);
}
async function assertSkuFree(sku: string): Promise<void> {
  const clash = await prisma.products.findUnique({ where: { sku }, select: { id: true } });
  if (clash) throw AppError.conflict(`A product with SKU "${sku}" already exists`);
}
