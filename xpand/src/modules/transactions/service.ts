import type { transaction_type } from '@prisma/client';

import { DEFAULT_CURRENCY } from '../../config/constants.js';
import type { AuthenticatedUser } from '../../types/index.js';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../utils/AppError.js';
import type {
  CreateTransactionInput,
  ListTransactionsQuery,
  UpdateTransactionInput,
} from './schema.js';

/**
 * Enforce the category-type ↔ transaction-type rule.
 *
 * A category is INCOME, EXPENSE, or BOTH. A transaction is INCOME or EXPENSE. A BOTH category
 * accepts either; otherwise the transaction type must equal the category type. Also verifies
 * the referenced category actually exists (a dangling categoryId is a 400, not a 500).
 *
 * Exported because the invoices module has to apply the *same* rule when a verified OCR draft
 * becomes a transaction. Re-implementing it there would let the two surfaces drift, and the
 * drift would show up as an invoice that saves a transaction the expense form would reject.
 */
export async function assertCategoryCompatible(
  categoryId: number,
  type: transaction_type,
): Promise<void> {
  const category = await prisma.categories.findUnique({ where: { id: categoryId } });
  if (!category) {
    throw AppError.badRequest(`categoryId ${categoryId} does not exist`);
  }
  if (category.type !== 'BOTH' && category.type !== type) {
    throw AppError.badRequest(
      `Category "${category.name}" is ${category.type}-only and cannot take a ${type} transaction`,
    );
  }
}

/**
 * Load a transaction, or 404. Every authenticated user may read and edit every row — the
 * company's books are shared, not per-employee — so `user_id` records who logged the entry
 * and grants nothing.
 */
async function findOr404(id: number) {
  const txn = await prisma.transactions.findUnique({ where: { id } });
  if (!txn) {
    throw AppError.notFound('Transaction not found');
  }
  return txn;
}

/** List transactions with filters. Unfiltered, this is every user's rows. */
export function listTransactions(query: ListTransactionsQuery) {
  // `userId` is a plain filter now, not a permission boundary: omit it to see the whole ledger.
  const userId = query.userId;

  // Build the inclusive transaction_date range only if bounds were supplied.
  const dateFilter =
    query.from || query.to
      ? { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) }
      : undefined;

  return prisma.transactions.findMany({
    where: {
      ...(userId !== undefined ? { user_id: userId } : {}),
      ...(query.categoryId !== undefined ? { category_id: query.categoryId } : {}),
      ...(query.type !== undefined ? { type: query.type } : {}),
      ...(dateFilter ? { transaction_date: dateFilter } : {}),
    },
    orderBy: [{ transaction_date: 'desc' }, { id: 'desc' }],
  });
}

export function getTransaction(id: number) {
  return findOr404(id);
}

/** Create a transaction owned by the acting user. */
export async function createTransaction(input: CreateTransactionInput, actor: AuthenticatedUser) {
  await assertCategoryCompatible(input.categoryId, input.type);

  return prisma.transactions.create({
    data: {
      user_id: actor.id,
      category_id: input.categoryId,
      type: input.type,
      amount: input.amount,
      // Default explicitly (rather than relying on the DB default) so the app owns the value.
      currency: input.currency ?? DEFAULT_CURRENCY,
      description: input.description ?? null,
      transaction_date: input.transactionDate,
      ...(input.paymentMethod !== undefined ? { payment_method: input.paymentMethod } : {}),
      supplier_id: input.supplierId ?? null,
      product_id: input.productId ?? null,
      packaging_id: input.packagingId ?? null,
    },
  });
}

/** Update any transaction. */
export async function updateTransaction(id: number, input: UpdateTransactionInput) {
  const existing = await findOr404(id);

  // If either side of the compatibility pair is changing, re-check against the effective
  // (post-update) category and type — not just the fields that happened to be sent.
  if (input.categoryId !== undefined || input.type !== undefined) {
    const effectiveCategoryId = input.categoryId ?? existing.category_id;
    const effectiveType = input.type ?? existing.type;
    await assertCategoryCompatible(effectiveCategoryId, effectiveType);
  }

  return prisma.transactions.update({
    where: { id },
    data: {
      ...(input.categoryId !== undefined ? { category_id: input.categoryId } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.transactionDate !== undefined ? { transaction_date: input.transactionDate } : {}),
      ...(input.paymentMethod !== undefined ? { payment_method: input.paymentMethod } : {}),
      ...(input.supplierId !== undefined ? { supplier_id: input.supplierId } : {}),
      ...(input.productId !== undefined ? { product_id: input.productId } : {}),
      ...(input.packagingId !== undefined ? { packaging_id: input.packagingId } : {}),
      // The column has no @updatedAt, so bump it explicitly to reflect the edit.
      updated_at: new Date(),
    },
  });
}

/** Delete any transaction. */
export async function deleteTransaction(id: number): Promise<void> {
  await findOr404(id);
  await prisma.transactions.delete({ where: { id } });
}
