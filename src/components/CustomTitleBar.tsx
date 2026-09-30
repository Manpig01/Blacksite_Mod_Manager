import React, { useState, useEffect } from 'react';
import { Minus, Square, Copy, X, Sun, Moon } from 'lucide-react';

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
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
    if (bridge?.windowControl) {
      bridge.windowControl.isMaximized().then((max: boolean) => {
        setIsMaximized(Boolean(max));
      }).catch(() => {});

      if (bridge.windowControl.onMaximizedChange) {
        const cleanup = bridge.windowControl.onMaximizedChange((max: boolean) => {
          setIsMaximized(Boolean(max));
        });
        return cleanup;
      }
    }
  }, []);

  const handleMinimize = () => {
    if (onMinimize) {
      onMinimize();
    } else {
      const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
      bridge?.windowControl?.minimize();
    }
  };

  const handleMaximize = async () => {
    if (onMaximize) {
      onMaximize();
    } else {
      const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
      if (bridge?.windowControl?.maximize) {
        const result = await bridge.windowControl.maximize();
        setIsMaximized(Boolean(result));
      }
    }
  };

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
      bridge?.windowControl?.close();
    }
  };

  return (
    <header
      className="h-[38px] bg-[#181B20] border-b border-[#23272E] px-3.5 flex items-center justify-between select-none shrink-0 z-50 cursor-default"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      onDoubleClick={handleMaximize}
    >
      {/* Left branding */}
      <div className="flex items-center gap-2.5 pointer-events-none">
        <img
          src="/emblem.png"
          alt="Blacksite Emblem"
          className="w-[20px] h-[20px] object-contain drop-shadow"
          onError={(e) => {
            (e.target as HTMLElement).style.display = 'none';
          }}
        />
        <span className="text-[12.5px] font-semibold text-[#E8EAEE] tracking-tight">
          Blacksite Mod Manager - ALPHA v1.8.0
        </span>
      </div>

      {/* Right window caption controls */}
      <div
        className="flex items-center h-full -mr-3"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            className="w-[38px] h-full flex items-center justify-center text-[#9AA3AF] hover:text-[#EA580C] hover:bg-[#20252D] transition-colors cursor-pointer"
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
          onClick={handleMinimize}
          className="w-[46px] h-full flex items-center justify-center text-[#9AA3AF] hover:text-[#E8EAEE] hover:bg-[#20252D] transition-colors cursor-pointer"
          title="Minimize"
          type="button"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleMaximize}
          className="w-[46px] h-full flex items-center justify-center text-[#9AA3AF] hover:text-[#E8EAEE] hover:bg-[#20252D] transition-colors cursor-pointer"
          title={isMaximized ? 'Restore' : 'Maximize'}
          type="button"
        >
          {isMaximized ? (
            <Copy className="w-3 h-3 rotate-180" />
          ) : (
            <Square className="w-3 h-3" />
          )}
        </button>
        <button
          onClick={handleClose}
          className="w-[46px] h-full flex items-center justify-center text-[#9AA3AF] hover:text-white hover:bg-[#DC2626] transition-colors cursor-pointer"
          title="Close"
          type="button"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
