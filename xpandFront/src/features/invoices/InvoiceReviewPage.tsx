import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useCategories, useConfirmInvoice, useInvoice, useRetryOcr } from '@/api/hooks';
import { CategoryGrid } from '@/components/form/CategoryGrid';
import { DateField } from '@/components/form/DateField';
import { EntityPicker } from '@/components/form/EntityPicker';
import { PaymentMethodRow } from '@/components/form/PaymentMethodRow';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Field, TextField } from '@/components/ui/Field';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { useToast } from '@/hooks/useToast';
import { describeError } from '@/lib/errors';
import { todayISO } from '@/lib/format';
import type { ConfirmInvoiceInput, PaymentMethod } from '@/types/api';

import { InvoiceImage } from './InvoiceImage';
import './invoices.css';

/**
 * The verification step. Nothing reaches the ledger without passing through this screen.
 *
 * Three things it is deliberately built around:
 *
 *  1. **Every field is editable, and nothing is pre-accepted.** The OCR draft seeds the form and
 *     that is all it does. The values posted on confirm are whatever is in these inputs.
 *  2. **The read is shown next to the value.** Each extracted field displays the raw text it came
 *     from (`Net a payer : 458,150` beside `458.15`), because the amount parser has to guess
 *     between millimes and thousands separators and the user is the only one who can settle it.
 *     Hiding the source would make a 1000× misread invisible.
 *  3. **The image stays on screen.** Checking a total against a photo you have to navigate away
 *     from is how wrong numbers get approved.
 */
export function InvoiceReviewPage() {
  const params = useParams<{ id: string }>();
  const invoiceId = Number(params.id);
  const navigate = useNavigate();
  const toast = useToast();

  const invoice = useInvoice(Number.isFinite(invoiceId) ? invoiceId : null);
  const categories = useCategories();
  const confirm = useConfirmInvoice();
  const retry = useRetryOcr();

  // --- Form state. Seeded from the draft once it arrives, then owned by the user. ---
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [supplierName, setSupplierName] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [currency, setCurrency] = useState('TND');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [description, setDescription] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [touched, setTouched] = useState(false);

  const data = invoice.data;
  const draft = data?.draft ?? null;

  /**
   * Seed the form from the draft exactly once.
   *
   * Guarded by `seeded` rather than keyed on the draft, because the invoice is polled: without
   * the guard, every poll would overwrite whatever the user had just typed.
   */
  useEffect(() => {
    if (seeded || !draft) return;

    if (draft.totalAmount) setAmount(draft.totalAmount.value);
    if (draft.invoiceDate) setDate(draft.invoiceDate.value);
    if (draft.currency) setCurrency(draft.currency.value);
    if (draft.invoiceNumber) setInvoiceNumber(draft.invoiceNumber.value);
    if (draft.supplierId !== null) setSupplierId(draft.supplierId);
    if (draft.supplierName) setSupplierName(draft.supplierName.value);
    setCategoryId(draft.suggestedCategoryId);

    setSeeded(true);
  }, [draft, seeded]);

  const expenseCategories = useMemo(
    () => (categories.data ?? []).filter((c) => c.type === 'EXPENSE' || c.type === 'BOTH'),
    [categories.data],
  );

  if (!Number.isFinite(invoiceId)) {
    return (
      <>
        <ScreenHeader title="Review invoice" />
        <div className="page">
          <ErrorState error={new Error('That invoice reference is not valid.')} />
        </div>
      </>
    );
  }

  if (invoice.isLoading) {
    return (
      <>
        <ScreenHeader title="Review invoice" />
        <div className="page">
          <LoadingState label="Loading invoice…" />
        </div>
      </>
    );
  }

  if (invoice.isError || !data) {
    return (
      <>
        <ScreenHeader title="Review invoice" />
        <div className="page">
          <ErrorState error={invoice.error} onRetry={() => void invoice.refetch()} />
        </div>
      </>
    );
  }

  // Already filed — there is nothing left to verify.
  if (data.status === 'CONFIRMED') {
    return (
      <>
        <ScreenHeader title="Invoice filed" />
        <div className="page">
          <div className="invoice-banner invoice-banner--done">
            <strong>Already saved.</strong> This invoice is attached to transaction #
            {data.transactionId}.
          </div>
          <InvoiceImage invoice={data} />
          <Button block onClick={() => navigate(`/transactions/${data.transactionId}`)}>
            Open transaction #{data.transactionId}
          </Button>
        </div>
      </>
    );
  }

  // OCR still running. The detail query polls, so this resolves on its own.
  if (data.status === 'PENDING' || data.status === 'PROCESSING') {
    return (
      <>
        <ScreenHeader title="Reading invoice" />
        <div className="page">
          <div className="invoice-banner invoice-banner--working">
            <span className="invoice-spinner" aria-hidden="true" />
            <span>
              <strong>Reading the invoice…</strong> This takes a few seconds. The details will
              appear here for you to check.
            </span>
          </div>
          <InvoiceImage invoice={data} />
        </div>
      </>
    );
  }

  const amountInvalid = touched && !/^\d+(\.\d{1,2})?$/.test(amount.trim());
  const canSubmit =
    categoryId !== null && /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0;

  const submit = async () => {
    setTouched(true);
    if (!canSubmit || categoryId === null) {
      toast.error('Add an amount and pick a category first.');
      return;
    }

    const input: ConfirmInvoiceInput = {
      categoryId,
      type: 'EXPENSE',
      amount: amount.trim(),
      currency,
      transactionDate: date,
      paymentMethod,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(supplierId !== null ? { supplierId } : {}),
      ...(invoiceNumber.trim() ? { invoiceNumber: invoiceNumber.trim() } : {}),
    };

    try {
      const result = await confirm.mutateAsync({ id: invoiceId, input });
      toast.show(`Saved as transaction #${result.transaction.id}.`);
      navigate(`/transactions/${result.transaction.id}`, { replace: true });
    } catch (error) {
      const { title, description: why } = describeError(error);
      toast.error(`${title}: ${why}`);
    }
  };

  return (
    <>
      <ScreenHeader title="Check the details" />

      <div className="page">
        {/* The read quality, stated plainly. A low-confidence page is worth a closer look. */}
        {data.status === 'FAILED' ? (
          <div className="invoice-banner invoice-banner--warn">
            <strong>Could not read this invoice.</strong>{' '}
            {data.ocrError ?? 'The scan produced no usable text.'} Enter the details by hand below,
            or retake the photo.
          </div>
        ) : (
          <div className="invoice-banner invoice-banner--info">
            <strong>Check every value before saving.</strong> These were read automatically and can
            be wrong — nothing is recorded until you press Save.
            {draft?.ocrConfidence !== null && draft?.ocrConfidence !== undefined && (
              <> Read quality: {Math.round(draft.ocrConfidence)}%.</>
            )}
          </div>
        )}

        <InvoiceImage invoice={data} />

        <div className="invoice-actions-row">
          <Button
            variant="secondary"
            size="sm"
            loading={retry.isPending}
            onClick={() => {
              retry.mutate(invoiceId, {
                // Let the fresh extraction re-seed the form.
                onSuccess: () => {
                  setSeeded(false);
                  toast.show('Read again.');
                },
                onError: (error) => toast.error(describeError(error).description),
              });
            }}
          >
            ↻ Read again
          </Button>
        </div>

        <Field
          label="Amount"
          error={amountInvalid ? 'Enter an amount like 458.15' : undefined}
          hint={
            draft?.totalAmount
              ? `Read from the invoice as “${draft.totalAmount.raw}”`
              : 'Not found automatically — type the total you paid.'
          }
        >
          <div className="invoice-amount-row">
            <input
              className="input numeric"
              inputMode="decimal"
              value={amount}
              placeholder="0.00"
              onChange={(event) => {
                // Accept a comma as the user types — the keypad on a French locale sends one.
                setAmount(event.target.value.replace(',', '.'));
                setTouched(true);
              }}
            />
            <input
              className="input invoice-currency"
              value={currency}
              maxLength={3}
              aria-label="Currency"
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            />
          </div>
        </Field>

        <Field
          label="Invoice date"
          hint={
            draft?.invoiceDate
              ? `Read from the invoice as “${draft.invoiceDate.raw}”`
              : 'Not found automatically.'
          }
        >
          <DateField value={date} onChange={setDate} />
        </Field>

        <Field label="Category" hint="Which budget this expense belongs to.">
          {categories.isLoading ? (
            <LoadingState label="Loading categories…" />
          ) : (
            <CategoryGrid
              categories={expenseCategories}
              type="EXPENSE"
              value={categoryId}
              onChange={setCategoryId}
            />
          )}
        </Field>

        <Field
          label="Supplier"
          optional
          hint={
            draft?.supplierName && draft.supplierId === null
              ? `Read as “${draft.supplierName.value}” — not in your suppliers yet, so pick or add one.`
              : draft?.supplierName
                ? `Matched “${draft.supplierName.value}” in your suppliers.`
                : undefined
          }
        >
          <EntityPicker
            kind="supplier"
            value={supplierId}
            onChange={setSupplierId}
            selectedName={supplierName}
          />
        </Field>

        <Field
          label="Invoice number"
          optional
          hint={
            draft?.invoiceNumber
              ? `Read from the invoice as “${draft.invoiceNumber.raw}”`
              : undefined
          }
        >
          <TextField
            label=""
            value={invoiceNumber}
            placeholder="FAC-2026-0457"
            autoCapitalize="characters"
            maxLength={64}
            onChange={(event) => setInvoiceNumber(event.target.value)}
          />
        </Field>

        <Field label="Payment method">
          <PaymentMethodRow value={paymentMethod} onChange={setPaymentMethod} />
        </Field>

        <Field label="Note" optional hint="Defaults to the invoice number if left empty.">
          <TextField
            label=""
            value={description}
            placeholder="What this was for"
            maxLength={1000}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        <Button
          block
          loading={confirm.isPending}
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          Save as expense
        </Button>

        <p className="field__hint invoice-footnote">
          Saving creates a transaction for {currency} {amount || '0.00'} and files this image
          against it.
        </p>
      </div>
    </>
  );
}
