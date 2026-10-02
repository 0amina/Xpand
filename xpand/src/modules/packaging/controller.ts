import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';

import { AppError } from '../../utils/AppError.js';
import { intIdParamSchema } from '../../utils/validation.js';
import {
  createPackagingSchema,
  listPackagingQuerySchema,
  updatePackagingSchema,
} from './schema.js';
import {
  createPackaging,
  deletePackaging,
  getPackagingById,
  listPackaging,
  listPackagingProducts,
  listPackagingSuppliers,
  updatePackaging,
} from './service.js';

const money = (d: Prisma.Decimal | null) => (d === null ? null : d.toFixed(2));

type PackagingWithLinks = Prisma.packagingGetPayload<{
  include: {
    supplier_packaging: { include: { suppliers: true } };
    product_packaging: { include: { products: true } };
  };
}>;

function toPackagingDTO(p: PackagingWithLinks | Prisma.packagingGetPayload<object>) {
  const base = {
    id: p.id,
    name: p.name,
    unit: p.unit,
    unitCost: money(p.unit_cost),
    createdAt: p.created_at.toISOString(),
  };
  if (!('supplier_packaging' in p)) return base;

  return {
    ...base,
    suppliers: p.supplier_packaging.map((sp) => ({
      supplierId: sp.supplier_id,
      unitPrice: money(sp.unit_price),
      supplier: { id: sp.suppliers.id, name: sp.suppliers.name },
    })),
    products: p.product_packaging.map((pp) => ({
      productId: pp.product_id,
      quantity: pp.quantity,
      product: { id: pp.products.id, name: pp.products.name, sku: pp.products.sku },
    })),
  };
}

/** GET /api/packaging?search= */
export async function list(req: Request, res: Response): Promise<void> {
  const { search } = listPackagingQuerySchema.parse(req.query);
  const rows = await listPackaging(search);
  res.status(200).json({ data: rows.map(toPackagingDTO) });
}

/** GET /api/packaging/:id — includes suppliers & products. */
export async function getOne(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  const pkg = await getPackagingById(id);
  if (!pkg) throw AppError.notFound('Packaging not found');
  res.status(200).json({ data: toPackagingDTO(pkg) });
}

export async function create(req: Request, res: Response): Promise<void> {
  const input = createPackagingSchema.parse(req.body);
  const pkg = await createPackaging(input);
  res.status(201).json({ data: toPackagingDTO(pkg) });
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  const input = updatePackagingSchema.parse(req.body);
  const pkg = await updatePackaging(id, input);
  res.status(200).json({ data: toPackagingDTO(pkg) });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  await deletePackaging(id);
  res.status(204).send();
}

/** GET /api/packaging/:id/suppliers — read side of supplier↔packaging. */
export async function listSuppliers(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  const rows = await listPackagingSuppliers(id);
  res.status(200).json({
    data: rows.map((sp) => ({
      supplierId: sp.supplier_id,
      unitPrice: money(sp.unit_price),
      supplier: { id: sp.suppliers.id, name: sp.suppliers.name },
    })),
  });
}

/** GET /api/packaging/:id/products — read side of product↔packaging. */
export async function listProducts(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  const rows = await listPackagingProducts(id);
  res.status(200).json({
    data: rows.map((pp) => ({
      productId: pp.product_id,
      quantity: pp.quantity,
      product: { id: pp.products.id, name: pp.products.name, sku: pp.products.sku },
    })),
  });
}
