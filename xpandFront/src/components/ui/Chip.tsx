import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { haptics } from '@/lib/telegram';

interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  selected?: boolean;
  /** Tints the selected state green or red on the income/expense forms. */
  tone?: 'accent' | 'income' | 'expense';
  onClick?: () => void;
  children: ReactNode;
}

/**
 * A toggleable pill. Rendered as `aria-pressed` rather than a radio so a screen reader
 * announces the on/off state, which is what these actually are.
 */
export function Chip({
  selected = false,
  tone = 'accent',
  onClick,
  className = '',
  children,
  ...rest
}: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={['chip', tone !== 'accent' && `chip--${tone}`, className]
        .filter(Boolean)
        .join(' ')}
      onClick={() => {
        haptics.tap();
        onClick?.();
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

interface SegmentedProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: string; tone?: 'income' | 'expense' }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}

/** iOS-style segmented control. Used for the All / Income / Expense filter. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          className={['segmented__option', option.tone && `segmented__option--${option.tone}`]
            .filter(Boolean)
            .join(' ')}
          onClick={() => {
            haptics.tap();
            onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
