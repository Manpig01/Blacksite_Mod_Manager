import React, { useState, useEffect } from 'react';
import { Minus, Square, Copy, X, Sun, Moon } from 'lucide-react';
import { useAppEmblem } from '../hooks/useAppEmblem';
import { getDesktopBridge } from '../services/desktopBridgeService';

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
  const { emblemSrc, defaultEmblem, fallbackEmblem } = useAppEmblem();

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (bridge?.windowControl) {
      bridge.windowControl
        .isMaximized()
        .then((max) => {
          setIsMaximized(Boolean(max));
        })
        .catch(() => {});

      if (bridge.windowControl.onMaximizedChange) {
        const cleanup = bridge.windowControl.onMaximizedChange((max) => {
          setIsMaximized(Boolean(max));
        });
        return cleanup;
      }
    }
  }, []);

  const handleMinimize = () => {
    const bridge = getDesktopBridge();
    if (bridge?.windowControl?.minimize) {
      bridge.windowControl.minimize();
      return;
    }
    if (onMinimize) {
      onMinimize();
    }
  };

  const handleMaximize = async () => {
    const bridge = getDesktopBridge();
    if (bridge?.windowControl?.maximize) {
      const result = await bridge.windowControl.maximize();
      setIsMaximized(Boolean(result));
      return;
    }
    if (onMaximize) {
      onMaximize();
    }
  };

  const handleClose = () => {
    const bridge = getDesktopBridge();
    if (bridge?.windowControl?.close) {
      bridge.windowControl.close();
      return;
    }
    if (onClose) {
      onClose();
    } else if (typeof window !== 'undefined') {
      try {
        window.close();
      } catch (_) {}
    }
  };

  const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

  return (
    <header
      className="h-[38px] bg-[#181B20] border-b border-[#23272E] pl-3.5 pr-0 flex items-center justify-between select-none shrink-0 relative z-[9999] cursor-default"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      onDoubleClick={handleMaximize}
    >
      {/* Left branding */}
      <div className="flex items-center gap-2.5 pointer-events-none">
        <img
          src={emblemSrc}
          onError={(e) => {
            if (e.currentTarget.src !== defaultEmblem) {
              e.currentTarget.src = defaultEmblem;
            } else if (e.currentTarget.src !== fallbackEmblem) {
              e.currentTarget.src = fallbackEmblem;
            }
          }}
          alt="Blacksite Emblem"
          className="w-[22px] h-[22px] object-contain drop-shadow rounded-sm"
        />
        <span className="text-[12.5px] font-semibold text-[#E8EAEE] tracking-tight">
          Blacksite Mod Manager - v2.1.0
        </span>
      </div>

      {/* Right window caption controls */}
      <div
        className="flex items-center h-full shrink-0"
        style={noDragStyle}
      >
        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            style={noDragStyle}
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
          style={noDragStyle}
          className="w-[46px] h-full flex items-center justify-center text-[#9AA3AF] hover:text-[#E8EAEE] hover:bg-[#20252D] transition-colors cursor-pointer"
          title="Minimize"
          type="button"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleMaximize}
          style={noDragStyle}
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
          style={noDragStyle}
          className="w-[46px] h-full flex items-center justify-center text-[#9AA3AF] hover:text-white hover:bg-[#DC2626] transition-colors cursor-pointer"
          title="Close Blacksite Mod Manager"
          type="button"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
