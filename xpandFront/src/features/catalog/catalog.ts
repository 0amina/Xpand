/**
 * The two catalog entities the app can manage, and the strings each screen needs.
 *
 * Kept out of the components so the list, the forms and the entity picker all name a supplier
 * the same way, and so routes are written once. Packaging is deliberately absent: the API
 * supports it, but nothing in this company's workflow adds one, and a third screen nobody opens
 * is three more places for the wording to drift.
 */
export type CatalogKind = 'supplier' | 'product';

interface CatalogConfig {
  singular: string;
  plural: string;
  /** Used on the empty state and as the row avatar. */
  icon: string;
  addLabel: string;
  searchPlaceholder: string;
  newPath: string;
  /** The edit form for one record. Doubles as its detail screen. */
  path: (id: number) => string;
  listPath: string;
}

export const CATALOG: Record<CatalogKind, CatalogConfig> = {
  supplier: {
    singular: 'Supplier',
    plural: 'Suppliers',
    icon: '🚚',
    addLabel: 'Add supplier',
    searchPlaceholder: 'Search by name, contact, phone or email…',
    newPath: '/suppliers/new',
    path: (id) => `/suppliers/${id}`,
    listPath: '/suppliers',
  },
  product: {
    singular: 'Product',
    plural: 'Products',
    icon: '📦',
    addLabel: 'Add product',
    searchPlaceholder: 'Search by name or SKU…',
    newPath: '/products/new',
    path: (id) => `/products/${id}`,
    listPath: '/products',
  },
};

/**
 * An optional text field's value as the **create** endpoint wants it: trimmed, or the key
 * omitted. The API rejects an explicit null on a create, and an omitted field is stored as null
 * anyway.
 */
export function forCreate(value: string): string | undefined {
  return value.trim() || undefined;
}

/**
 * The same value as the **update** endpoint wants it: trimmed, or an explicit `null`.
 *
 * On a PATCH `undefined` means "leave this alone", so an emptied input has to send null or the
 * old value would survive a save that visibly cleared the field.
 */
export function forUpdate(value: string): string | null {
  return value.trim() || null;
}
