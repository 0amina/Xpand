import { Link } from 'react-router-dom';

import { TextField } from '@/components/ui/Field';

import './form.css';

interface InvoiceCaptureProps {
  reference: string;
  onReferenceChange: (value: string) => void;
}

/**
 * The invoice reference field on the expense form, plus a pointer to the scanner.
 *
 * This used to capture a photo too, downscale it, and park it in `localStorage` — with a warning
 * on top saying it had not been uploaded. Both the capture and the warning are gone now that
 * `POST /api/invoices` exists, and the reason is not just that uploads work: the OCR flow runs the
 * other way round. There, the invoice comes first and *creates* the expense with its amount,
 * supplier and date already filled in. Photographing an invoice while hand-typing the same numbers
 * into this form is strictly more work for the same result.
 *
 * So the photo path lives on the scanner and this keeps only the reference, which is useful on its
 * own for an expense with no invoice to scan (a receipt already filed, a number read over the
 * phone). It is saved in the transaction's description like any other note.
 */
export function InvoiceCapture({ reference, onReferenceChange }: InvoiceCaptureProps) {
  return (
    <div className="field">
      <TextField
        label="Invoice number"
        optional
        value={reference}
        placeholder="INV-2026-0088"
        inputMode="text"
        autoCapitalize="characters"
        maxLength={64}
        hint="Kept with this expense for reference."
        onChange={(event) => onReferenceChange(event.target.value)}
      />

      <p className="field__hint">
        Have the invoice in front of you? <Link to="/invoices/scan">Scan it instead</Link> — the
        amount, date and supplier are read for you, and you check them before anything is saved.
      </p>
    </div>
  );
}
