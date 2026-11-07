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
    setToasts((prev) => {
      // Deduplicate: if an identical toast title & message was triggered in the last 2 seconds, ignore
      const isDuplicate = prev.some(
        (t) => t.title === title && t.message === message
      );
      if (isDuplicate) return prev;

      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setTimeout(() => {
        setToasts((curr) => curr.filter((t) => t.id !== id));
      }, 4000);

      // Keep at most 4 toasts visible at once for clean viewport appearance
      const next = [...prev, { id, title, message, type }];
      return next.length > 4 ? next.slice(next.length - 4) : next;
    });
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
