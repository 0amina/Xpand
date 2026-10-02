import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { haptics } from '@/lib/telegram';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'income' | 'expense';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  /** Swaps the label for a spinner and blocks further presses. */
  loading?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  disabled,
  className = '',
  onClick,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    `btn--${variant}`,
    size !== 'md' && `btn--${size}`,
    block && 'btn--block',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      onClick={(event) => {
        haptics.impact('light');
        onClick?.(event);
      }}
      {...rest}
    >
      {loading ? (
        <>
          <span
            className={`spinner ${variant === 'secondary' || variant === 'ghost' ? '' : 'spinner--on-accent'}`}
            aria-hidden="true"
          />
          <span className="sr-only">Working…</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
