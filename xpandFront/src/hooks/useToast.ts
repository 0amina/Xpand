import { useContext } from 'react';

import { ToastContext, type ToastApi } from '@/providers/toastContext';

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside a <ToastProvider>.');
  }
  return context;
}
