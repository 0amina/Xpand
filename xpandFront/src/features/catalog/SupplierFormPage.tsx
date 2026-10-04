import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useCreateSupplier, useDeleteSupplier, useSupplier, useUpdateSupplier } from '@/api/hooks';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { useTelegramMainButton } from '@/hooks/useTelegramButtons';
import { useToast } from '@/hooks/useToast';
import { describeError } from '@/lib/errors';
import { confirmDialog, haptics } from '@/lib/telegram';

import '@/components/form/form.css';
import { CATALOG, forCreate, forUpdate } from './catalog';
import './catalog.css';

interface FormState {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

const BLANK: FormState = {
  name: '',
  contactPerson: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
};

/**
 * Add or edit a supplier.
 *
 * Only the name is required — it is the sole NOT NULL column, and a supplier that is just a name
 * is a perfectly useful thing to have on an expense. Every other field exists so the record can
 * grow into something you can phone.
 *
 * The product and packaging links the detail endpoint returns are not editable here. Those are
 * priced relationships with their own endpoints, and nothing in the app reads them yet; putting
 * them on this form would be inventing a workflow rather than exposing one.
 */
export function SupplierFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const config = CATALOG.supplier;
  const editingId = mode === 'edit' && params.id ? Number(params.id) : undefined;
  const existing = useSupplier(editingId);

  const [form, setForm] = useState<FormState>(BLANK);
  const [submitted, setSubmitted] = useState(false);

  const createMutation = useCreateSupplier();
  const updateMutation = useUpdateSupplier();
  const deleteMutation = useDeleteSupplier();
  const mutation = mode === 'edit' ? updateMutation : createMutation;

  const patch = (changes: Partial<FormState>) => setForm((current) => ({ ...current, ...changes }));

  useEffect(() => {
    if (mode !== 'edit' || !existing.data) return;
    const s = existing.data;
    setForm({
      name: s.name,
      contactPerson: s.contactPerson ?? '',
      phone: s.phone ?? '',
      email: s.email ?? '',
      address: s.address ?? '',
      notes: s.notes ?? '',
    });
  }, [mode, existing.data]);

  const name = form.name.trim();
  const email = form.email.trim();
  // Matched loosely on purpose: the backend's `z.string().email()` is the real check, and a
  // stricter pattern here would reject an address the API would have accepted.
  const emailLooksWrong = email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const nameError = submitted && !name ? 'A name is required.' : undefined;
  const emailError = emailLooksWrong ? 'That does not look like an email address.' : undefined;
  const isValid = name.length > 0 && !emailLooksWrong;

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
            contactPerson: forUpdate(form.contactPerson),
            phone: forUpdate(form.phone),
            email: forUpdate(form.email),
            address: forUpdate(form.address),
            notes: forUpdate(form.notes),
          },
        });
        toast.success(`${name} updated.`);
      } else {
        await createMutation.mutateAsync({
          name,
          contactPerson: forCreate(form.contactPerson),
          phone: forCreate(form.phone),
          email: forCreate(form.email),
          address: forCreate(form.address),
          notes: forCreate(form.notes),
        });
        toast.success(`${name} added.`);
      }
      navigate(config.listPath, { replace: true });
    } catch (error) {
      const { description } = describeError(error);
      toast.error(description);
    }
  };

  const remove = async () => {
    if (editingId === undefined) return;
    if (!(await confirmDialog(`Delete ${form.name || 'this supplier'}?`))) return;

    try {
      await deleteMutation.mutateAsync(editingId);
      toast.success('Supplier deleted.');
      navigate(config.listPath, { replace: true });
    } catch (error) {
      // A supplier already used by a transaction comes back as a 409 carrying the count. That is
      // the useful message, so it is shown as-is rather than flattened to "could not delete".
      const { description } = describeError(error);
      toast.error(description);
    }
  };

  const nativeSaveButton = useTelegramMainButton({
    text: mode === 'edit' ? 'Save changes' : 'Add supplier',
    onClick: () => void submit(),
    enabled: isValid,
    loading: mutation.isPending,
  });

  if (mode === 'edit' && existing.isLoading) return <LoadingState label="Loading supplier…" />;
  if (mode === 'edit' && existing.isError) {
    return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;
  }

  return (
    <>
      <ScreenHeader title={mode === 'edit' ? 'Edit supplier' : 'New supplier'} />

      <div className={`entry-form ${nativeSaveButton ? '' : 'entry-form--with-submit-bar'}`}>
        <TextField
          label="Name"
          value={form.name}
          error={nameError}
          placeholder="Sotupa"
          maxLength={200}
          autoCapitalize="words"
          onChange={(event) => patch({ name: event.target.value })}
        />

        <TextField
          label="Contact person"
          optional
          value={form.contactPerson}
          maxLength={200}
          autoCapitalize="words"
          onChange={(event) => patch({ contactPerson: event.target.value })}
        />

        <TextField
          label="Phone"
          optional
          value={form.phone}
          type="tel"
          inputMode="tel"
          maxLength={30}
          placeholder="+216 71 000 000"
          onChange={(event) => patch({ phone: event.target.value })}
        />

        <TextField
          label="Email"
          optional
          value={form.email}
          error={emailError}
          type="email"
          inputMode="email"
          autoCapitalize="none"
          maxLength={200}
          onChange={(event) => patch({ email: event.target.value })}
        />

        <TextAreaField
          label="Address"
          optional
          rows={2}
          value={form.address}
          maxLength={2000}
          onChange={(event) => patch({ address: event.target.value })}
        />

        <TextAreaField
          label="Notes"
          optional
          rows={2}
          value={form.notes}
          maxLength={2000}
          hint="Payment terms, delivery days, anything worth remembering."
          onChange={(event) => patch({ notes: event.target.value })}
        />

        {mode === 'edit' && (
          <div className="catalog-danger">
            <Button
              variant="danger"
              block
              loading={deleteMutation.isPending}
              onClick={() => void remove()}
            >
              Delete supplier
            </Button>
            <p className="field__hint">
              Refused if any transaction still refers to it — nothing in the ledger can be orphaned
              this way.
            </p>
          </div>
        )}
      </div>

      {/* Same rule as the entry form: only rendered where Telegram has no MainButton of its own. */}
      {!nativeSaveButton && (
        <div className="entry-form__submit-bar entry-form__submit-bar--no-tabbar">
          <Button
            size="lg"
            block
            loading={mutation.isPending}
            disabled={!isValid}
            onClick={() => void submit()}
          >
            {mode === 'edit' ? 'Save changes' : 'Add supplier'}
          </Button>
        </div>
      )}
    </>
  );
}
