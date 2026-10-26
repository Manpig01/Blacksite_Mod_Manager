import { useState, useCallback } from 'react';
import { ToastMessage } from '../types';

export type ShowToastFn = (
  title: string,
  message: string,
  type?: 'success' | 'info' | 'warning' | 'error'
) => void;

export function useToastQueue() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast: ShowToastFn = useCallback((title, message, type = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return {
    toasts,
    showToast,
    dismissToast,
  };
}
