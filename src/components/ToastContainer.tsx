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

        if (toast.type === 'error') {
          titleColor = 'text-[#DC2626]';
          borderColor = 'border-[#DC2626]/40';
        } else if (toast.type === 'warning') {
          titleColor = 'text-[#F59E0B]';
          borderColor = 'border-[#F59E0B]/40';
        } else if (toast.type === 'info') {
          titleColor = 'text-[#38BDF8]';
          borderColor = 'border-[#38BDF8]/40';
        }

        return (
          <div
            key={toast.id}
            onClick={() => onDismiss(toast.id)}
            className={`pointer-events-auto bg-[#181B20] border ${borderColor} rounded-xl p-3.5 shadow-2xl animate-toast cursor-pointer transition-transform hover:scale-[1.02]`}
          >
            <h4 className={`text-xs font-bold ${titleColor}`}>{toast.title}</h4>
            <p className="text-xs text-[#E8EAEE] mt-1 leading-snug">{toast.message}</p>
          </div>
        );
      })}
    </div>
  );
};
