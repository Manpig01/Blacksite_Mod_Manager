import React from 'react';
import { Minus, Square, X, Sun, Moon } from 'lucide-react';

interface CustomTitleBarProps {
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  onClose?: () => void;
}

export const CustomTitleBar: React.FC<CustomTitleBarProps> = ({
  theme = 'dark',
  onToggleTheme,
  onMinimize,
  onMaximize,
  onClose,
}) => {
  return (
    <header className="h-[42px] bg-[#181B20] border-b border-[#23272E] px-3.5 flex items-center justify-between select-none shrink-0 z-50">
      {/* Left branding */}
      <div className="flex items-center gap-2.5">
        <img
          src="/emblem.png"
          alt="Blacksite Emblem"
          className="w-[22px] h-[22px] object-contain drop-shadow"
          onError={(e) => {
            (e.target as HTMLElement).style.display = 'none';
          }}
        />
        <span className="text-[13px] font-semibold text-[#E8EAEE] tracking-tight">
          Blacksite Mod Manager - ALPHA v1.8.0
        </span>
      </div>

      {/* Right window caption controls */}
      <div className="flex items-center h-full -mr-3">
        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            className="w-[38px] h-full flex items-center justify-center text-[#9AA3AF] hover:text-[#EA580C] hover:bg-[#20252D] transition-colors"
            title={`Switch to ${theme === 'light' ? 'Dark' : 'High-Contrast Light'} Theme`}
            type="button"
          >
            {theme === 'light' ? (
              <Moon className="w-3.5 h-3.5 text-[#EA580C]" />
            ) : (
              <Sun className="w-3.5 h-3.5 text-[#F97316]" />
            )}
          </button>
        )}

        <button
          onClick={onMinimize}
          className="w-[46px] h-full flex items-center justify-center text-[#9AA3AF] hover:text-[#E8EAEE] hover:bg-[#20252D] transition-colors"
          title="Minimize"
          type="button"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onMaximize}
          className="w-[46px] h-full flex items-center justify-center text-[#9AA3AF] hover:text-[#E8EAEE] hover:bg-[#20252D] transition-colors"
          title="Maximize / Restore"
          type="button"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={onClose}
          className="w-[46px] h-full flex items-center justify-center text-[#9AA3AF] hover:text-white hover:bg-[#DC2626] transition-colors"
          title="Close"
          type="button"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
