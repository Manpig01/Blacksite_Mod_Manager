import React from 'react';
import { ToastMessage } from '../types';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed bottom-12 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((toast) => {
        let titleColor = 'text-[#22C55E]';
        let borderColor = 'border-[#2A2F38]';
        let badgeBg = 'bg-[#15803D]/20';

        if (toast.type === 'error') {
          titleColor = 'text-[#EF4444]';
          borderColor = 'border-[#EF4444]/40';
          badgeBg = 'bg-[#DC2626]/20';
        } else if (toast.type === 'warning') {
          titleColor = 'text-[#F59E0B]';
          borderColor = 'border-[#F59E0B]/40';
          badgeBg = 'bg-[#D97706]/20';
        } else if (toast.type === 'info') {
          titleColor = 'text-[#38BDF8]';
          borderColor = 'border-[#38BDF8]/40';
          badgeBg = 'bg-[#0284C7]/20';
        }

        return (
          <div
            key={toast.id}
            onClick={() => onDismiss(toast.id)}
            className={`pointer-events-auto bg-[#181B20]/95 backdrop-blur-md border ${borderColor} rounded-xl p-3 shadow-2xl animate-toast cursor-pointer transition-all hover:scale-[1.01] hover:bg-[#20252D] group`}
            role="alert"
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className={`text-xs font-bold ${titleColor} flex items-center gap-1.5`}>
                <span className={`w-1.5 h-1.5 rounded-full ${titleColor.replace('text-', 'bg-')}`} />
                <span>{toast.title}</span>
              </h4>
              <span className="text-[10px] text-[#6B7480] opacity-0 group-hover:opacity-100 transition-opacity">✕</span>
            </div>
            <p className="text-xs text-[#D1D5DB] mt-1 leading-snug whitespace-pre-line">{toast.message}</p>
          </div>
        );
      })}
    </div>
  );
};
