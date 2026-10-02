import { Chip } from '@/components/ui/Chip';
import { formatPaymentMethod } from '@/lib/format';
import { PAYMENT_METHODS, type PaymentMethod } from '@/types/api';

interface PaymentMethodRowProps {
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
}

/**
 * Payment method as a single scrollable chip row. Always has a value — the form seeds it from
 * whatever was used last (usually CASH), so this is a correction, not a required step.
 */
export function PaymentMethodRow({ value, onChange }: PaymentMethodRowProps) {
  return (
    <div className="chip-row" role="group" aria-label="Payment method">
      {PAYMENT_METHODS.map((method) => (
        <Chip key={method} selected={value === method} onClick={() => onChange(method)}>
          {formatPaymentMethod(method)}
        </Chip>
      ))}
    </div>
  );
}
