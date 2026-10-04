import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useCreateProduct, useDeleteProduct, useProduct, useUpdateProduct } from '@/api/hooks';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { useTelegramMainButton } from '@/hooks/useTelegramButtons';
import { useToast } from '@/hooks/useToast';
import { DEFAULT_CURRENCY } from '@/types/api';
import { describeError } from '@/lib/errors';
import { confirmDialog, haptics } from '@/lib/telegram';

import '@/components/form/form.css';
import { CATALOG, forCreate, forUpdate } from './catalog';
import './catalog.css';

interface FormState {
  name: string;
  sku: string;
  description: string;
  /** Held as the raw input string; parsed once, on submit. */
  unitPrice: string;
}

const BLANK: FormState = { name: '', sku: '', description: '', unitPrice: '' };

/**
 * Add or edit a product.
 *
 * The unit price is a plain text input rather than the app's custom keypad. The keypad exists
 * because the amount on the entry form is typed dozens of times a day with the webview resizing
 * underneath it; a product's price is typed once, when the product is created, so the keypad's
 * cost — a full-height panel above every other field — buys nothing here.
 *
 * It is still parsed the same way: a comma is accepted as the decimal separator, because that is
 * what a Tunisian keyboard offers, and the API wants a dot.
 */
export function ProductFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const config = CATALOG.product;
  const editingId = mode === 'edit' && params.id ? Number(params.id) : undefined;
  const existing = useProduct(editingId);

  const [form, setForm] = useState<FormState>(BLANK);
  const [submitted, setSubmitted] = useState(false);

  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();
  const deleteMutation = useDeleteProduct();
  const mutation = mode === 'edit' ? updateMutation : createMutation;

  const patch = (changes: Partial<FormState>) => setForm((current) => ({ ...current, ...changes }));

  useEffect(() => {
    if (mode !== 'edit' || !existing.data) return;
    const p = existing.data;
    setForm({
      name: p.name,
      sku: p.sku ?? '',
      description: p.description ?? '',
      // "12.50" reads better as "12.5" in an input you are about to retype.
      unitPrice: p.unitPrice ? String(Number(p.unitPrice)) : '',
    });
  }, [mode, existing.data]);

  const name = form.name.trim();
  const priceText = form.unitPrice.trim().replace(',', '.');
  const price = priceText ? Number(priceText) : null;
  const priceInvalid =
    price !== null && (!Number.isFinite(price) || price < 0 || !hasAtMostTwoDecimals(price));

  const nameError = submitted && !name ? 'A name is required.' : undefined;
  const priceError = priceInvalid
    ? 'Enter a price of 0 or more, with at most two decimals.'
    : undefined;
  const isValid = name.length > 0 && !priceInvalid;

  const submit = async () => {
    setSubmitted(true);
    if (!isValid) {
      haptics.error();
      return;
    }

    try {
      if (mode === 'edit' && editingId !== undefined) {
        await updateMutation.mutateAsync({
          id: editingId,
          input: {
            name,
            sku: forUpdate(form.sku),
            description: forUpdate(form.description),
            unitPrice: price,
          },
        });
        toast.success(`${name} updated.`);
      } else {
        await createMutation.mutateAsync({
          name,
          sku: forCreate(form.sku),
          description: forCreate(form.description),
          ...(price !== null ? { unitPrice: price } : {}),
        });
        toast.success(`${name} added.`);
      }
      navigate(config.listPath, { replace: true });
    } catch (error) {
      // A duplicate SKU comes back as a 409 naming the clash; show it rather than a generic line.
      const { description } = describeError(error);
      toast.error(description);
    }
  };

  const remove = async () => {
    if (editingId === undefined) return;
    if (!(await confirmDialog(`Delete ${form.name || 'this product'}?`))) return;

    try {
      await deleteMutation.mutateAsync(editingId);
      toast.success('Product deleted.');
      navigate(config.listPath, { replace: true });
    } catch (error) {
      const { description } = describeError(error);
      toast.error(description);
    }
  };

  const nativeSaveButton = useTelegramMainButton({
    text: mode === 'edit' ? 'Save changes' : 'Add product',
    onClick: () => void submit(),
    enabled: isValid,
    loading: mutation.isPending,
  });

  if (mode === 'edit' && existing.isLoading) return <LoadingState label="Loading product…" />;
  if (mode === 'edit' && existing.isError) {
    return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;
  }

  return (
    <>
      <ScreenHeader title={mode === 'edit' ? 'Edit product' : 'New product'} />

      <div className={`entry-form ${nativeSaveButton ? '' : 'entry-form--with-submit-bar'}`}>
        <TextField
          label="Name"
          value={form.name}
          error={nameError}
          placeholder="Farine 25 kg"
          maxLength={200}
          autoCapitalize="sentences"
          onChange={(event) => patch({ name: event.target.value })}
        />

        <TextField
          label="SKU"
          optional
          value={form.sku}
          maxLength={100}
          placeholder="FAR-25"
          autoCapitalize="characters"
          hint="Must be unique across products."
          onChange={(event) => patch({ sku: event.target.value })}
        />

        <TextField
          label={`Unit price (${DEFAULT_CURRENCY})`}
          optional
          value={form.unitPrice}
          error={priceError}
          inputMode="decimal"
          maxLength={16}
          placeholder="0.00"
          hint="A reference price. It does not pre-fill an expense."
          onChange={(event) => patch({ unitPrice: event.target.value })}
        />

        <TextAreaField
          label="Description"
          optional
          rows={2}
          value={form.description}
          maxLength={2000}
          onChange={(event) => patch({ description: event.target.value })}
        />

        {mode === 'edit' && (
          <div className="catalog-danger">
            <Button
              variant="danger"
              block
              loading={deleteMutation.isPending}
              onClick={() => void remove()}
            >
              Delete product
            </Button>
            <p className="field__hint">
              Refused if any transaction still refers to it — nothing in the ledger can be orphaned
              this way.
            </p>
          </div>
        )}
      </div>

      {!nativeSaveButton && (
        <div className="entry-form__submit-bar entry-form__submit-bar--no-tabbar">
          <Button
            size="lg"
            block
            loading={mutation.isPending}
            disabled={!isValid}
            onClick={() => void submit()}
          >
            {mode === 'edit' ? 'Save changes' : 'Add product'}
          </Button>
        </div>
      )}
    </>
  );
}

/** Mirrors the backend's `decimal2` check, so the API's 400 is unreachable from this form. */
function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-9;
}
