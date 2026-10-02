import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/api/queryKeys';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { countPending, flushPending } from '@/lib/invoiceStore';

/**
 * Offers to upload attachments left on this device by the old local-only queue.
 *
 * Renders nothing when the queue is empty, which is the normal case and will be every case once
 * each device has migrated. It exists because those photos are real receipts that someone took and
 * believed were filed; silently dropping them when the feature changed would lose records the user
 * cannot get back.
 *
 * Migration *links* each image to the transaction it was captured against, so it never creates a
 * second copy of an expense already in the books.
 */
export function LegacyQueueNotice() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [remaining, setRemaining] = useState(() => countPending());
  const [busy, setBusy] = useState(false);

  if (remaining === 0) return null;

  const migrate = async () => {
    setBusy(true);
    try {
      const result = await flushPending();
      setRemaining(countPending());
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all });

      const parts: string[] = [];
      if (result.uploaded > 0) parts.push(`${result.uploaded} uploaded`);
      if (result.skipped > 0) parts.push(`${result.skipped} had no photo`);
      if (result.failed.length > 0) parts.push(`${result.failed.length} failed`);

      if (result.failed.length > 0) {
        toast.error(`${parts.join(', ')}. The failures stay on this device — try again.`);
      } else {
        toast.show(parts.length > 0 ? `${parts.join(', ')}.` : 'Nothing left to upload.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Migration failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="invoice-banner invoice-banner--warn">
      <strong>
        {remaining} invoice photo{remaining === 1 ? '' : 's'} still only on this device.
      </strong>{' '}
      These were captured before invoices could be uploaded. Upload them now and each will be filed
      against the expense it belongs to.
      <div className="invoice-card__actions">
        <Button size="sm" loading={busy} onClick={() => void migrate()}>
          Upload {remaining} to the server
        </Button>
      </div>
    </div>
  );
}
