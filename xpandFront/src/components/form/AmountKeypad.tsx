import { useMemo } from 'react';

import { applyKey, displayParts, parseAmount, type AmountValue } from '@/lib/amount';
import { haptics } from '@/lib/telegram';
import { DEFAULT_CURRENCY } from '@/types/api';

import './form.css';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'backspace'] as const;

interface AmountKeypadProps {
  value: AmountValue;
  onChange: (value: AmountValue) => void;
  tone: 'income' | 'expense';
  currency?: string;
}

/**
 * A purpose-built numeric pad instead of `<input type="number">`.
 *
 * Three reasons, all specific to a Telegram Mini App:
 *   - The OS keyboard resizes the webview every time it opens, so the layout jumps mid-entry.
 *     It is the single most complained-about behaviour in Mini Apps.
 *   - Android's numeric keyboard hides the decimal separator behind a long-press in some
 *     locales, and hands back a comma where the API needs a dot.
 *   - These targets are roughly twice the height of a system key, which matters when someone
 *     is entering forty transactions standing at a counter.
 *
 * The entry rules live in `lib/amount.ts`; this component only renders and dispatches.
 */
export function AmountKeypad({
  value,
  onChange,
  tone,
  currency = DEFAULT_CURRENCY,
}: AmountKeypadProps) {
  const { integer, decimal } = useMemo(() => displayParts(value), [value]);
  const isEmpty = value === '' || parseAmount(value) === 0;

  const press = (key: string) => {
    const next = applyKey(value, key);
    if (next !== value) haptics.tap();
    onChange(next);
  };

  return (
    <div className="keypad">
      <div
        className={`keypad__display keypad__display--${tone} ${isEmpty ? 'is-empty' : ''}`}
        role="status"
        aria-live="polite"
        aria-label={`Amount: ${value || '0'} ${currency}`}
      >
        <span className="keypad__sign" aria-hidden="true">
          {tone === 'income' ? '+' : '−'}
        </span>
        <span className="keypad__value numeric">
          {integer}
          {decimal !== null && <span className="keypad__decimal">.{decimal}</span>}
        </span>
        <span className="keypad__currency">{currency}</span>
      </div>

      <div className="keypad__grid">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className={`keypad__key ${key === 'backspace' ? 'keypad__key--action' : ''}`}
            aria-label={key === 'backspace' ? 'Delete last digit' : key}
            onClick={() => press(key)}
          >
            {key === 'backspace' ? '⌫' : key}
          </button>
        ))}
      </div>
    </div>
  );
}
