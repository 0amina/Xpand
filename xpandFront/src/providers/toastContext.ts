import { createContext } from 'react';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

export interface ToastApi {
  show: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
}

/**
 * Split out from the provider component so the module exports only non-components — which
 * keeps React Fast Refresh able to hot-update the provider without dropping app state.
 */
export const ToastContext = createContext<ToastApi | null>(null);
