import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  useCategories,
  useCreateTransaction,
  useTransaction,
  useUpdateTransaction,
} from '@/api/hooks';
import { AmountKeypad } from '@/components/form/AmountKeypad';
import { CategoryGrid } from '@/components/form/CategoryGrid';
import { DateField } from '@/components/form/DateField';
import { Disclosure } from '@/components/form/Disclosure';
import { EntityPicker } from '@/components/form/EntityPicker';
import { InvoiceCapture } from '@/components/form/InvoiceCapture';
import { PaymentMethodRow } from '@/components/form/PaymentMethodRow';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Chip';
import { TextAreaField } from '@/components/ui/Field';
import { Field } from '@/components/ui/Field';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { useTelegramMainButton } from '@/hooks/useTelegramButtons';
import { useToast } from '@/hooks/useToast';
import { parseAmount, type AmountValue } from '@/lib/amount';
import { describeError } from '@/lib/errors';
import { formatMoney, todayISO } from '@/lib/format';

import { lastPaymentMethod } from '@/lib/recent';
import { haptics } from '@/lib/telegram';
import type { PaymentMethod, TransactionType } from '@/types/api';

import '@/components/form/form.css';

interface FormState {
  amount: AmountValue;
  categoryId: number | null;
  paymentMethod: PaymentMethod;
  date: string;
  description: string;
  supplierId: number | null;
  productId: number | null;
  packagingId: number | null;
  invoiceReference: string;
}

function blankForm(): FormState {
  return {
    amount: '',
    categoryId: null,
    paymentMethod: lastPaymentMethod(),
    date: todayISO(),
    description: '',
    supplierId: null,
    productId: null,
    packagingId: null,
    invoiceReference: '',
  };
}

/**
 * Add / edit a transaction.
 *
 * The layout is ordered by how often a field is touched, which is what keeps entry fast:
 * amount (always) → category (always) → payment method (rarely, pre-filled) → date (rarely,
 * defaults to today) → description (sometimes) → the optional links, folded away.
 *
 * After a successful create the form **resets in place** instead of navigating away. Logging
 * a day's till means twenty entries in a row, and bouncing to a detail screen after each one
 * would double the taps. The toast confirms what was saved, and History is one tap away.
 */
export function TransactionFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const params = useParams<{ type?: string; id?: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const editingId = mode === 'edit' && params.id ? Number(params.id) : undefined;
  const existing = useTransaction(editingId);

  const routeType: TransactionType = params.type === 'income' ? 'INCOME' : 'EXPENSE';
  const [type, setType] = useState<TransactionType>(routeType);
  const [form, setForm] = useState<FormState>(blankForm);
  const [submitted, setSubmitted] = useState(false);

  const categoriesQuery = useCategories();
  const createMutation = useCreateTransaction();
  const updateMutation = useUpdateTransaction();
  const mutation = mode === 'edit' ? updateMutation : createMutation;

  const patch = (changes: Partial<FormState>) => setForm((current) => ({ ...current, ...changes }));

  // Switching tabs (income ⇄ expense) remounts nothing, so sync the type and drop a category
  // that is no longer valid for it.
  useEffect(() => {
    if (mode !== 'create') return;
    setType(routeType);
    setForm(blankForm());
    setSubmitted(false);
  }, [routeType, mode]);

  // Prefill from the server row when editing.
  useEffect(() => {
    if (mode !== 'edit' || !existing.data) return;
    const t = existing.data;
    setType(t.type);
    setForm({
      // The API returns "250.00"; strip the trailing zeros so the keypad reads naturally.
      amount: String(Number(t.amount)),
      categoryId: t.categoryId,
      paymentMethod: t.paymentMethod,
      date: t.transactionDate,
      description: t.description ?? '',
      supplierId: t.supplierId,
      productId: t.productId,
      packagingId: t.packagingId,
      invoiceReference: '',
    });
  }, [mode, existing.data]);

  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);

  /** Clear a selected category when a type switch makes it incompatible with the API rule. */
  const changeType = (next: TransactionType) => {
    setType(next);
    const selected = categories.find((c) => c.id === form.categoryId);
    if (selected && selected.type !== 'BOTH' && selected.type !== next) {
      patch({ categoryId: null });
    }
  };

  const amountValue = parseAmount(form.amount);
  const amountError = submitted && amountValue <= 0 ? 'Enter an amount greater than 0.' : undefined;
  const categoryError = submitted && form.categoryId === null ? 'Pick a category.' : undefined;
  const isValid = amountValue > 0 && form.categoryId !== null;

  const optionalFilled = [
    form.supplierId,
    form.productId,
    form.packagingId,
    form.invoiceReference.trim() || null,
  ].filter(Boolean).length;

  const submit = async () => {
    setSubmitted(true);

    if (!isValid) {
      haptics.error();
      return;
    }

    const payload = {
      categoryId: form.categoryId!,
      type,
      amount: amountValue,
      transactionDate: form.date,
      paymentMethod: form.paymentMethod,
      description: buildDescription() || undefined,
      supplierId: form.supplierId ?? undefined,
      productId: form.productId ?? undefined,
      packagingId: form.packagingId ?? undefined,
    };

    try {
      if (mode === 'edit' && editingId !== undefined) {
        await updateMutation.mutateAsync({ id: editingId, input: payload });
        toast.success('Transaction updated.');
        navigate(`/transactions/${editingId}`, { replace: true });
        return;
      }

      const created = await createMutation.mutateAsync(payload);

      toast.success(
        `${type === 'INCOME' ? 'Income' : 'Expense'} saved · ${formatMoney(created.amount, created.currency)}`,
      );

      // Reset for the next entry, keeping the date so a back-dated batch stays back-dated.
      setForm({ ...blankForm(), date: form.date, paymentMethod: form.paymentMethod });
      setSubmitted(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      const { description } = describeError(error);
      toast.error(description);
    }
  };

  /**
   * The description sent to the API, with the invoice reference folded in.
   *
   * `transactions` has no invoice-number column, and the reference used to live in a
   * `localStorage` entry that never reached the server. Appending it to the description is where
   * it can actually be found later — it shows up in the transactions list and travels with the
   * row. A scanned invoice does the same thing in `buildDescription` on the backend, so a
   * hand-typed reference and a scanned one read identically.
   */
  const buildDescription = (): string => {
    const note = form.description.trim();
    const reference = form.invoiceReference.trim();

    if (!reference) return note;
    if (!note) return `Invoice ${reference}`;
    // Don't repeat the reference if the user already mentioned it in the note.
    return note.includes(reference) ? note : `${note} · Invoice ${reference}`;
  };

  const tone = type === 'INCOME' ? 'income' : 'expense';

  // True inside Telegram, where the client paints the submit bar itself. The in-page bar below
  // is then *not* rendered — see the note where it is.
  const nativeSaveButton = useTelegramMainButton({
    text: mode === 'edit' ? 'Save changes' : `Save ${type === 'INCOME' ? 'income' : 'expense'}`,
    onClick: () => void submit(),
    enabled: isValid,
    loading: mutation.isPending,
    color: type === 'INCOME' ? '#1fa971' : '#e0505b',
    textColor: '#ffffff',
  });

  if (mode === 'edit' && existing.isLoading) {
    return <LoadingState label="Loading transaction…" />;
  }

  if (mode === 'edit' && existing.isError) {
    return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;
  }

  return (
    <>
      {mode === 'edit' && <ScreenHeader title="Edit transaction" />}

      <div className={`entry-form ${nativeSaveButton ? '' : 'entry-form--with-submit-bar'}`}>
        {mode === 'create' ? (
          <h1 className="page__title">{type === 'INCOME' ? 'Add income' : 'Add expense'}</h1>
        ) : (
          <Segmented
            ariaLabel="Transaction type"
            value={type}
            onChange={changeType}
            options={[
              { value: 'INCOME', label: 'Income', tone: 'income' },
              { value: 'EXPENSE', label: 'Expense', tone: 'expense' },
            ]}
          />
        )}

        <div>
          <AmountKeypad value={form.amount} onChange={(amount) => patch({ amount })} tone={tone} />
          {amountError && (
            <span className="field__error" role="alert">
              {amountError}
            </span>
          )}
        </div>

        <Field label="Category" error={categoryError}>
          {categoriesQuery.isLoading ? (
            <LoadingState label="Loading categories…" />
          ) : categoriesQuery.isError ? (
            <ErrorState
              error={categoriesQuery.error}
              onRetry={() => void categoriesQuery.refetch()}
            />
          ) : (
            <CategoryGrid
              categories={categories}
              type={type}
              value={form.categoryId}
              onChange={(categoryId) => patch({ categoryId })}
            />
          )}
        </Field>

        <Field label="Payment method">
          <PaymentMethodRow
            value={form.paymentMethod}
            onChange={(paymentMethod) => patch({ paymentMethod })}
          />
        </Field>

        <Field label="Date">
          <DateField value={form.date} onChange={(date) => patch({ date })} />
        </Field>

        <TextAreaField
          label="Description"
          optional
          rows={2}
          maxLength={1000}
          value={form.description}
          placeholder="What was this for?"
          onChange={(event) => patch({ description: event.target.value })}
        />

        <Disclosure label="More details" filledCount={optionalFilled}>
          <Field label="Supplier" optional>
            <EntityPicker
              kind="supplier"
              value={form.supplierId}
              onChange={(supplierId) => patch({ supplierId })}
            />
          </Field>

          <Field label="Product" optional>
            <EntityPicker
              kind="product"
              value={form.productId}
              onChange={(productId) => patch({ productId })}
            />
          </Field>

          <Field label="Packaging" optional>
            <EntityPicker
              kind="packaging"
              value={form.packagingId}
              onChange={(packagingId) => patch({ packagingId })}
            />
          </Field>

          {type === 'EXPENSE' && (
            <InvoiceCapture
              reference={form.invoiceReference}
              onReferenceChange={(invoiceReference) => patch({ invoiceReference })}
            />
          )}
        </Disclosure>
      </div>

      {/*
        Stands in for Telegram's native MainButton where there isn't one — a browser tab, or a
        client too old to have it. Inside Telegram it is deliberately absent: rendering both put
        two Save buttons on the same screen, the native bar at the bottom of the client and this
        one just above the tab bar, which read as two different actions and made the in-page one
        look like it was hidden behind the menu. Same `submit` either way, so the enabled and
        loading states cannot diverge between the two.
      */}
      {!nativeSaveButton && (
        <div
          className={`entry-form__submit-bar ${mode === 'edit' ? 'entry-form__submit-bar--no-tabbar' : ''}`}
        >
          <Button
            variant={tone}
            size="lg"
            block
            loading={mutation.isPending}
            disabled={!isValid}
            onClick={() => void submit()}
          >
            {mode === 'edit'
              ? 'Save changes'
              : `Save ${type === 'INCOME' ? 'income' : 'expense'}${amountValue > 0 ? ` · ${formatMoney(amountValue)}` : ''}`}
          </Button>
        </div>
      )}
    </>
  );
}
