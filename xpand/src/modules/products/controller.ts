import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';

import { AppError } from '../../utils/AppError.js';
import { intIdParamSchema, intIdSchema } from '../../utils/validation.js';
import {
  createProductSchema,
  listProductsQuerySchema,
  productPackagingLinkSchema,
  updateProductSchema,
} from './schema.js';
import {
  createProduct,
  deleteProduct,
  getProductById,
  linkProductPackaging,
  listProductPackaging,
  listProducts,
  listProductSuppliers,
  unlinkProductPackaging,
  updateProduct,
} from './service.js';

const money = (d: Prisma.Decimal | null) => (d === null ? null : d.toFixed(2));

type ProductWithLinks = Prisma.productsGetPayload<{
  include: {
    supplier_products: { include: { suppliers: true } };
    product_packaging: { include: { packaging: true } };
  };
}>;

function toProductDTO(p: ProductWithLinks | Prisma.productsGetPayload<object>) {
  const base = {
    id: p.id,
    name: p.name,
    sku: p.sku,
    description: p.description,
    unitPrice: money(p.unit_price),
    createdAt: p.created_at.toISOString(),
  };
  if (!('supplier_products' in p)) return base;

  return {
    ...base,
    suppliers: p.supplier_products.map((sp) => ({
      supplierId: sp.supplier_id,
      unitPrice: money(sp.unit_price),
      supplier: { id: sp.suppliers.id, name: sp.suppliers.name },
    })),
    packaging: p.product_packaging.map((pp) => ({
      packagingId: pp.packaging_id,
      quantity: pp.quantity,
      packaging: { id: pp.packaging.id, name: pp.packaging.name, unit: pp.packaging.unit },
    })),
  };
}

/** GET /api/products?search= */
export async function list(req: Request, res: Response): Promise<void> {
  const { search } = listProductsQuerySchema.parse(req.query);
  const rows = await listProducts(search);
  res.status(200).json({ data: rows.map(toProductDTO) });
}

/** GET /api/products/:id — includes suppliers & packaging. */
export async function getOne(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  const product = await getProductById(id);
  if (!product) throw AppError.notFound('Product not found');
  res.status(200).json({ data: toProductDTO(product) });
}

export async function create(req: Request, res: Response): Promise<void> {
  const input = createProductSchema.parse(req.body);
  const product = await createProduct(input);
  res.status(201).json({ data: toProductDTO(product) });
}

export async function update(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  const input = updateProductSchema.parse(req.body);
  const product = await updateProduct(id, input);
  res.status(200).json({ data: toProductDTO(product) });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  await deleteProduct(id);
  res.status(204).send();
}

// --- Relationships ---

const packagingLinkDTO = (pp: {
  packaging_id: number;
  quantity: number;
  packaging: { id: number; name: string; unit: string | null };
}) => ({
  packagingId: pp.packaging_id,
  quantity: pp.quantity,
  packaging: { id: pp.packaging.id, name: pp.packaging.name, unit: pp.packaging.unit },
});

/** GET /api/products/:id/packaging */
export async function listPackaging(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  const rows = await listProductPackaging(id);
  res.status(200).json({ data: rows.map(packagingLinkDTO) });
}

/** PUT /api/products/:id/packaging/:packagingId — link/set quantity. */
export async function linkPackaging(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  const packagingId = intIdSchema.parse(req.params.packagingId);
  const { quantity } = productPackagingLinkSchema.parse(req.body ?? {});
  const link = await linkProductPackaging(id, packagingId, quantity);
  res.status(200).json({ data: packagingLinkDTO(link) });
}

/** DELETE /api/products/:id/packaging/:packagingId — unlink. */
export async function unlinkPackaging(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  const packagingId = intIdSchema.parse(req.params.packagingId);
  await unlinkProductPackaging(id, packagingId);
  res.status(204).send();
}

/** GET /api/products/:id/suppliers — read side of supplier↔product. */
export async function listSuppliers(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  const rows = await listProductSuppliers(id);
  res.status(200).json({
    data: rows.map((sp) => ({
      supplierId: sp.supplier_id,
      unitPrice: money(sp.unit_price),
      supplier: { id: sp.suppliers.id, name: sp.suppliers.name },
    })),
  });
}
