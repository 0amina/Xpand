import { Prisma } from '@prisma/client';

import { DEFAULT_CURRENCY } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import type { ByCategoryQuery, SummaryQuery } from './schema.js';

const ZERO = new Prisma.Decimal(0);

// --- Date helpers. transaction_date is a DATE, which Prisma reads/writes at UTC midnight, so
// all boundaries are computed in UTC to line up exactly with stored values. ---

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function startOfNextDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
}
function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function startOfNextMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}
const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Resolve which user's data to report on. `userId` narrows to one person; omitting it — which
 * is what the app does — reports the company-wide position, which is the number Xpand exists
 * to show. Every authenticated user sees the same figures.
 */
function userScope(userId?: bigint): Prisma.transactionsWhereInput {
  return userId !== undefined ? { user_id: userId } : {};
}

/** Sum `amount` over the matching rows, returning a Decimal (0 when there are no rows). */
async function sumAmount(where: Prisma.transactionsWhereInput): Promise<Prisma.Decimal> {
  const result = await prisma.transactions.aggregate({ _sum: { amount: true }, where });
  return result._sum.amount ?? ZERO;
}

/**
 * The dashboard summary. Cash position follows the core principle:
 *
 *   Cash Position = Opening Balance + Total Income − Total Expenses
 *
 * "Total" and the cash position are computed as of the reference day (future-dated rows are
 * excluded), so the number reflects money on hand *now*, not scheduled entries.
 */
export async function getSummary(query: SummaryQuery) {
  const ref = query.on ?? new Date();
  const base = userScope(query.userId);

  const opening = new Prisma.Decimal(query.openingBalance ?? env.OPENING_BALANCE);

  // Boundaries.
  const todayStart = startOfDayUTC(ref);
  const todayEnd = startOfNextDayUTC(ref);
  const monthStart = startOfMonthUTC(ref);
  const monthEnd = startOfNextMonthUTC(ref);

  // All-time totals as of end-of-reference-day (exclude the future).
  const asOf: Prisma.transactionsWhereInput = { ...base, transaction_date: { lt: todayEnd } };
  const todayWhere: Prisma.transactionsWhereInput = {
    ...base,
    transaction_date: { gte: todayStart, lt: todayEnd },
  };
  const monthWhere: Prisma.transactionsWhereInput = {
    ...base,
    transaction_date: { gte: monthStart, lt: monthEnd },
  };

  // Run the six aggregates concurrently.
  const [totalIncome, totalExpenses, todayIncome, todayExpenses, monthIncome, monthExpenses] =
    await Promise.all([
      sumAmount({ ...asOf, type: 'INCOME' }),
      sumAmount({ ...asOf, type: 'EXPENSE' }),
      sumAmount({ ...todayWhere, type: 'INCOME' }),
      sumAmount({ ...todayWhere, type: 'EXPENSE' }),
      sumAmount({ ...monthWhere, type: 'INCOME' }),
      sumAmount({ ...monthWhere, type: 'EXPENSE' }),
    ]);

  const cashPosition = opening.plus(totalIncome).minus(totalExpenses);
  const netCashMovement = totalIncome.minus(totalExpenses); // all-time net (= cashPosition − opening)

  const money = (d: Prisma.Decimal) => d.toFixed(2);

  return {
    referenceDate: isoDate(ref),
    currency: DEFAULT_CURRENCY,
    openingBalance: money(opening),
    totalIncome: money(totalIncome),
    totalExpenses: money(totalExpenses),
    cashPosition: money(cashPosition),
    netCashMovement: money(netCashMovement),
    today: {
      date: isoDate(todayStart),
      income: money(todayIncome),
      expenses: money(todayExpenses),
      net: money(todayIncome.minus(todayExpenses)),
    },
    month: {
      year: monthStart.getUTCFullYear(),
      month: monthStart.getUTCMonth() + 1,
      income: money(monthIncome),
      expenses: money(monthExpenses),
      net: money(monthIncome.minus(monthExpenses)),
    },
  };
}

/**
 * Income and expenses grouped by category, over an optional inclusive date range. Returns two
 * arrays (income / expenses), each sorted by total descending, with the category name attached.
 */
export async function getByCategory(query: ByCategoryQuery) {
  const base = userScope(query.userId);

  const dateFilter =
    query.from || query.to
      ? {
          ...(query.from ? { gte: startOfDayUTC(query.from) } : {}),
          ...(query.to ? { lt: startOfNextDayUTC(query.to) } : {}),
        }
      : undefined;

  const where: Prisma.transactionsWhereInput = {
    ...base,
    ...(query.type ? { type: query.type } : {}),
    ...(dateFilter ? { transaction_date: dateFilter } : {}),
  };

  const grouped = await prisma.transactions.groupBy({
    by: ['category_id', 'type'],
    where,
    _sum: { amount: true },
    _count: { _all: true },
  });

  // Resolve category names in one query rather than N.
  const categoryIds = [...new Set(grouped.map((g) => g.category_id))];
  const categories = await prisma.categories.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(categories.map((c) => [c.id, c.name]));

  const rows = grouped.map((g) => ({
    categoryId: g.category_id,
    categoryName: nameById.get(g.category_id) ?? null,
    type: g.type,
    total: (g._sum.amount ?? ZERO).toFixed(2),
    count: g._count._all,
  }));

  const byTotalDesc = (a: { total: string }, b: { total: string }) =>
    Number(b.total) - Number(a.total);

  return {
    income: rows.filter((r) => r.type === 'INCOME').sort(byTotalDesc),
    expenses: rows.filter((r) => r.type === 'EXPENSE').sort(byTotalDesc),
  };
}
