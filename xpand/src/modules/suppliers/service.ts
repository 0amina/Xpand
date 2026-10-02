import { Prisma } from '@prisma/client';

import { prisma } from '../../db/prisma.js';
import { AppError } from '../../utils/AppError.js';
import type { CreateSupplierInput, UpdateSupplierInput } from './schema.js';

/** Detail include: the supplier plus its linked products and packaging (with negotiated prices). */
const detailInclude = {
  supplier_products: { include: { products: true } },
  supplier_packaging: { include: { packaging: true } },
} satisfies Prisma.suppliersInclude;

/** List suppliers, optionally filtered by a case-insensitive search across text fields. */
export function listSuppliers(search?: string) {
  return prisma.suppliers.findMany({
    ...(search
      ? {
          where: {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { contact_person: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
            ],
          },
        }
      : {}),
    orderBy: { name: 'asc' },
  });
}

/** Fetch one supplier with its product/packaging links, or null. */
export function getSupplierById(id: number) {
  return prisma.suppliers.findUnique({ where: { id }, include: detailInclude });
}

export function createSupplier(input: CreateSupplierInput) {
  return prisma.suppliers.create({
    data: {
      name: input.name,
      contact_person: input.contactPerson ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
    },
    include: detailInclude,
  });
}

export async function updateSupplier(id: number, input: UpdateSupplierInput) {
  await assertSupplierExists(id);
  return prisma.suppliers.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.contactPerson !== undefined ? { contact_person: input.contactPerson } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    include: detailInclude,
  });
}

/**
 * Delete a supplier. Product/packaging links cascade automatically (junction FKs are
 * ON DELETE CASCADE). But transactions reference suppliers with ON DELETE NO ACTION, so a
 * supplier used by any transaction is refused with 409 rather than failing on a raw FK error.
 */
export async function deleteSupplier(id: number) {
  await assertSupplierExists(id);

  const inUse = await prisma.transactions.count({ where: { supplier_id: id } });
  if (inUse > 0) {
    throw AppError.conflict(
      `Cannot delete supplier ${id}: it is referenced by ${inUse} transaction(s)`,
    );
  }

  await prisma.suppliers.delete({ where: { id } });
}

// --- Relationships: supplier ↔ product, supplier ↔ packaging ---

export async function listSupplierProducts(supplierId: number) {
  await assertSupplierExists(supplierId);
  return prisma.supplier_products.findMany({
    where: { supplier_id: supplierId },
    include: { products: true },
  });
}

/** Link (or re-price) a product for a supplier. Idempotent upsert on the composite key. */
export async function linkSupplierProduct(
  supplierId: number,
  productId: number,
  unitPrice?: number,
) {
  await assertSupplierExists(supplierId);
  await assertProductExists(productId);

  return prisma.supplier_products.upsert({
    where: { supplier_id_product_id: { supplier_id: supplierId, product_id: productId } },
    create: { supplier_id: supplierId, product_id: productId, unit_price: unitPrice ?? null },
    update: { unit_price: unitPrice ?? null },
    include: { products: true },
  });
}

export async function unlinkSupplierProduct(supplierId: number, productId: number) {
  const link = await prisma.supplier_products.findUnique({
    where: { supplier_id_product_id: { supplier_id: supplierId, product_id: productId } },
  });
  if (!link) {
    throw AppError.notFound(`Supplier ${supplierId} is not linked to product ${productId}`);
  }
  await prisma.supplier_products.delete({
    where: { supplier_id_product_id: { supplier_id: supplierId, product_id: productId } },
  });
}

export async function listSupplierPackaging(supplierId: number) {
  await assertSupplierExists(supplierId);
  return prisma.supplier_packaging.findMany({
    where: { supplier_id: supplierId },
    include: { packaging: true },
  });
}

export async function linkSupplierPackaging(
  supplierId: number,
  packagingId: number,
  unitPrice?: number,
) {
  await assertSupplierExists(supplierId);
  await assertPackagingExists(packagingId);

  return prisma.supplier_packaging.upsert({
    where: { supplier_id_packaging_id: { supplier_id: supplierId, packaging_id: packagingId } },
    create: { supplier_id: supplierId, packaging_id: packagingId, unit_price: unitPrice ?? null },
    update: { unit_price: unitPrice ?? null },
    include: { packaging: true },
  });
}

export async function unlinkSupplierPackaging(supplierId: number, packagingId: number) {
  const link = await prisma.supplier_packaging.findUnique({
    where: { supplier_id_packaging_id: { supplier_id: supplierId, packaging_id: packagingId } },
  });
  if (!link) {
    throw AppError.notFound(`Supplier ${supplierId} is not linked to packaging ${packagingId}`);
  }
  await prisma.supplier_packaging.delete({
    where: { supplier_id_packaging_id: { supplier_id: supplierId, packaging_id: packagingId } },
  });
}

// --- Existence guards (shared, throw 404) ---

async function assertSupplierExists(id: number): Promise<void> {
  const found = await prisma.suppliers.findUnique({ where: { id }, select: { id: true } });
  if (!found) throw AppError.notFound('Supplier not found');
}
async function assertProductExists(id: number): Promise<void> {
  const found = await prisma.products.findUnique({ where: { id }, select: { id: true } });
  if (!found) throw AppError.notFound(`Product ${id} not found`);
}
async function assertPackagingExists(id: number): Promise<void> {
  const found = await prisma.packaging.findUnique({ where: { id }, select: { id: true } });
  if (!found) throw AppError.notFound(`Packaging ${id} not found`);
}
