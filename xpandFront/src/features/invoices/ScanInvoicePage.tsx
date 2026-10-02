import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useUploadInvoice } from '@/api/hooks';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { describeError } from '@/lib/errors';

import './invoices.css';

/** Mirrors the backend's accepted types; stated here so the picker filters before uploading. */
const ACCEPTED = 'image/jpeg,image/png,image/webp';
const MAX_MB = 10;

/**
 * Capture or pick an invoice photo and upload it.
 *
 * The file is sent **as-is**, with no client-side downscaling. That is a deliberate reversal of
 * what this app does elsewhere: the expense form compresses photos hard because they used to go
 * into `localStorage`, but OCR accuracy falls off sharply on small images, so shrinking the one
 * thing the scanner has to read would defeat the feature. The 10 MB ceiling is the backend's.
 *
 * On success this goes straight to the review screen, which polls while the page is being read.
 */
export function ScanInvoicePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const upload = useUploadInvoice();

  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState(0);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;

    // Check locally for the two things that would be a wasted round trip on a phone connection.
    if (!ACCEPTED.split(',').includes(file.type)) {
      toast.error(
        file.type === 'application/pdf'
          ? 'PDF invoices are not supported yet — photograph the invoice instead.'
          : `That file type (${file.type || 'unknown'}) cannot be read. Use a JPEG, PNG or WebP photo.`,
      );
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(
        `That photo is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_MB} MB.`,
      );
      return;
    }

    setProgress(0);
    try {
      const invoice = await upload.mutateAsync({ file, onProgress: setProgress });
      navigate(`/invoices/${invoice.id}/review`, { replace: true });
    } catch (error) {
      const { title, description } = describeError(error);
      toast.error(`${title}: ${description}`);
    } finally {
      setProgress(0);
      // Reset both inputs so picking the same file again still fires a change event.
      if (cameraInput.current) cameraInput.current.value = '';
      if (libraryInput.current) libraryInput.current.value = '';
    }
  };

  return (
    <>
      <ScreenHeader title="Scan an invoice" />

      <div className="page">
        <p className="field__hint">
          Photograph the whole invoice, straight on and in good light. The supplier, date, total and
          invoice number are read automatically — you check them on the next screen before anything
          is saved.
        </p>

        <input
          ref={cameraInput}
          type="file"
          accept={ACCEPTED}
          // Opens the rear camera directly on mobile rather than the photo library.
          capture="environment"
          className="visually-hidden"
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
        <input
          ref={libraryInput}
          type="file"
          accept={ACCEPTED}
          className="visually-hidden"
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />

        {upload.isPending ? (
          <div className="invoice-upload-progress">
            <div className="storage-meter">
              <div className="storage-meter__fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="field__hint">
              {progress < 100 ? `Uploading… ${progress}%` : 'Uploaded — starting to read it…'}
            </span>
          </div>
        ) : (
          <div className="invoice-scan-actions">
            <Button block onClick={() => cameraInput.current?.click()}>
              📷 Take a photo
            </Button>
            <Button variant="secondary" block onClick={() => libraryInput.current?.click()}>
              🖼️ Choose an existing photo
            </Button>
          </div>
        )}

        <p className="field__hint invoice-footnote">
          Accepted: JPEG, PNG or WebP, up to {MAX_MB} MB. PDFs are not supported yet — screenshot or
          photograph one instead.
        </p>
      </div>
    </>
  );
}
