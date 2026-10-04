import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useProducts, useSuppliers } from '@/api/hooks';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatAmount } from '@/lib/format';

import { CATALOG, type CatalogKind } from './catalog';
import './catalog.css';

/** A row, reduced to what the list shows. */
interface Row {
  id: number;
  name: string;
  /** Second line: whatever identifies this record at a glance. */
  subtitle: string | null;
  /** Right-aligned: a price, where there is one. */
  trailing: string | null;
}

/**
 * Suppliers or products, listed and searchable, with every row opening its edit form.
 *
 * One component for both because the two lists differ only in which fields make the subtitle —
 * the search box, the empty state, the add affordance and the row behaviour are identical, and
 * two copies of them would drift. The **forms** are separate components, because there the field
 * sets have nothing in common.
 *
 * There is no read-only detail screen between the list and the form. For a record with six
 * editable fields and no history, a detail view would be the same information one tap further
 * away; the form is the detail view.
 */
export function CatalogPage({ kind }: { kind: CatalogKind }) {
  const config = CATALOG[kind];
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);

  // Both hooks run unconditionally (rules of hooks); only the relevant one is enabled.
  const suppliers = useSuppliers(debouncedSearch, kind === 'supplier');
  const products = useProducts(debouncedSearch, kind === 'product');
  const query = kind === 'supplier' ? suppliers : products;

  const rows: Row[] =
    kind === 'supplier'
      ? (suppliers.data ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          subtitle: s.contactPerson ?? s.phone ?? s.email ?? null,
          trailing: null,
        }))
      : (products.data ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          subtitle: p.sku ? `SKU ${p.sku}` : (p.description ?? null),
          trailing: p.unitPrice ? formatAmount(p.unitPrice) : null,
        }));

  return (
    <>
      <ScreenHeader
        title={config.plural}
        action={
          <Link to={config.newPath} className="screen-header__link">
            + New
          </Link>
        }
      />

      <div className="page">
        <input
          className="input"
          type="search"
          value={search}
          placeholder={config.searchPlaceholder}
          onChange={(event) => setSearch(event.target.value)}
        />

        <Card flush>
          {query.isLoading ? (
            <LoadingState label={`Loading ${config.plural.toLowerCase()}…`} />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={config.icon}
              title={search ? 'No matches' : `No ${config.plural.toLowerCase()} yet`}
              description={
                search
                  ? 'Try a different search term.'
                  : `Add the first one and it becomes selectable on every income and expense.`
              }
              action={
                search ? undefined : (
                  <Link to={config.newPath} className="btn btn--primary btn--sm">
                    {config.addLabel}
                  </Link>
                )
              }
            />
          ) : (
            <ul>
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="list-row"
                    onClick={() => navigate(config.path(row.id))}
                  >
                    <span className="catalog-avatar" aria-hidden="true">
                      {config.icon}
                    </span>
                    <span className="list-row__main">
                      <span className="list-row__title">{row.name}</span>
                      {row.subtitle && <span className="list-row__subtitle">{row.subtitle}</span>}
                    </span>
                    {row.trailing && (
                      <span className="catalog-row__trailing numeric">{row.trailing}</span>
                    )}
                    <span className="list-row__chevron" aria-hidden="true">
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {rows.length > 0 && (
          <p className="field__hint">
            {rows.length}{' '}
            {rows.length === 1 ? config.singular.toLowerCase() : config.plural.toLowerCase()}
            {search ? ' matching' : ''}. Tap one to edit it.
          </p>
        )}
      </div>
    </>
  );
}
