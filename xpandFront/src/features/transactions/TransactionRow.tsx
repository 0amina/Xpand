import { Link } from 'react-router-dom';

import { categoryVisual } from '@/lib/categoryMeta';
import {
  formatAmount,
  formatCategoryName,
  formatPaymentMethod,
  formatRelativeDate,
} from '@/lib/format';
import type { Category, Transaction } from '@/types/api';

interface TransactionRowProps {
  transaction: Transaction;
  /** Resolved from the categories list — transactions only carry `categoryId`. */
  category?: Category;
  /** Adds the date to the subtitle. Off inside date-grouped lists, where it would repeat. */
  showDate?: boolean;
  /** Marks rows whose invoice attachment exists only in this browser. */
  hasInvoice?: boolean;
}

/**
 * One transaction, as it appears everywhere it appears.
 *
 * The description leads when there is one — "Flour delivery" identifies the entry far faster
 * than "Suppliers" does — and the category falls back into the title slot when there isn't.
 */
export function TransactionRow({
  transaction,
  category,
  showDate = false,
  hasInvoice = false,
}: TransactionRowProps) {
  const visual = categoryVisual(category ?? { name: 'divers', icon: null, color: null });
  const isIncome = transaction.type === 'INCOME';
  const categoryName = formatCategoryName(category?.name);

  const subtitleParts = [
    transaction.description ? categoryName : null,
    formatPaymentMethod(transaction.paymentMethod),
    showDate ? formatRelativeDate(transaction.transactionDate) : null,
  ].filter(Boolean);

  return (
    <Link to={`/transactions/${transaction.id}`} className="list-row">
      <span
        className="cat-avatar"
        style={{ '--cat-color': visual.color } as React.CSSProperties}
        aria-hidden="true"
      >
        {visual.icon}
      </span>

      <span className="list-row__main">
        <span className="list-row__title">
          {transaction.description || categoryName}
          {hasInvoice && (
            <span title="Invoice attached" aria-label="Invoice attached">
              {' '}
              📎
            </span>
          )}
        </span>
        <span className="list-row__subtitle">{subtitleParts.join(' · ')}</span>
      </span>

      <span
        className={`numeric ${isIncome ? 'income-text' : 'expense-text'}`}
        style={{ fontWeight: 600 }}
      >
        {isIncome ? '+' : '−'}
        {formatAmount(transaction.amount)}
      </span>

      <span className="list-row__chevron" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}
