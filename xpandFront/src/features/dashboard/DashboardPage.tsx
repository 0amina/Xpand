import { Link } from 'react-router-dom';

import {
  useCategoryMap,
  useInvoices,
  useSummary,
  useTransactions,
  useTransactionsWithInvoices,
} from '@/api/hooks';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { useAuth } from '@/hooks/useAuth';
import { formatAmount, formatDateLong, formatSigned, toNumber, todayISO } from '@/lib/format';
import { haptics } from '@/lib/telegram';

import { TransactionRow } from '../transactions/TransactionRow';
import './dashboard.css';

/** How many recent rows the dashboard shows before deferring to the History tab. */
const RECENT_LIMIT = 6;

export function DashboardPage() {
  const { user } = useAuth();
  const today = todayISO();

  const summary = useSummary();
  const categoryMap = useCategoryMap();
  // No date filter: the most recent activity is what matters here, whenever it happened.
  // The API already sorts by transaction_date desc, id desc.
  const recent = useTransactions();

  // Server-backed now: how many uploaded invoices nobody has verified yet. Unreviewed invoices
  // are money not yet in the cash position above, which is exactly why this sits next to it.
  const invoices = useInvoices();
  const awaitingReview = invoices.data?.meta?.awaitingReview ?? 0;
  const invoicedTransactions = useTransactionsWithInvoices();
  const recentTransactions = (recent.data ?? []).slice(0, RECENT_LIMIT);

  return (
    <div className="page">
      <div className="dash-greeting">
        <span className="dash-greeting__name">{user ? `Hi, ${user.firstName}` : 'Xpand'}</span>
        <span className="dash-greeting__date">{formatDateLong(today)}</span>
      </div>

      {/* --- Cash position --- */}
      {summary.isError ? (
        <Card>
          <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
        </Card>
      ) : (
        <CashPositionCard
          value={summary.data?.cashPosition}
          currency={summary.data?.currency}
          openingBalance={summary.data?.openingBalance}
          loading={summary.isLoading}
        />
      )}

      {/* --- Today --- */}
      <div className="today-grid">
        <StatTile
          label="Today in"
          icon="↓"
          tone="income"
          value={summary.data?.today.income}
          loading={summary.isLoading}
        />
        <StatTile
          label="Today out"
          icon="↑"
          tone="expense"
          value={summary.data?.today.expenses}
          loading={summary.isLoading}
        />
      </div>

      {summary.data && (
        <div className="net-strip">
          <span className="net-strip__label">Today's net</span>
          <span
            className={`net-strip__value numeric ${
              toNumber(summary.data.today.net) >= 0 ? 'income-text' : 'expense-text'
            }`}
          >
            {formatSigned(summary.data.today.net, summary.data.currency)}
          </span>
        </div>
      )}

      {/* --- Quick actions --- */}
      <div>
        <span className="section-label">Quick actions</span>
        <div className="quick-actions" style={{ marginTop: 'var(--x-space-2)' }}>
          <Link
            to="/add/income"
            className="quick-action quick-action--income"
            onClick={() => haptics.impact('medium')}
          >
            <span className="quick-action__title">+ Income</span>
            <span className="quick-action__hint">Log money in</span>
          </Link>
          <Link
            to="/add/expense"
            className="quick-action quick-action--expense"
            onClick={() => haptics.impact('medium')}
          >
            <span className="quick-action__title">− Expense</span>
            <span className="quick-action__hint">Log money out</span>
          </Link>
        </div>

        <div
          className="quick-actions quick-actions--secondary"
          style={{ marginTop: 'var(--x-space-3)' }}
        >
          <Link to="/transactions" className="quick-action quick-action--muted">
            <span aria-hidden="true">≡</span> All transactions
          </Link>
          <Link
            to={`/transactions?from=${summary.data?.month ? monthStartISO(summary.data) : today}&to=${today}`}
            className="quick-action quick-action--muted"
          >
            <span aria-hidden="true">📅</span> This month
          </Link>
          <Link to="/invoices/scan" className="quick-action quick-action--muted">
            <span aria-hidden="true">🧾</span> Scan invoice
          </Link>
        </div>
      </div>

      {/* --- This month --- */}
      {summary.data && (
        <Card>
          <CardHeader title="This month" />
          <div className="today-grid">
            <div>
              <div className="stat-tile__label">In</div>
              <div className="stat-tile__value stat-tile__value--income numeric">
                {formatAmount(summary.data.month.income)}
              </div>
            </div>
            <div>
              <div className="stat-tile__label">Out</div>
              <div className="stat-tile__value stat-tile__value--expense numeric">
                {formatAmount(summary.data.month.expenses)}
              </div>
            </div>
          </div>
          <div className="cash-hero__footnote">
            Net {formatSigned(summary.data.month.net, summary.data.currency)}
          </div>
        </Card>
      )}

      {awaitingReview > 0 && (
        <Link to="/invoices" className="dashboard-notice" style={{ textDecoration: 'none' }}>
          <span aria-hidden="true">🧾</span>
          <span>
            <strong>
              {awaitingReview} invoice{awaitingReview > 1 ? 's' : ''} waiting for review.
            </strong>{' '}
            Not in the figures above until checked and saved. Tap to review.
          </span>
        </Link>
      )}

      {/* --- Recent transactions --- */}
      <Card flush>
        <div style={{ padding: 'var(--x-space-4) var(--x-space-4) 0' }}>
          <CardHeader
            title="Recent"
            action={
              <Link to="/transactions" style={{ fontSize: 'var(--x-text-sm)', fontWeight: 600 }}>
                See all
              </Link>
            }
          />
        </div>

        {recent.isError ? (
          <ErrorState error={recent.error} onRetry={() => void recent.refetch()} />
        ) : recent.isLoading ? (
          <RowSkeletons />
        ) : recentTransactions.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="Nothing logged yet"
            description="Your first income or expense will show up here."
          />
        ) : (
          <ul>
            {recentTransactions.map((transaction) => (
              <li key={transaction.id}>
                <TransactionRow
                  transaction={transaction}
                  category={categoryMap.get(transaction.categoryId)}
                  showDate
                  hasInvoice={invoicedTransactions.data?.has(transaction.id) ?? false}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** `2026-09-01` for the summary's reported month — used by the "This month" shortcut. */
function monthStartISO(summary: { month: { year: number; month: number } }): string {
  return `${summary.month.year}-${String(summary.month.month).padStart(2, '0')}-01`;
}

function CashPositionCard({
  value,
  currency,
  openingBalance,
  loading,
}: {
  value?: string;
  currency?: string;
  openingBalance?: string;
  loading: boolean;
}) {
  const numeric = toNumber(value);

  return (
    <div className="cash-hero">
      <span className="cash-hero__label">
        <span aria-hidden="true">◎</span> Cash position
      </span>

      {loading ? (
        <div className="skeleton" style={{ height: 40, width: '65%' }} />
      ) : (
        <span
          className={`cash-hero__value numeric ${numeric < 0 ? 'cash-hero__value--negative' : ''}`}
        >
          {formatAmount(value)}
          <span className="cash-hero__currency">{currency}</span>
        </span>
      )}

      {/*
        The opening balance is not a DB column — it comes from the backend's OPENING_BALANCE
        env var. Showing it makes the arithmetic auditable rather than magic, and explains a
        cash position that does not match the sum of visible transactions.
      */}
      {!loading && openingBalance !== undefined && (
        <span className="cash-hero__footnote">
          Opening {formatAmount(openingBalance)} + income − expenses, as of today
        </span>
      )}
    </div>
  );
}

function StatTile({
  label,
  icon,
  tone,
  value,
  loading,
}: {
  label: string;
  icon: string;
  tone: 'income' | 'expense';
  value?: string;
  loading: boolean;
}) {
  return (
    <div className="stat-tile">
      <span className="stat-tile__label">
        <span aria-hidden="true">{icon}</span>
        {label}
      </span>
      {loading ? (
        <div className="skeleton" style={{ height: 24, width: '70%' }} />
      ) : (
        <span className={`stat-tile__value stat-tile__value--${tone} numeric`}>
          {formatAmount(value)}
        </span>
      )}
    </div>
  );
}

function RowSkeletons() {
  return (
    <ul>
      {[0, 1, 2].map((index) => (
        <li key={index} className="list-row">
          <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 12 }} />
          <div className="list-row__main" style={{ display: 'grid', gap: 6 }}>
            <div className="skeleton" style={{ height: 14, width: '55%' }} />
            <div className="skeleton" style={{ height: 12, width: '35%' }} />
          </div>
          <div className="skeleton" style={{ height: 16, width: 64 }} />
        </li>
      ))}
    </ul>
  );
}
