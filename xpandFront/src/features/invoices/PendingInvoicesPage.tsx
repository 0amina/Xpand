import { Link, useNavigate } from 'react-router-dom';

import { useDeleteInvoice, useInvoices } from '@/api/hooks';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useToast } from '@/hooks/useToast';
import { describeError } from '@/lib/errors';
import { formatTimestamp } from '@/lib/format';
import { confirmDialog } from '@/lib/telegram';
import type { Invoice, InvoiceStatus } from '@/types/api';

import { LegacyQueueNotice } from './LegacyQueueNotice';
import './invoices.css';
import '../transactions/transactions.css';

/** How each pipeline state reads to someone looking at the queue. */
const STATUS_LABEL: Record<InvoiceStatus, { text: string; className: string }> = {
  PENDING: { text: 'Queued', className: 'badge--neutral' },
  PROCESSING: { text: 'Reading…', className: 'badge--neutral' },
  READY: { text: 'Needs review', className: 'badge--warning' },
  FAILED: { text: 'Could not read', className: 'badge--expense' },
  CONFIRMED: { text: 'Saved', className: 'badge--income' },
};

/**
 * The invoice queue, server-backed.
 *
 * This screen used to exist to make a `localStorage`-only stopgap visible, warning on every row
 * that nothing had been uploaded. Those warnings are gone because they are no longer true: the
 * files are on the server and shared with everyone. What remains is the thing the queue is
 * actually for — showing which invoices are still waiting on a person, since an unreviewed
 * invoice is money not yet in the books.
 */
export function PendingInvoicesPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const invoices = useInvoices();
  const remove = useDeleteInvoice();

  const rows = invoices.data?.data ?? [];
  const awaiting = invoices.data?.meta?.awaitingReview ?? 0;

  const discard = async (invoice: Invoice) => {
    const confirmed = await confirmDialog(
      'Discard this invoice and its image? This cannot be undone.',
    );
    if (!confirmed) return;

    try {
      await remove.mutateAsync(invoice.id);
      toast.show('Invoice discarded.');
    } catch (error) {
      toast.error(describeError(error).description);
    }
  };

  return (
    <>
      <ScreenHeader
        title="Invoices"
        action={
          <Button size="sm" onClick={() => navigate('/invoices/scan')}>
            + Scan
          </Button>
        }
      />

      <div className="page">
        <LegacyQueueNotice />

        {invoices.isLoading ? (
          <LoadingState label="Loading invoices…" />
        ) : invoices.isError ? (
          <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="No invoices yet"
            description="Photograph an invoice and its supplier, date and total are read for you to check."
            action={<Button onClick={() => navigate('/invoices/scan')}>Scan an invoice</Button>}
          />
        ) : (
          <>
            {awaiting > 0 && (
              <div className="invoice-banner invoice-banner--info">
                <strong>
                  {awaiting} invoice{awaiting === 1 ? '' : 's'} waiting for review.
                </strong>{' '}
                Nothing is in the books until you check and save each one.
              </div>
            )}

            {rows.map((invoice) => {
              const badge = STATUS_LABEL[invoice.status];
              const reviewable = invoice.status === 'READY' || invoice.status === 'FAILED';

              return (
                <div className="pending-card" key={invoice.id}>
                  <div className="invoice-card__top">
                    <span className="invoice-card__title">
                      {invoice.originalFilename ?? `Invoice #${invoice.id}`}
                    </span>
                    <span className={`badge ${badge.className}`}>{badge.text}</span>
                  </div>

                  <span className="field__hint">
                    {formatTimestamp(invoice.createdAt)} · {Math.round(invoice.fileSize / 1024)} KB
                  </span>

                  {invoice.status === 'FAILED' && invoice.ocrError && (
                    <span className="field__hint invoice-card__error">{invoice.ocrError}</span>
                  )}

                  <div className="invoice-card__actions">
                    {invoice.status === 'CONFIRMED' ? (
                      <Link to={`/transactions/${invoice.transactionId}`}>
                        <Button variant="secondary" size="sm">
                          Transaction #{invoice.transactionId}
                        </Button>
                      </Link>
                    ) : (
                      <Button
                        size="sm"
                        variant={reviewable ? 'primary' : 'secondary'}
                        onClick={() => navigate(`/invoices/${invoice.id}/review`)}
                      >
                        {reviewable ? 'Review & save' : 'Open'}
                      </Button>
                    )}

                    {invoice.status !== 'CONFIRMED' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void discard(invoice)}
                        disabled={remove.isPending}
                      >
                        Discard
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}
