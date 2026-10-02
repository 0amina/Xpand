import type { Category } from '@/types/api';

/**
 * Visual identity for a category chip.
 *
 * The `categories` table has `icon` and `color` columns, but they are nullable and currently
 * unset for the seeded rows. So: use the DB values when present, fall back to a curated map
 * of the 11 seeded categories, and fall back again to a deterministic colour derived from the
 * name — a brand-new category still gets a stable, distinct chip without a migration.
 */

interface CategoryVisual {
  icon: string;
  color: string;
}

/**
 * The 11 seeded categories. Names are French and lowercase, exactly as they exist in the DB —
 * including `'charges fixes'` with a space (the backend README flags this deliberately).
 */
const SEEDED: Record<string, CategoryVisual> = {
  salaries: { icon: '👥', color: '#f0724a' },
  suppliers: { icon: '🚚', color: '#e0505b' },
  transport: { icon: '🚗', color: '#4a9df0' },
  packaging: { icon: '📦', color: '#b06ee0' },
  sponsoring: { icon: '📣', color: '#e05ba0' },
  subscriptions: { icon: '🔄', color: '#5b6ee0' },
  prets: { icon: '🏦', color: '#7a8a9e' },
  investissements: { icon: '📈', color: '#3aa88a' },
  recettes: { icon: '💰', color: '#2fa96b' },
  divers: { icon: '📌', color: '#9a8a70' },
  'charges fixes': { icon: '🏢', color: '#c07a3a' },
};

/** Distinct, evenly-spaced hues for categories not in the seeded map. */
const FALLBACK_PALETTE = [
  '#4a9df0',
  '#2fa96b',
  '#e0505b',
  '#b06ee0',
  '#f0a53a',
  '#3aa8a8',
  '#e05ba0',
  '#7a8a9e',
];

/** A stable, non-cryptographic hash so the same name always picks the same fallback colour. */
function hashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0; // Coerce back to a 32-bit int.
  }
  return Math.abs(hash);
}

export function categoryVisual(
  category: Pick<Category, 'name' | 'icon' | 'color'>,
): CategoryVisual {
  const key = category.name.trim().toLowerCase();
  const seeded = SEEDED[key];

  return {
    icon: category.icon || seeded?.icon || '•',
    color:
      category.color || seeded?.color || FALLBACK_PALETTE[hashCode(key) % FALLBACK_PALETTE.length],
  };
}
