import { Chip } from '@/components/ui/Chip';
import { addDays, formatRelativeDate, todayISO } from '@/lib/format';

import './form.css';

interface DateFieldProps {
  value: string;
  onChange: (iso: string) => void;
}

/**
 * Date entry optimised for the overwhelmingly common answer: today.
 *
 * The form already defaults to today, so most entries never touch this. "Yesterday" covers
 * the next most common case (catching up on last night's till) in one tap, and the native
 * date input handles the rest — no custom calendar to maintain or to get wrong on a webview.
 */
export function DateField({ value, onChange }: DateFieldProps) {
  const today = todayISO();
  const yesterday = addDays(today, -1);

  return (
    <div className="date-quick-row">
      <Chip selected={value === today} onClick={() => onChange(today)}>
        Today
      </Chip>
      <Chip selected={value === yesterday} onClick={() => onChange(yesterday)}>
        Yesterday
      </Chip>
      <input
        type="date"
        className="input"
        value={value}
        // A transaction cannot be logged into the future — the cash-position report excludes
        // future-dated rows, so one would silently vanish from the balance.
        max={today}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value);
        }}
        aria-label={`Transaction date, currently ${formatRelativeDate(value)}`}
      />
    </div>
  );
}
