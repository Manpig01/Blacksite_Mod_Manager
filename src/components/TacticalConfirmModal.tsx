import React, { useEffect } from 'react';
import { AlertTriangle, Trash2, Info, X } from 'lucide-react';

export interface TacticalConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  severity?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

export const TacticalConfirmModal: React.FC<TacticalConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm Action',
  cancelLabel = 'Cancel',
  severity = 'danger',
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onConfirm, onCancel]);

  if (!isOpen) return null;

  const isDanger = severity === 'danger';
  const isWarning = severity === 'warning';

  const borderColor = isDanger
    ? 'border-[#DC2626]/60'
    : isWarning
    ? 'border-[#F59E0B]/60'
    : 'border-[#EA580C]/60';

  const iconBoxClasses = isDanger
    ? 'bg-[#281013] border-[#DC2626]/40 text-[#EF4444]'
    : isWarning
    ? 'bg-[#3A2A10] border-[#F59E0B]/40 text-[#F59E0B]'
    : 'bg-[#2A1810] border-[#EA580C]/40 text-[#EA580C]';

  const confirmBtnClasses = isDanger
    ? 'bg-[#DC2626] hover:bg-red-600 text-white border-[#DC2626]'
    : isWarning
    ? 'bg-[#D97706] hover:bg-[#F59E0B] text-white border-[#D97706]'
    : 'bg-[#EA580C] hover:bg-[#F97316] text-white border-[#EA580C]';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-fade-in"
      onClick={onCancel}
    >
      <div
        className={`w-full max-w-md bg-[#181B20] border ${borderColor} rounded-xl shadow-2xl overflow-hidden text-[#E8EAEE]`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tactical-confirm-title"
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#121418] border-b border-[#23272E] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${iconBoxClasses}`}>
              {isDanger ? (
                <Trash2 className="w-4 h-4" />
              ) : isWarning ? (
                <AlertTriangle className="w-4 h-4" />
              ) : (
                <Info className="w-4 h-4" />
              )}
            </div>
            <div>
              <h3 id="tactical-confirm-title" className="text-sm font-bold text-[#E8EAEE] tracking-tight">
                {title}
              </h3>
              <span className="text-[10.5px] font-mono uppercase tracking-wider text-[#6B7480]">
                {isDanger ? 'Destructive Operation' : isWarning ? 'Confirmation Required' : 'System Prompt'}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="text-[#9AA3AF] hover:text-white p-1 rounded-lg hover:bg-[#20252D] transition-colors cursor-pointer"
            title="Cancel (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 text-xs text-[#9AA3AF] leading-relaxed">
          <p className="text-[13px] text-[#E8EAEE] font-medium whitespace-pre-line">{message}</p>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#121418] border-t border-[#23272E] flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-1.5 rounded-lg bg-[#20252D] hover:bg-[#2A2F38] border border-[#2A2F38] text-xs font-semibold text-[#9AA3AF] hover:text-[#E8EAEE] transition-colors cursor-pointer"
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer shadow-sm ${confirmBtnClasses}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
