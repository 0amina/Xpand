import { useState } from 'react';

import { usePackaging, useProducts, useSuppliers } from '@/api/hooks';
import { Sheet } from '@/components/ui/Sheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatAmount } from '@/lib/format';
import { haptics } from '@/lib/telegram';
import type { EntityKind } from '@/types/api';

import './form.css';

/** What each kind renders and where it fetches from. */
const CONFIG: Record<EntityKind, { label: string; searchPlaceholder: string; emptyIcon: string }> =
  {
    supplier: { label: 'Supplier', searchPlaceholder: 'Search suppliers…', emptyIcon: '🚚' },
    product: { label: 'Product', searchPlaceholder: 'Search products…', emptyIcon: '📦' },
    packaging: { label: 'Packaging', searchPlaceholder: 'Search packaging…', emptyIcon: '🧃' },
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
 * Searchable single-select for the optional supplier / product / packaging links on an
 * expense.
 *
 * Opens as a bottom sheet and fetches lazily — the three lists are irrelevant to a plain cash
 * expense, so nothing is requested until a picker is actually opened.
 */
export function EntityPicker({ kind, value, onChange, selectedName }: EntityPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const config = CONFIG[kind];

  // All three hooks run unconditionally (rules of hooks) but only the relevant one is enabled,
  // and only once the sheet is open.
  const suppliers = useSuppliers(debouncedSearch, open && kind === 'supplier');
  const products = useProducts(debouncedSearch, open && kind === 'product');
  const packaging = usePackaging(debouncedSearch, open && kind === 'packaging');

  const query = kind === 'supplier' ? suppliers : kind === 'product' ? products : packaging;

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

  const displayName = selectedName ?? options.find((o) => o.id === value)?.name ?? null;

  const select = (id: number) => {
    haptics.tap();
    onChange(id === value ? null : id); // Tapping the current selection clears it.
    setOpen(false);
  };

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
              search
                ? 'Try a different search term.'
                : `${config.label} records can be added through the API.`
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
          </ul>
        )}
      </Sheet>
    </>
  );
}
