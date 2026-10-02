import React from 'react';
import { QueueItem } from '../types';

interface StatusBarProps {
  statusText: string;
  queue: QueueItem[];
  onOpenQueue: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  statusText,
  queue,
  onOpenQueue,
}) => {
  const activeItems = queue.filter(
    (i) => i.status === 'downloading' || i.status === 'extracting' || i.status === 'routing'
  );
  const activeItem = activeItems[0];
  const activeCount = activeItems.length;

  return (
    <footer className="h-9 bg-[#181B20] border-t border-[#23272E] px-3.5 flex items-center justify-between text-xs select-none shrink-0 z-40">
      {/* Left: Branding + Status */}
      <div className="flex items-center gap-4 min-w-0">
        <span className="text-[#9AA3AF] font-medium shrink-0">Blacksite Mod Manager</span>
        <span className="text-[#E8EAEE] truncate max-w-md" title={statusText}>
          {statusText}
        </span>
      </div>

      {/* Center: Installation Queue button */}
      <button
        onClick={onOpenQueue}
        className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] px-4 py-1 rounded-md flex items-center gap-2 transition-colors cursor-pointer border border-[#2A2F38]"
        title="Open / close the Installation Queue — live downloads, extraction and results"
        type="button"
      >
        <span className="font-semibold text-xs">Installation Queue</span>
        {activeCount > 0 ? (
          <span className="bg-[#EA580C] text-white text-[10.5px] font-bold px-1.5 py-0.2 rounded-full animate-pulse">
            {activeCount}
          </span>
        ) : queue.length > 0 ? (
          <span className="bg-[#121418] text-[#9AA3AF] text-[10px] px-1.5 py-0.2 rounded-full">
            {queue.length}
          </span>
        ) : null}
      </button>

      {/* Right: Transfer speed + Progress bar */}
      <div className="flex items-center gap-3 shrink-0">
        {activeItem && (
          <span className="font-mono text-[#F97316] text-[11.5px]">
            {activeItem.downloadSpeed || 'Active'}
          </span>
        )}

        <div className="w-48 bg-[#0E1013] border border-[#23272E] h-2.5 rounded-full overflow-hidden">
          {activeItem ? (
            <div
              className="bg-[#EA580C] h-full transition-all duration-300 rounded-full"
              style={{ width: `${activeItem.progressPercent}%` }}
            />
          ) : (
            <div className="bg-[#16A34A] h-full w-full opacity-30" />
          )}
        </div>
      </div>
    </footer>
  );
};
