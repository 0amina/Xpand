/**
 * Keypad amount arithmetic, kept apart from the component that renders it so the rules are
 * testable on their own and can be reused by any other amount entry point.
 *
 * The value is carried as an **in-progress string** ("", "0.", "12.5") rather than a number,
 * because a number cannot represent "the user has typed a decimal point but no decimals yet".
 * It converts to a number only at submit time.
 */

/**
 * The backend caps `amount` at NUMERIC(12,2) and its Zod schema rejects anything larger.
 * Enforced here too, so the keypad simply stops accepting digits instead of letting someone
 * type a number that comes back as a 400 after they press save.
 */
export const MAX_AMOUNT = 9_999_999_999.99;

export type AmountValue = string;

/**
 * Split an in-progress amount into a grouped integer part and a raw decimal part.
 *
 * The decimal side is deliberately not padded: while someone is typing "12." the display must
 * read "12." and not "12.00", or the trailing dot looks like it was swallowed.
 */
export function displayParts(value: AmountValue): { integer: string; decimal: string | null } {
  if (value === '') return { integer: '0', decimal: null };

  const [rawInt, rawDec] = value.split('.');
  const grouped = new Intl.NumberFormat('en-US').format(Number(rawInt || '0'));

  return { integer: grouped, decimal: rawDec === undefined ? null : rawDec };
}

/** The in-progress string → the JSON number the API expects. `''` and `'.'` both mean 0. */
export function parseAmount(value: AmountValue): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  // Guards a float artefact (0.1 + 0.2) from reaching a column with a 2-decimal CHECK.
  return Math.round(n * 100) / 100;
}

/** Apply one keypress to the current value, rejecting anything that would be invalid. */
export function applyKey(current: AmountValue, key: string): AmountValue {
  if (key === 'backspace') return current.slice(0, -1);

  if (key === '.') {
    if (current.includes('.')) return current; // Only one decimal point.
    return current === '' ? '0.' : `${current}.`;
  }

  // Block a second leading zero ("00"), but allow "0." to start a sub-unit amount.
  if (current === '0' && key === '0') return current;
  if (current === '0' && key !== '.') return key;

  const [, decimals] = current.split('.');
  if (decimals !== undefined && decimals.length >= 2) return current; // Max 2 decimal places.

  const next = current + key;
  if (parseAmount(next) > MAX_AMOUNT) return current;

  return next;
}
