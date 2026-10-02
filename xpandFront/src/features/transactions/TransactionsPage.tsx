import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  useCategories,
  useCategoryMap,
  useTransactions,
  useTransactionsWithInvoices,
} from '@/api/hooks';
import { Button } from '@/components/ui/Button';
import { Chip, Segmented } from '@/components/ui/Chip';
import { Sheet } from '@/components/ui/Sheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { categoryVisual } from '@/lib/categoryMeta';
import {
  addDays,
  endOfMonth,
  formatAmount,
  formatCategoryName,
  formatRelativeDate,
  formatSigned,
  startOfMonth,
  toNumber,
  todayISO,
} from '@/lib/format';

import type { Transaction, TransactionFilters, TransactionType } from '@/types/api';

import { TransactionRow } from './TransactionRow';
import './transactions.css';

/** How many rows to render at once. The API returns everything, so windowing is client-side. */
const PAGE_SIZE = 50;

type TypeFilter = 'ALL' | TransactionType;

/** Named date windows. `null` bounds mean "unbounded on that side". */
function datePresets(today: string) {
  return [
    { id: 'all', label: 'All time', from: undefined, to: undefined },
    { id: 'today', label: 'Today', from: today, to: today },
    { id: 'week', label: 'Last 7 days', from: addDays(today, -6), to: today },
    { id: 'month', label: 'This month', from: startOfMonth(today), to: endOfMonth(today) },
    {
      id: 'last-month',
      label: 'Last month',
      from: startOfMonth(addDays(startOfMonth(today), -1)),
      to: endOfMonth(addDays(startOfMonth(today), -1)),
    },
  ] as const;
}

/**
 * Transaction history: view, filter, drill in.
 *
 * Filters live in the URL rather than in component state so a filtered view is linkable — the
 * dashboard's "This month" shortcut is just a link into this screen — and so it survives a
 * remount when Telegram reloads the Mini App.
 *
 * Note the backend returns the *whole* matching set with no pagination (ordered
 * `transaction_date desc, id desc`). Rather than pretend otherwise, the list renders a window
 * and grows it on demand, and the totals strip is computed over everything that came back.
 */
export function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const today = todayISO();
  const presets = datePresets(today);

  const typeFilter = (searchParams.get('type') ?? 'ALL') as TypeFilter;
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;
  const categoryIdParam = searchParams.get('categoryId');
  const categoryId = categoryIdParam ? Number(categoryIdParam) : undefined;

  const filters: TransactionFilters = {
    ...(typeFilter !== 'ALL' ? { type: typeFilter } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(categoryId ? { categoryId } : {}),
  };

  const transactions = useTransactions(filters);
  const categoriesQuery = useCategories();
  const categoryMap = useCategoryMap();
  // One request for the whole list rather than one per row — see the hook's note.
  const invoicedTransactions = useTransactionsWithInvoices();

  /** Merge into the URL, dropping empty values and resetting the render window. */
  const updateFilters = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
    setVisibleCount(PAGE_SIZE);
  };

  const activePreset =
    presets.find((preset) => preset.from === from && preset.to === to)?.id ??
    (from || to ? 'custom' : 'all');

  const rows = useMemo(() => transactions.data ?? [], [transactions.data]);

  // Totals over the full filtered result, not just the rendered window.
  const totals = useMemo(() => {
    let income = 0;
    let expenses = 0;
    for (const row of rows) {
      if (row.type === 'INCOME') income += toNumber(row.amount);
      else expenses += toNumber(row.amount);
    }
    return { income, expenses, net: income - expenses };
  }, [rows]);

  const groups = useMemo(() => groupByDate(rows.slice(0, visibleCount)), [rows, visibleCount]);
  const hasMore = rows.length > visibleCount;
  const selectedCategory = categoryId ? categoryMap.get(categoryId) : undefined;

  return (
    <>
      <div className="filter-bar">
        <Segmented
          ariaLabel="Filter by type"
          value={typeFilter}
          onChange={(value) => updateFilters({ type: value === 'ALL' ? undefined : value })}
          options={[
            { value: 'ALL', label: 'All' },
            { value: 'INCOME', label: 'Income', tone: 'income' },
            { value: 'EXPENSE', label: 'Expense', tone: 'expense' },
          ]}
        />

        <div className="filter-bar__row">
          {presets.map((preset) => (
            <Chip
              key={preset.id}
              selected={activePreset === preset.id}
              onClick={() => updateFilters({ from: preset.from, to: preset.to })}
            >
              {preset.label}
            </Chip>
          ))}
          <Chip selected={Boolean(categoryId)} onClick={() => setCategorySheetOpen(true)}>
            {selectedCategory ? formatCategoryName(selectedCategory.name) : 'Category'} ▾
          </Chip>
        </div>

        {/* Custom range. Shown only once a preset is active or a custom range is set, so the
            default view stays uncluttered. */}
        {(from || to) && (
          <div className="date-quick-row">
            <input
              type="date"
              className="input"
              value={from ?? ''}
              max={to ?? today}
              aria-label="From date"
              onChange={(event) => updateFilters({ from: event.target.value || undefined })}
            />
            <span style={{ color: 'var(--x-text-subtle)' }}>→</span>
            <input
              type="date"
              className="input"
              value={to ?? ''}
              min={from ?? undefined}
              aria-label="To date"
              onChange={(event) => updateFilters({ to: event.target.value || undefined })}
            />
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="totals-strip">
          <div className="totals-strip__cell">
            <span className="totals-strip__label">In</span>
            <span className="totals-strip__value income-text numeric">
              {formatAmount(totals.income)}
            </span>
          </div>
          <div className="totals-strip__cell">
            <span className="totals-strip__label">Out</span>
            <span className="totals-strip__value expense-text numeric">
              {formatAmount(totals.expenses)}
            </span>
          </div>
          <div className="totals-strip__cell">
            <span className="totals-strip__label">Net</span>
            <span
              className={`totals-strip__value numeric ${
                totals.net >= 0 ? 'income-text' : 'expense-text'
              }`}
            >
              {formatSigned(totals.net)}
            </span>
          </div>
        </div>
      )}

      {transactions.isLoading ? (
        <LoadingState label="Loading transactions…" />
      ) : transactions.isError ? (
        <ErrorState error={transactions.error} onRetry={() => void transactions.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No transactions match"
          description={
            Object.keys(filters).length > 0
              ? 'Try widening the date range or clearing a filter.'
              : 'Log your first income or expense to see it here.'
          }
          action={
            Object.keys(filters).length > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {groups.map((group) => (
            <section className="day-group" key={group.date}>
              <header className="day-group__header">
                <span className="day-group__date">{formatRelativeDate(group.date)}</span>
                <span
                  className={`day-group__net numeric ${
                    group.net >= 0 ? 'income-text' : 'expense-text'
                  }`}
                >
                  {formatSigned(group.net)}
                </span>
              </header>
              <ul className="day-group__list">
                {group.items.map((transaction) => (
                  <li key={transaction.id}>
                    <TransactionRow
                      transaction={transaction}
                      category={categoryMap.get(transaction.categoryId)}
                      hasInvoice={invoicedTransactions.data?.has(transaction.id) ?? false}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {hasMore && (
            <div style={{ padding: 'var(--x-space-4)' }}>
              <Button
                variant="secondary"
                block
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              >
                Show more ({rows.length - visibleCount} left)
              </Button>
            </div>
          )}
        </>
      )}

      <Sheet
        open={categorySheetOpen}
        onClose={() => setCategorySheetOpen(false)}
        title="Filter by category"
        flush
      >
        <ul>
          <li>
            <button
              type="button"
              className="picker-option"
              onClick={() => {
                updateFilters({ categoryId: undefined });
                setCategorySheetOpen(false);
              }}
            >
              <span className="picker-option__name">All categories</span>
              {!categoryId && <span className="picker-option__check">✓</span>}
            </button>
          </li>
          {(categoriesQuery.data ?? []).map((category) => {
            const visual = categoryVisual(category);
            return (
              <li key={category.id}>
                <button
                  type="button"
                  className="picker-option"
                  onClick={() => {
                    updateFilters({ categoryId: String(category.id) });
                    setCategorySheetOpen(false);
                  }}
                >
                  <span
                    className="cat-avatar cat-avatar--sm"
                    style={{ '--cat-color': visual.color } as React.CSSProperties}
                    aria-hidden="true"
                  >
                    {visual.icon}
                  </span>
                  <span className="picker-option__name">{formatCategoryName(category.name)}</span>
                  <span className="picker-option__meta">{category.type}</span>
                  {categoryId === category.id && <span className="picker-option__check">✓</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}

interface DayGroup {
  date: string;
  items: Transaction[];
  net: number;
}

/**
 * Bucket rows by `transactionDate`, preserving the order the API returned.
 *
 * Relies on that order (`transaction_date desc, id desc`) rather than re-sorting: the server
 * already did it, and re-sorting client-side would break the tie-break on same-day rows.
 */
function groupByDate(transactions: Transaction[]): DayGroup[] {
  const groups: DayGroup[] = [];
  let current: DayGroup | undefined;

  for (const transaction of transactions) {
    if (!current || current.date !== transaction.transactionDate) {
      current = { date: transaction.transactionDate, items: [], net: 0 };
      groups.push(current);
    }
    current.items.push(transaction);
    current.net +=
      transaction.type === 'INCOME' ? toNumber(transaction.amount) : -toNumber(transaction.amount);
  }

  return groups;
}
