import React from 'react';
import { X, Play, Pause, RotateCw, Trash2, CheckCircle, AlertCircle, ArrowDown } from 'lucide-react';
import { QueueItem } from '../types';

interface InstallQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  queue: QueueItem[];
  onPauseItem: (id: string) => void;
  onResumeItem: (id: string) => void;
  onCancelItem: (id: string) => void;
  onRetryItem: (id: string) => void;
  onClearCompleted: () => void;
}

export const InstallQueueModal: React.FC<InstallQueueModalProps> = ({
  isOpen,
  onClose,
  queue,
  onPauseItem,
  onResumeItem,
  onCancelItem,
  onRetryItem,
  onClearCompleted,
}) => {
  if (!isOpen) return null;

  const activeCount = queue.filter((i) => i.status === 'downloading' || i.status === 'extracting' || i.status === 'routing').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-[#181B20] border border-[#2A2F38] rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl animate-fade-in overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#23272E] flex items-center justify-between select-none">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-bold text-[#E8EAEE]">Installation Queue</h2>
            {activeCount > 0 ? (
              <span className="bg-[#EA580C] text-white text-[11px] font-bold px-2 py-0.5 rounded-full">
                {activeCount} Active
              </span>
            ) : (
              <span className="bg-[#20252D] text-[#9AA3AF] text-[11px] px-2 py-0.5 rounded-full">
                {queue.length} Total
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClearCompleted}
              className="text-xs text-[#9AA3AF] hover:text-[#E8EAEE] hover:bg-[#20252D] px-2.5 py-1 rounded transition-colors cursor-pointer"
              title="Clear completed or failed installations from list"
              type="button"
            >
              Clear Completed
            </button>
            <button
              onClick={onClose}
              className="text-[#9AA3AF] hover:text-white p-1 hover:bg-[#20252D] rounded transition-colors cursor-pointer"
              type="button"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content list */}
        <div className="p-4 flex-1 overflow-y-auto space-y-3">
          {queue.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-[#9AA3AF]">
              <ArrowDown className="w-8 h-8 opacity-40 mb-2" />
              <p className="text-sm font-medium text-[#E8EAEE]">Installation queue is empty</p>
              <p className="text-xs text-[#6B7480]">Choose mods from the catalog to install or drop an archive.</p>
            </div>
          ) : (
            queue.map((item) => {
              const isDone = item.status === 'installed';
              const isFailed = item.status === 'failed';
              const isPaused = item.status === 'paused';
              const isExtracting = item.status === 'extracting';
              const isRouting = item.status === 'routing';

              return (
                <div
                  key={item.id}
                  className="bg-[#121418] border border-[#23272E] rounded-lg p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {item.thumbnail ? (
                        <img
                          src={item.thumbnail}
                          alt=""
                          className="w-9 h-9 rounded object-cover border border-[#23272E] shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded bg-[#20252D] flex items-center justify-center text-sm font-bold text-[#6B7480] shrink-0">
                          {item.modName.charAt(0)}
                        </div>
                      )}

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-[#E8EAEE] truncate">
                            {item.modName}
                          </span>
                          <span className="text-xs text-[#9AA3AF]">v{item.version}</span>
                        </div>
                        <span className="text-[11px] text-[#6B7480] truncate block">
                          by {item.author}
                        </span>
                      </div>
                    </div>

                    {/* Status badge & controls */}
                    <div className="flex items-center gap-2 shrink-0">
                      {isDone && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#16A34A] bg-[#0E2A18] px-2 py-0.5 rounded border border-[#16A34A]/40">
                          <CheckCircle className="w-3 h-3" /> Installed
                        </span>
                      )}
                      {isFailed && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#DC2626] bg-[#2A0E0E] px-2 py-0.5 rounded border border-[#DC2626]/40">
                          <AlertCircle className="w-3 h-3" /> Failed
                        </span>
                      )}
                      {isPaused && (
                        <span className="text-[11px] font-medium text-[#F59E0B] bg-[#3A2A10] px-2 py-0.5 rounded border border-[#F59E0B]/30">
                          Paused
                        </span>
                      )}
                      {isExtracting && (
                        <span className="text-[11px] font-medium text-[#EA580C] bg-[#3A2415] px-2 py-0.5 rounded border border-[#EA580C]/40 animate-pulse">
                          Extracting (7za-first)...
                        </span>
                      )}
                      {isRouting && (
                        <span className="text-[11px] font-medium text-[#22C55E] bg-[#0E2A18] px-2 py-0.5 rounded border border-[#16A34A]/40 animate-pulse">
                          Placing into SPT...
                        </span>
                      )}
                      {item.status === 'downloading' && (
                        <span className="text-[11px] font-mono text-[#F97316]">
                          {item.downloadSpeed}
                        </span>
                      )}

                      {/* Control buttons */}
                      {item.status === 'downloading' && (
                        <button
                          onClick={() => onPauseItem(item.id)}
                          className="p-1 hover:bg-[#20252D] rounded text-[#9AA3AF] hover:text-white"
                          title="Pause download"
                          type="button"
                        >
                          <Pause className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {isPaused && (
                        <button
                          onClick={() => onResumeItem(item.id)}
                          className="p-1 hover:bg-[#20252D] rounded text-[#9AA3AF] hover:text-white"
                          title="Resume download"
                          type="button"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {isFailed && (
                        <button
                          onClick={() => onRetryItem(item.id)}
                          className="p-1 hover:bg-[#20252D] rounded text-[#9AA3AF] hover:text-white"
                          title="Retry install"
                          type="button"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {!isDone && (
                        <button
                          onClick={() => onCancelItem(item.id)}
                          className="p-1 hover:bg-[#20252D] rounded text-[#9AA3AF] hover:text-[#DC2626]"
                          title="Cancel"
                          type="button"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  {!isDone && (
                    <div className="space-y-1">
                      <div className="w-full bg-[#20252D] h-2 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 rounded-full ${
                            isFailed
                              ? 'bg-[#DC2626]'
                              : isDone
                              ? 'bg-[#16A34A]'
                              : 'bg-[#EA580C]'
                          }`}
                          style={{ width: `${item.progressPercent}%` }}
                        />
                      </div>

                      <div className="flex justify-between text-[11px] text-[#6B7480] font-mono">
                        <span>
                          {item.bytesReceived > 0
                            ? `${(item.bytesReceived / (1024 * 1024)).toFixed(1)} MB / ${(item.totalBytes / (1024 * 1024)).toFixed(1)} MB`
                            : item.status}
                        </span>
                        <span>{item.progressPercent}%</span>
                      </div>
                    </div>
                  )}

                  {item.errorMessage && (
                    <p className="text-xs text-[#DC2626] font-mono bg-[#2A0E0E]/40 p-1.5 rounded">
                      {item.errorMessage}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
