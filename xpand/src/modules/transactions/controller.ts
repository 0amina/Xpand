import type { Request, Response } from 'express';
import type { transactions as TransactionModel } from '@prisma/client';

import {
  createTransactionSchema,
  listTransactionsQuerySchema,
  transactionIdParamSchema,
  updateTransactionSchema,
} from './schema.js';
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  updateTransaction,
} from './service.js';

/** Map a Prisma transaction row to a camelCase, JSON-safe DTO (BigInt/Decimal/Date handled). */
function toTransactionDTO(t: TransactionModel) {
  return {
    id: t.id,
    userId: t.user_id.toString(), // BigInt → string.
    categoryId: t.category_id,
    type: t.type,
    amount: t.amount.toString(), // Decimal → string to preserve precision.
    currency: t.currency,
    description: t.description,
    transactionDate: t.transaction_date.toISOString().slice(0, 10), // DATE → YYYY-MM-DD.
    paymentMethod: t.payment_method,
    supplierId: t.supplier_id,
    productId: t.product_id,
    packagingId: t.packaging_id,
    createdAt: t.created_at.toISOString(),
    updatedAt: t.updated_at.toISOString(),
  };
}

/** GET /api/transactions — every user's rows, narrowed by the optional filters. */
export async function list(req: Request, res: Response): Promise<void> {
  const query = listTransactionsQuerySchema.parse(req.query);
  const rows = await listTransactions(query);
  res.status(200).json({ data: rows.map(toTransactionDTO) });
}

/** GET /api/transactions/:id */
export async function getOne(req: Request, res: Response): Promise<void> {
  const { id } = transactionIdParamSchema.parse(req.params);
  const txn = await getTransaction(id);
  res.status(200).json({ data: toTransactionDTO(txn) });
}

/** POST /api/transactions */
export async function create(req: Request, res: Response): Promise<void> {
  const input = createTransactionSchema.parse(req.body);
  const txn = await createTransaction(input, req.user!);
  res.status(201).json({ data: toTransactionDTO(txn) });
}

/** PATCH /api/transactions/:id */
export async function update(req: Request, res: Response): Promise<void> {
  const { id } = transactionIdParamSchema.parse(req.params);
  const input = updateTransactionSchema.parse(req.body);
  const txn = await updateTransaction(id, input);
  res.status(200).json({ data: toTransactionDTO(txn) });
}

/** DELETE /api/transactions/:id */
export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = transactionIdParamSchema.parse(req.params);
  await deleteTransaction(id);
  res.status(204).send();
}
