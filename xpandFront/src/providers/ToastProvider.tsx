import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

import { haptics } from '@/lib/telegram';

import { ToastContext, type Toast, type ToastApi, type ToastTone } from './toastContext';

const DURATION_MS = 3600;

const ICONS: Record<ToastTone, string> = {
  success: '✅',
  error: '⚠️',
  warning: '⚠️',
  info: 'ℹ️',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = nextId.current++;
      // Cap the stack: a burst of failures shouldn't paper over the screen.
      setToasts((current) => [...current.slice(-2), { id, tone, message }]);

      if (tone === 'success') haptics.success();
      else if (tone === 'error') haptics.error();
      else if (tone === 'warning') haptics.warning();

      window.setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message: string) => show(message, 'success'),
      error: (message: string) => show(message, 'error'),
      warning: (message: string) => show(message, 'warning'),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* `polite` rather than `assertive`: these confirm an action the user just took, so
          interrupting whatever the screen reader is saying would be the wrong trade. */}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast--${toast.tone}`}
            onClick={() => dismiss(toast.id)}
          >
            <span className="toast__icon" aria-hidden="true">
              {ICONS[toast.tone]}
            </span>
            <span className="toast__message">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
