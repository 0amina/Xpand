import { useState, type ReactNode } from 'react';

import { haptics } from '@/lib/telegram';

import './form.css';

interface DisclosureProps {
  label: string;
  /** How many optional fields inside are filled — surfaced as a badge when collapsed. */
  filledCount?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * Collapsible section for the optional half of a form.
 *
 * Supplier, product, packaging and invoice are genuinely optional and used on a minority of
 * entries, so folding them away keeps the hot path — amount, category, save — on one screen.
 * The count badge means a collapsed section never hides a value the user has already set.
 */
export function Disclosure({
  label,
  filledCount = 0,
  defaultOpen = false,
  children,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen || filledCount > 0);

  return (
    <div className="disclosure">
      <button
        type="button"
        className="disclosure__summary"
        aria-expanded={open}
        onClick={() => {
          haptics.impact('light');
          setOpen((value) => !value);
        }}
      >
        <span className={`disclosure__chevron ${open ? 'is-open' : ''}`} aria-hidden="true">
          ▶
        </span>
        <span>{label}</span>
        {filledCount > 0 && <span className="disclosure__count">{filledCount}</span>}
      </button>
      {open && <div className="disclosure__content">{children}</div>}
    </div>
  );
}
