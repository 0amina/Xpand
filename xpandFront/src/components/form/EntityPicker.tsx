import { useState } from 'react';
import { Link } from 'react-router-dom';

import {
  useCreateProduct,
  useCreateSupplier,
  useEntityName,
  usePackaging,
  useProducts,
  useSuppliers,
} from '@/api/hooks';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useToast } from '@/hooks/useToast';
import { describeError } from '@/lib/errors';
import { formatAmount } from '@/lib/format';
import { haptics } from '@/lib/telegram';
import type { EntityKind } from '@/types/api';

import './form.css';

/**
 * What each kind renders and where it fetches from.
 *
 * `managePath` is null for packaging: the API accepts writes, but there is no screen for them —
 * see the note in `features/catalog/catalog.ts`.
 */
const CONFIG: Record<
  EntityKind,
  { label: string; searchPlaceholder: string; emptyIcon: string; managePath: string | null }
> = {
  supplier: {
    label: 'Supplier',
    searchPlaceholder: 'Search suppliers…',
    emptyIcon: '🚚',
    managePath: '/suppliers',
  },
  product: {
    label: 'Product',
    searchPlaceholder: 'Search products…',
    emptyIcon: '📦',
    managePath: '/products',
  },
  packaging: {
    label: 'Packaging',
    searchPlaceholder: 'Search packaging…',
    emptyIcon: '🧃',
    managePath: null,
  },
};

interface Option {
  id: number;
  name: string;
  /** Right-aligned secondary text: a phone number, an SKU, a unit price. */
  meta?: string;
}

interface EntityPickerProps {
  kind: EntityKind;
  value: number | null;
  onChange: (id: number | null) => void;
  /** Name of the current selection, so the trigger can show it without a second fetch. */
  selectedName?: string | null;
}

/**
 * Searchable single-select for the optional supplier / product / packaging links on a
 * transaction.
 *
 * Opens as a bottom sheet and fetches lazily — the three lists are irrelevant to a plain cash
 * expense, so nothing is requested until a picker is actually opened.
 *
 * A supplier or product the list does not have can be **created from here**, by name, without
 * abandoning a half-filled form. That is the point: discovering mid-entry that the supplier is
 * missing used to mean giving up on the field. The rest of the record — phone, SKU, price — is
 * still edited on its own screen, linked from the footer.
 */
export function EntityPicker({ kind, value, onChange, selectedName }: EntityPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const config = CONFIG[kind];
  const toast = useToast();

  // All three hooks run unconditionally (rules of hooks) but only the relevant one is enabled,
  // and only once the sheet is open.
  const suppliers = useSuppliers(debouncedSearch, open && kind === 'supplier');
  const products = useProducts(debouncedSearch, open && kind === 'product');
  const packaging = usePackaging(debouncedSearch, open && kind === 'packaging');

  const query = kind === 'supplier' ? suppliers : kind === 'product' ? products : packaging;

  const createSupplier = useCreateSupplier();
  const createProduct = useCreateProduct();
  const createMutation = kind === 'supplier' ? createSupplier : createProduct;

  const options: Option[] = (() => {
    if (kind === 'supplier') {
      return (suppliers.data ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        meta: s.phone ?? s.contactPerson ?? undefined,
      }));
    }
    if (kind === 'product') {
      return (products.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        meta: p.sku ?? (p.unitPrice ? formatAmount(p.unitPrice) : undefined),
      }));
    }
    return (packaging.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      meta: p.unit ?? (p.unitCost ? formatAmount(p.unitCost) : undefined),
    }));
  })();

  // The list is only fetched once the sheet has been opened, so on an edit form a selected id has
  // no name to show until then — the trigger read "Choose supplier" over a value that was set.
  // This resolves that one record directly, and is skipped when the caller supplies the name.
  const resolved = useEntityName(kind, selectedName ? null : value);
  const displayName =
    selectedName ??
    options.find((o) => o.id === value)?.name ??
    resolved.data?.name ??
    (value !== null && resolved.isLoading ? '…' : null);

  const select = (id: number) => {
    haptics.tap();
    onChange(id === value ? null : id); // Tapping the current selection clears it.
    setOpen(false);
  };

  /** Create a record from whatever is typed in the search box, then select it. */
  const createFromSearch = async () => {
    const name = search.trim();
    if (!name || config.managePath === null) return;

    try {
      const created =
        kind === 'supplier'
          ? await createSupplier.mutateAsync({ name })
          : await createProduct.mutateAsync({ name });

      haptics.success();
      toast.success(`${created.name} added.`);
      onChange(created.id);
      setSearch('');
      setOpen(false);
    } catch (error) {
      const { description } = describeError(error);
      toast.error(description);
    }
  };

  /** Whether the typed name is worth offering as a new record. */
  const typed = search.trim();
  const canCreate =
    config.managePath !== null &&
    typed.length > 0 &&
    !options.some((o) => o.name.toLowerCase() === typed.toLowerCase());

  return (
    <>
      <button type="button" className="picker-trigger" onClick={() => setOpen(true)}>
        <span
          className={`picker-trigger__value ${displayName ? '' : 'picker-trigger__value--empty'}`}
        >
          {displayName ?? `Choose ${config.label.toLowerCase()}`}
        </span>
        {value !== null ? (
          <span
            className="picker-trigger__clear"
            role="button"
            tabIndex={0}
            aria-label={`Clear ${config.label.toLowerCase()}`}
            onClick={(event) => {
              // The clear affordance sits inside the trigger, so stop the click from also
              // opening the sheet it lives in.
              event.stopPropagation();
              haptics.tap();
              onChange(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.stopPropagation();
                event.preventDefault();
                onChange(null);
              }
            }}
          >
            ✕
          </span>
        ) : (
          <span className="list-row__chevron" aria-hidden="true">
            ›
          </span>
        )}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={config.label} flush>
        <div className="picker-search">
          <input
            className="input"
            type="search"
            value={search}
            placeholder={config.searchPlaceholder}
            onChange={(event) => setSearch(event.target.value)}
            // The sheet exists to be searched, so focusing it saves a tap. Only reached by an
            // explicit tap on the trigger, never on page load.
            autoFocus
          />
        </div>

        {query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : options.length === 0 ? (
          <EmptyState
            icon={config.emptyIcon}
            title={search ? 'No matches' : `No ${config.label.toLowerCase()} records`}
            description={
              config.managePath === null
                ? 'Packaging records are managed through the API.'
                : search
                  ? 'Nothing matches that. Add it as a new record, or search for something else.'
                  : 'Add the first one and it stays available on every entry afterwards.'
            }
            action={
              canCreate ? (
                <Button
                  size="sm"
                  loading={createMutation.isPending}
                  onClick={() => void createFromSearch()}
                >
                  Add &ldquo;{typed}&rdquo;
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul>
            {options.map((option) => (
              <li key={option.id}>
                <button type="button" className="picker-option" onClick={() => select(option.id)}>
                  <span className="picker-option__name">{option.name}</span>
                  {option.meta && <span className="picker-option__meta">{option.meta}</span>}
                  {value === option.id && (
                    <span className="picker-option__check" aria-label="Selected">
                      ✓
                    </span>
                  )}
                </button>
              </li>
            ))}

            {/* Offered alongside near-misses too: "Sotupa" matching "Sotupa Nord" does not mean
                the record you want already exists. */}
            {canCreate && (
              <li>
                <button
                  type="button"
                  className="picker-option picker-option--create"
                  disabled={createMutation.isPending}
                  onClick={() => void createFromSearch()}
                >
                  <span className="picker-option__name">+ Add &ldquo;{typed}&rdquo;</span>
                  <span className="picker-option__meta">
                    {createMutation.isPending ? 'Adding…' : `New ${config.label.toLowerCase()}`}
                  </span>
                </button>
              </li>
            )}
          </ul>
        )}

        {config.managePath !== null && (
          <div className="picker-footer">
            <Link to={config.managePath} onClick={() => setOpen(false)}>
              Manage {config.label.toLowerCase()}s
            </Link>
            <span className="field__hint">
              Phone numbers, SKUs and prices are edited there. Adding one here only needs a name.
            </span>
          </div>
        )}
      </Sheet>
    </>
  );
}
