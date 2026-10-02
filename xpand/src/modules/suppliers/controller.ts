import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';

import { AppError } from '../../utils/AppError.js';
import { intIdParamSchema, intIdSchema } from '../../utils/validation.js';
import {
  createSupplierSchema,
  listSuppliersQuerySchema,
  supplierLinkSchema,
  updateSupplierSchema,
} from './schema.js';
import {
  createSupplier,
  deleteSupplier,
  getSupplierById,
  linkSupplierPackaging,
  linkSupplierProduct,
  listSupplierPackaging,
  listSuppliers,
  listSupplierProducts,
  unlinkSupplierPackaging,
  unlinkSupplierProduct,
  updateSupplier,
} from './service.js';

// NUMERIC(12,2) → 2-decimal string (or null). Product/packaging costs are money.
const money = (d: Prisma.Decimal | null) => (d === null ? null : d.toFixed(2));

type SupplierWithLinks = Prisma.suppliersGetPayload<{
  include: {
    supplier_products: { include: { products: true } };
    supplier_packaging: { include: { packaging: true } };
  };
}>;

function toSupplierDTO(s: SupplierWithLinks | Prisma.suppliersGetPayload<object>) {
  const base = {
    id: s.id,
    name: s.name,
    contactPerson: s.contact_person,
    phone: s.phone,
    email: s.email,
    address: s.address,
    notes: s.notes,
    createdAt: s.created_at.toISOString(),
  };
  if (!('supplier_products' in s)) return base;

  return {
    ...base,
    products: s.supplier_products.map((sp) => ({
      productId: sp.product_id,
      unitPrice: money(sp.unit_price),
      product: { id: sp.products.id, name: sp.products.name, sku: sp.products.sku },
    })),
    packaging: s.supplier_packaging.map((sp) => ({
      packagingId: sp.packaging_id,
      unitPrice: money(sp.unit_price),
      packaging: { id: sp.packaging.id, name: sp.packaging.name, unit: sp.packaging.unit },
    })),
  };
}

/** GET /api/suppliers?search= */
export async function list(req: Request, res: Response): Promise<void> {
  const { search } = listSuppliersQuerySchema.parse(req.query);
  const rows = await listSuppliers(search);
  res.status(200).json({ data: rows.map(toSupplierDTO) });
}

/** GET /api/suppliers/:id — includes linked products & packaging. */
export async function getOne(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  const supplier = await getSupplierById(id);
  if (!supplier) throw AppError.notFound('Supplier not found');
  res.status(200).json({ data: toSupplierDTO(supplier) });
}

/** POST /api/suppliers */
export async function create(req: Request, res: Response): Promise<void> {
  const input = createSupplierSchema.parse(req.body);
  const supplier = await createSupplier(input);
  res.status(201).json({ data: toSupplierDTO(supplier) });
}

/** PATCH /api/suppliers/:id */
export async function update(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  const input = updateSupplierSchema.parse(req.body);
  const supplier = await updateSupplier(id, input);
  res.status(200).json({ data: toSupplierDTO(supplier) });
}

/** DELETE /api/suppliers/:id — 409 if referenced by transactions. */
export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  await deleteSupplier(id);
  res.status(204).send();
}

// --- Relationship endpoints ---

const linkDTO = {
  product: (sp: {
    product_id: number;
    unit_price: Prisma.Decimal | null;
    products: { id: number; name: string; sku: string | null };
  }) => ({
    productId: sp.product_id,
    unitPrice: money(sp.unit_price),
    product: { id: sp.products.id, name: sp.products.name, sku: sp.products.sku },
  }),
  packaging: (sp: {
    packaging_id: number;
    unit_price: Prisma.Decimal | null;
    packaging: { id: number; name: string; unit: string | null };
  }) => ({
    packagingId: sp.packaging_id,
    unitPrice: money(sp.unit_price),
    packaging: { id: sp.packaging.id, name: sp.packaging.name, unit: sp.packaging.unit },
  }),
};

/** GET /api/suppliers/:id/products */
export async function listProducts(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  const rows = await listSupplierProducts(id);
  res.status(200).json({ data: rows.map(linkDTO.product) });
}

/** PUT /api/suppliers/:id/products/:productId — link/re-price. */
export async function linkProduct(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  const productId = intIdSchema.parse(req.params.productId);
  const { unitPrice } = supplierLinkSchema.parse(req.body ?? {});
  const link = await linkSupplierProduct(id, productId, unitPrice);
  res.status(200).json({ data: linkDTO.product(link) });
}

/** DELETE /api/suppliers/:id/products/:productId — unlink. */
export async function unlinkProduct(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  const productId = intIdSchema.parse(req.params.productId);
  await unlinkSupplierProduct(id, productId);
  res.status(204).send();
}

/** GET /api/suppliers/:id/packaging */
export async function listPackaging(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  const rows = await listSupplierPackaging(id);
  res.status(200).json({ data: rows.map(linkDTO.packaging) });
}

/** PUT /api/suppliers/:id/packaging/:packagingId — link/re-price. */
export async function linkPackaging(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  const packagingId = intIdSchema.parse(req.params.packagingId);
  const { unitPrice } = supplierLinkSchema.parse(req.body ?? {});
  const link = await linkSupplierPackaging(id, packagingId, unitPrice);
  res.status(200).json({ data: linkDTO.packaging(link) });
}

/** DELETE /api/suppliers/:id/packaging/:packagingId — unlink. */
export async function unlinkPackaging(req: Request, res: Response): Promise<void> {
  const { id } = intIdParamSchema.parse(req.params);
  const packagingId = intIdSchema.parse(req.params.packagingId);
  await unlinkSupplierPackaging(id, packagingId);
  res.status(204).send();
}
