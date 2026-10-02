import { useNavigate, useParams } from 'react-router-dom';

import {
  useCategoryMap,
  useDeleteTransaction,
  useEntityName,
  useInvoiceForTransaction,
  useTransaction,
} from '@/api/hooks';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { useToast } from '@/hooks/useToast';
import { categoryVisual } from '@/lib/categoryMeta';
import { describeError } from '@/lib/errors';
import {
  formatAmount,
  formatCategoryName,
  formatDateLong,
  formatPaymentMethod,
  formatTimestamp,
} from '@/lib/format';

import { confirmDialog } from '@/lib/telegram';
import type { EntityKind } from '@/types/api';

import { InvoiceImage } from '../invoices/InvoiceImage';
import '../invoices/invoices.css';
import './transactions.css';

export function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const transactionId = id ? Number(id) : undefined;
  const query = useTransaction(transactionId);
  const categoryMap = useCategoryMap();
  const deleteMutation = useDeleteTransaction();
  // The receipt filed against this transaction, if any. Server-backed, so it is visible to
  // everyone rather than only to whoever photographed it. Declared with the other hooks — above
  // the early returns below — because hook order has to be identical on every render; the query
  // is inert until `transactionId` resolves.
  const invoice = useInvoiceForTransaction(transactionId);

  if (query.isLoading) {
    return (
      <>
        <ScreenHeader title="Transaction" />
        <LoadingState />
      </>
    );
  }

  if (query.isError || !query.data) {
    return (
      <>
        <ScreenHeader title="Transaction" />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </>
    );
  }

  const transaction = query.data;
  const category = categoryMap.get(transaction.categoryId);
  const visual = categoryVisual(category ?? { name: 'divers', icon: null, color: null });
  const isIncome = transaction.type === 'INCOME';

  const handleDelete = async () => {
    const confirmed = await confirmDialog(
      `Delete this ${isIncome ? 'income' : 'expense'} of ${formatAmount(transaction.amount)} ${transaction.currency}? This cannot be undone.`,
    );
    if (!confirmed) return;

    try {
      await deleteMutation.mutateAsync(transaction.id);
      // No client-side cleanup needed for the attachment: the invoices row has
      // `ON DELETE CASCADE` on transaction_id, so the database removes it with the transaction.
      toast.success('Transaction deleted.');
      navigate('/transactions', { replace: true });
    } catch (error) {
      toast.error(describeError(error).description);
    }
  };

  return (
    <>
      <ScreenHeader
        title="Transaction"
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/transactions/${transaction.id}/edit`)}
          >
            Edit
          </Button>
        }
      />

      <div className="page">
        <div className="detail-hero">
          <span
            className="cat-avatar"
            style={
              {
                '--cat-color': visual.color,
                width: 56,
                height: 56,
                fontSize: 26,
              } as React.CSSProperties
            }
            aria-hidden="true"
          >
            {visual.icon}
          </span>
          <span
            className={`detail-hero__amount numeric ${isIncome ? 'income-text' : 'expense-text'}`}
          >
            {isIncome ? '+' : '−'}
            {formatAmount(transaction.amount)} {transaction.currency}
          </span>
          <span className="detail-hero__category">
            {formatCategoryName(category?.name)}
            <span className={`badge badge--${isIncome ? 'income' : 'expense'}`}>
              {isIncome ? 'Income' : 'Expense'}
            </span>
          </span>
        </div>

        <div className="detail-list">
          <DetailItem label="Date" value={formatDateLong(transaction.transactionDate)} />
          <DetailItem label="Payment" value={formatPaymentMethod(transaction.paymentMethod)} />
          {transaction.description && (
            <DetailItem label="Description" value={transaction.description} />
          )}
          <EntityItem label="Supplier" kind="supplier" id={transaction.supplierId} />
          <EntityItem label="Product" kind="product" id={transaction.productId} />
          <EntityItem label="Packaging" kind="packaging" id={transaction.packagingId} />
        </div>

        {invoice.data && (
          <div className="pending-card">
            <div className="invoice-card__top">
              <span className="invoice-card__title">Invoice</span>
              <span className="badge badge--income">Filed</span>
            </div>
            <InvoiceImage invoice={invoice.data} />
            <span className="field__hint">
              Uploaded {formatTimestamp(invoice.data.createdAt)}
              {invoice.data.ocrModel ? ` · read by ${invoice.data.ocrModel}` : ''}
            </span>
          </div>
        )}

        <div className="detail-list">
          <DetailItem label="Logged" value={formatTimestamp(transaction.createdAt)} />
          {transaction.updatedAt !== transaction.createdAt && (
            <DetailItem label="Edited" value={formatTimestamp(transaction.updatedAt)} />
          )}
          <DetailItem label="Reference" value={`#${transaction.id}`} />
        </div>

        <div className="detail-actions">
          <Button
            variant="danger"
            block
            loading={deleteMutation.isPending}
            onClick={() => void handleDelete()}
          >
            Delete transaction
          </Button>
        </div>
      </div>
    </>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-item">
      <span className="detail-item__label">{label}</span>
      <span className="detail-item__value">{value}</span>
    </div>
  );
}

/**
 * A linked supplier / product / packaging row. Renders nothing when the transaction has no
 * such link, and falls back to the raw id if the entity has since been deleted.
 */
function EntityItem({ label, kind, id }: { label: string; kind: EntityKind; id: number | null }) {
  const query = useEntityName(kind, id);

  if (id === null) return null;

  return (
    <DetailItem label={label} value={query.isLoading ? '…' : (query.data?.name ?? `#${id}`)} />
  );
}
