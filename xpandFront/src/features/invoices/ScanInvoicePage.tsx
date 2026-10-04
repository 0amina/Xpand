import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useUploadInvoice } from '@/api/hooks';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { describeError } from '@/lib/errors';
import { cameraStreamSupported, transcodeToJpeg } from '@/lib/image';

import { CameraSheet } from './CameraSheet';
import './invoices.css';

/** Mirrors the backend's accepted types; anything else is re-encoded to JPEG before uploading. */
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_MB = 10;

/**
 * Capture or pick an invoice photo and upload it.
 *
 * Two ways in, in order of preference:
 *
 *  1. **The in-app camera** (`CameraSheet`) — a real `getUserMedia` stream with a confirm step.
 *     This is the path that made "take a photo" work: the page previously relied on
 *     `<input type="file" capture="environment">`, and `capture` is only a hint that Telegram's
 *     Android webview frequently ignores, dropping the user into the document picker. A stream
 *     either opens or fails loudly enough to explain.
 *  2. **The system picker** — still here, both as the gallery option and as the fallback when a
 *     stream is impossible (an insecure origin, an iframe without camera permission, a refusal).
 *
 * Whatever the source, the file is uploaded at **full resolution** unless it has to be
 * re-encoded. That is a deliberate reversal of what this app does elsewhere — the expense form
 * compresses photos hard — because OCR accuracy falls off sharply on small images, so shrinking
 * the one thing the scanner has to read would defeat the feature. The 10 MB ceiling is the
 * backend's, and a photo over it (or in a format the server cannot read, such as an iOS HEIC) is
 * re-encoded down rather than refused.
 *
 * On success this goes straight to the review screen, which polls while the page is being read.
 */
export function ScanInvoicePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const upload = useUploadInvoice();

  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [progress, setProgress] = useState(0);

  /** Reset both inputs so picking the same file again still fires a change event. */
  const clearInputs = () => {
    if (cameraInput.current) cameraInput.current.value = '';
    if (libraryInput.current) libraryInput.current.value = '';
  };

  const send = async (file: File) => {
    setProgress(0);
    try {
      const invoice = await upload.mutateAsync({ file, onProgress: setProgress });
      navigate(`/invoices/${invoice.id}/review`, { replace: true });
    } catch (error) {
      const { title, description } = describeError(error);
      toast.error(`${title}: ${description}`);
    } finally {
      setProgress(0);
      clearInputs();
    }
  };

  /** A file chosen through one of the `<input type="file">` paths. */
  const handlePicked = async (picked: File | undefined) => {
    if (!picked) return;

    if (picked.type && !picked.type.startsWith('image/')) {
      toast.error(
        picked.type === 'application/pdf'
          ? 'PDF invoices are not supported yet — photograph the invoice instead.'
          : `That file (${picked.type}) is not an image. Use a photo of the invoice.`,
      );
      clearInputs();
      return;
    }

    let file = picked;

    // Re-encode only when the upload would otherwise be refused: an unsupported image format,
    // or a frame over the size ceiling. A JPEG that is already in range is sent untouched.
    if (!ACCEPTED.includes(file.type) || file.size > MAX_MB * 1024 * 1024) {
      const converted = await transcodeToJpeg(file);
      if (converted) file = converted;
    }

    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(
        `That photo is ${(file.size / 1024 / 1024).toFixed(1)} MB and could not be shrunk below the ${MAX_MB} MB limit.`,
      );
      clearInputs();
      return;
    }

    await send(file);
  };

  /** Opens the live camera where possible, the system camera where not. */
  const startCamera = () => {
    if (cameraStreamSupported()) setCameraOpen(true);
    else cameraInput.current?.click();
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
          // Broad `image/*` on purpose: Android hides the camera from the chooser for a narrow
          // list of MIME types, which is half the reason this button used to reach the gallery
          // only. Anything the server cannot read is re-encoded above instead.
          accept="image/*"
          capture="environment"
          className="visually-hidden"
          onChange={(event) => void handlePicked(event.target.files?.[0])}
        />
        <input
          ref={libraryInput}
          type="file"
          accept="image/*"
          className="visually-hidden"
          onChange={(event) => void handlePicked(event.target.files?.[0])}
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
            <Button block onClick={startCamera}>
              📷 Take a photo
            </Button>
            <Button variant="secondary" block onClick={() => libraryInput.current?.click()}>
              🖼️ Choose an existing photo
            </Button>
          </div>
        )}

        <p className="field__hint invoice-footnote">
          Photos are sent at full quality so the text stays readable, up to {MAX_MB} MB. PDFs are
          not supported yet — screenshot or photograph one instead.
        </p>
      </div>

      <CameraSheet
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => {
          setCameraOpen(false);
          void send(file);
        }}
        onFallback={() => {
          setCameraOpen(false);
          libraryInput.current?.click();
        }}
      />
    </>
  );
}
