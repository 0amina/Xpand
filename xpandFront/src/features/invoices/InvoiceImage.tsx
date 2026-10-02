import { useEffect, useState } from 'react';

import { fetchObjectUrl } from '@/lib/api';
import type { Invoice } from '@/types/api';

/**
 * The stored invoice image.
 *
 * Fetched through `fetchObjectUrl` rather than set as a plain `<img src>`, because the file route
 * sits behind `requireAuth` and an `<img>` sends no `Authorization` header — the browser would get
 * a 401 and render a broken image. So the bytes are fetched with credentials and handed to the
 * element as an object URL, which is revoked on unmount to avoid leaking blobs as the user moves
 * through a queue of invoices.
 *
 * Tapping toggles full-height: a thumbnail is enough to confirm you are looking at the right
 * invoice, but checking a total against it needs the real thing.
 */
export function InvoiceImage({ invoice }: { invoice: Invoice }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;

    fetchObjectUrl(invoice.fileUrl)
      .then((next) => {
        // The effect may have been cleaned up while the fetch was in flight.
        if (revoked) {
          URL.revokeObjectURL(next);
          return;
        }
        objectUrl = next;
        setUrl(next);
      })
      .catch(() => setFailed(true));

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [invoice.fileUrl]);

  if (failed) {
    return (
      <div className="invoice-image invoice-image--missing">
        The stored image could not be loaded.
      </div>
    );
  }

  if (!url) {
    return <div className="invoice-image invoice-image--loading" aria-busy="true" />;
  }

  return (
    <button
      type="button"
      className={`invoice-image ${expanded ? 'invoice-image--expanded' : ''}`}
      onClick={() => setExpanded((previous) => !previous)}
      aria-label={expanded ? 'Shrink invoice image' : 'Expand invoice image'}
    >
      <img src={url} alt={invoice.originalFilename ?? `Invoice ${invoice.id}`} />
      <span className="invoice-image__hint">{expanded ? 'Tap to shrink' : 'Tap to enlarge'}</span>
    </button>
  );
}
