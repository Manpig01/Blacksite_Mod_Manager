import React from 'react';
import { AlertTriangle, FolderOpen, Folder, RotateCcw, X, ExternalLink } from 'lucide-react';

export interface ManualExtractInfo {
  modName: string;
  version: string;
  archivePath?: string | null;
  format?: string | null;
  errorMessage: string;
  sourceMod?: any;
}

interface ManualExtractModalProps {
  isOpen: boolean;
  onClose: () => void;
  info: ManualExtractInfo | null;
  sptDirectory: string;
  onRetry?: () => void;
}

export const ManualExtractModal: React.FC<ManualExtractModalProps> = ({
  isOpen,
  onClose,
  info,
  sptDirectory,
  onRetry,
}) => {
  if (!isOpen || !info) return null;

  const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;

  const handleOpenArchiveLocation = () => {
    if (!bridge) return;
    if (info.archivePath && bridge.showItemInFolder) {
      bridge.showItemInFolder(info.archivePath);
    } else if (info.archivePath && bridge.openFolder) {
      bridge.openFolder(info.archivePath);
    } else if (bridge.openFolder) {
      bridge.openFolder(sptDirectory);
    }
  };

  const handleOpenSptFolder = () => {
    if (bridge?.openFolder) {
      bridge.openFolder(sptDirectory);
    }
  };

  const formatBadge = (info.format || '7Z / RAR / ZIP').toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-zinc-900 border border-amber-500/40 rounded-lg shadow-2xl overflow-hidden text-zinc-100">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 bg-zinc-950/80 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-mono font-bold tracking-wider text-sm uppercase text-amber-400">
                Decompression Recovery
              </h3>
              <p className="text-xs text-zinc-400">
                Manual Archive Extraction Available
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 p-1.5 rounded transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 text-sm">
          {/* Mod Info Header */}
          <div className="p-4 bg-zinc-950/60 rounded border border-zinc-800 flex items-start justify-between gap-4">
            <div>
              <div className="font-semibold text-zinc-100 text-base">{info.modName}</div>
              <div className="text-xs text-zinc-400 mt-0.5">Version: v{info.version}</div>
            </div>
            <div className="px-2.5 py-1 text-[11px] font-mono font-bold uppercase rounded bg-amber-950/40 text-amber-300 border border-amber-500/30">
              {formatBadge} ARCHIVE
            </div>
          </div>

          {/* Issue Explanation */}
          <div className="space-y-2 text-zinc-300">
            <p>
              Blacksite downloaded the full archive payload, but the decompression engine could not unpack it automatically.
              This typically occurs with password-protected or custom-compressed archive volumes.
            </p>
            <div className="p-3 bg-red-950/20 border border-red-500/20 rounded font-mono text-xs text-red-300 break-words">
              {info.errorMessage}
            </div>
          </div>

          {/* Archive Path Saved Notice */}
          {info.archivePath && (
            <div className="p-3 bg-zinc-950/80 rounded border border-zinc-800 space-y-1">
              <div className="text-xs font-mono text-zinc-400 uppercase tracking-wide">
                Preserved Archive Location:
              </div>
              <div className="text-xs font-mono text-emerald-400 break-all select-all">
                {info.archivePath}
              </div>
            </div>
          )}

          {/* Step by Step Manual Instructions */}
          <div className="p-3 bg-zinc-950/40 rounded border border-zinc-800/80 space-y-1.5 text-xs text-zinc-400">
            <div className="font-semibold text-zinc-300">To manually complete installation:</div>
            <ol className="list-decimal list-inside space-y-1 pl-1 text-zinc-400">
              <li>Open the archive location using the button below.</li>
              <li>Extract its contents with 7-Zip, WinRAR, or Windows Explorer.</li>
              <li>Move <span className="font-mono text-zinc-200">BepInEx/plugins</span> into your SPT folder (or <span className="font-mono text-zinc-200">user/mods</span> for server mods).</li>
            </ol>
          </div>
        </div>

        {/* Action Buttons Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-zinc-950/80 border-t border-zinc-800">
          <div className="flex items-center gap-2">
            {onRetry && (
              <button
                onClick={() => {
                  onClose();
                  onRetry();
                }}
                className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Retry Download
              </button>
            )}
            <button
              onClick={handleOpenSptFolder}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
            >
              <Folder className="w-4 h-4" />
              Open SPT Folder
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenArchiveLocation}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-black bg-amber-400 hover:bg-amber-300 rounded transition-colors shadow-lg shadow-amber-400/10"
            >
              <FolderOpen className="w-4 h-4" />
              Open Download Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
