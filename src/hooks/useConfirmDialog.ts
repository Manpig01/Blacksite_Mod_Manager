import { useState, useCallback, useRef } from 'react';
import { TacticalConfirmModalProps } from '../components/TacticalConfirmModal';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  severity?: 'danger' | 'warning' | 'info';
}

export function useConfirmDialog() {
  const [dialogState, setDialogState] = useState<ConfirmOptions & { isOpen: boolean }>({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    severity: 'danger',
  });

  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const requestConfirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setDialogState({
        isOpen: true,
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel || 'Confirm',
        cancelLabel: options.cancelLabel || 'Cancel',
        severity: options.severity || 'danger',
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setDialogState((prev) => ({ ...prev, isOpen: false }));
    if (resolverRef.current) {
      resolverRef.current(true);
      resolverRef.current = null;
    }
  }, []);

  const handleCancel = useCallback(() => {
    setDialogState((prev) => ({ ...prev, isOpen: false }));
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }
  }, []);

  const confirmModalProps: TacticalConfirmModalProps = {
    isOpen: dialogState.isOpen,
    title: dialogState.title,
    message: dialogState.message,
    confirmLabel: dialogState.confirmLabel,
    cancelLabel: dialogState.cancelLabel,
    severity: dialogState.severity,
    onConfirm: handleConfirm,
    onCancel: handleCancel,
  };

  return {
    requestConfirm,
    confirmModalProps,
  };
}
