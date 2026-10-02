import { useMemo } from 'react';

import { categoryVisual } from '@/lib/categoryMeta';
import { formatCategoryName } from '@/lib/format';
import { sortCategoriesByUse } from '@/lib/recent';
import { haptics } from '@/lib/telegram';
import type { Category, TransactionType } from '@/types/api';

import './form.css';

interface CategoryGridProps {
  categories: Category[];
  type: TransactionType;
  value: number | null;
  onChange: (categoryId: number) => void;
}

/**
 * One-tap category selection.
 *
 * Two decisions do the work here:
 *   - **Filtered by type.** The backend enforces a category↔type rule (an INCOME-only
 *     category rejects an EXPENSE transaction with a 400). Filtering here means the invalid
 *     option is never shown, so that error is unreachable rather than merely handled.
 *   - **Ordered by this device's usage.** The categories someone actually uses float to the
 *     top, so the common case is a tap without a scroll. See `lib/recent.ts`.
 */
export function CategoryGrid({ categories, type, value, onChange }: CategoryGridProps) {
  const ordered = useMemo(() => sortCategoriesByUse(categories, type), [categories, type]);

  if (ordered.length === 0) {
    return (
      <p className="field__hint">
        No {type.toLowerCase()} categories exist yet — one has to be created first.
      </p>
    );
  }

  return (
    <div className="cat-grid" role="group" aria-label="Category">
      {ordered.map((category) => {
        const visual = categoryVisual(category);
        return (
          <button
            key={category.id}
            type="button"
            aria-pressed={value === category.id}
            className="cat-tile"
            style={{ '--cat-color': visual.color } as React.CSSProperties}
            onClick={() => {
              haptics.tap();
              onChange(category.id);
            }}
          >
            <span className="cat-tile__icon" aria-hidden="true">
              {visual.icon}
            </span>
            <span className="cat-tile__name">{formatCategoryName(category.name)}</span>
          </button>
        );
      })}
    </div>
  );
}
