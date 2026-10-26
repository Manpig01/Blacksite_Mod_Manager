import React from 'react';
import {
  CheckSquare,
  CheckCircle,
  XCircle,
  Folder,
  Trash2,
  RefreshCw,
  ArrowUpCircle,
  Download,
  AlertCircle,
} from 'lucide-react';

interface InstalledModsStatsBarProps {
  totalInstalledCount: number;
  activeCount: number;
  disabledCount: number;
  updateCount: number;
  modsWithMissingDepsCount: number;
  filterMissingOnly: boolean;
  onToggleFilterMissing: () => void;
  isMultiSelectMode: boolean;
  selectedCount: number;
  onToggleMultiSelect: () => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
  onOpenFolder: (target: 'client' | 'server') => void;
  onUninstallAll: () => void;
  onCheckUpdates: () => void;
  onOpenBatchUpdate: () => void;
  onOpenExportModal: () => void;
}

export const InstalledModsStatsBar: React.FC<InstalledModsStatsBarProps> = React.memo(({
  totalInstalledCount,
  activeCount,
  disabledCount,
  updateCount,
  modsWithMissingDepsCount,
  filterMissingOnly,
  onToggleFilterMissing,
  isMultiSelectMode,
  selectedCount,
  onToggleMultiSelect,
  onEnableAll,
  onDisableAll,
  onOpenFolder,
  onUninstallAll,
  onCheckUpdates,
  onOpenBatchUpdate,
  onOpenExportModal,
}) => {
  return (
    <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-2.5 mb-2 flex items-center justify-between flex-wrap gap-2 text-[12.5px] shadow-sm">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Multi-Select Mode Toggle Button */}
        <button
          onClick={onToggleMultiSelect}
          className={`px-3 py-1.5 rounded-md border flex items-center gap-1.5 transition-colors cursor-pointer text-xs font-semibold ${
            isMultiSelectMode || selectedCount > 0
              ? 'bg-[#EA580C] text-white border-[#EA580C] shadow-sm'
              : 'bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] border-[#2A2F38]'
          }`}
          title="Toggle multi-select mode to enable, disable, or uninstall multiple mods at once"
          type="button"
        >
          <CheckSquare className="w-3.5 h-3.5" />
          <span>{isMultiSelectMode ? 'Exit Select Mode' : 'Multi-Select'}</span>
          {selectedCount > 0 && (
            <span className="bg-black/30 text-white font-mono px-1.5 py-0.2 rounded-full text-[10.5px]">
              {selectedCount}
            </span>
          )}
        </button>

        <div className="h-4 w-px bg-[#2A2F38] mx-0.5" />

        <button
          onClick={onEnableAll}
          className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] px-3 py-1.5 rounded-md border border-[#2A2F38] flex items-center gap-1.5 transition-colors cursor-pointer"
          title="Enable all installed mods"
          type="button"
        >
          <CheckCircle className="w-3.5 h-3.5 text-[#22C55E]" />
          <span>Enable All</span>
        </button>

        <button
          onClick={onDisableAll}
          className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] px-3 py-1.5 rounded-md border border-[#2A2F38] flex items-center gap-1.5 transition-colors cursor-pointer"
          title="Disable all installed mods"
          type="button"
        >
          <XCircle className="w-3.5 h-3.5 text-[#DC2626]" />
          <span>Disable All</span>
        </button>

        <div className="h-4 w-px bg-[#2A2F38] mx-0.5" />

        <button
          onClick={() => onOpenFolder('client')}
          className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] px-3 py-1.5 rounded-md border border-[#2A2F38] flex items-center gap-1.5 transition-colors cursor-pointer"
          title="Open client plugins folder (BepInEx/plugins)"
          type="button"
        >
          <Folder className="w-3.5 h-3.5 text-[#9AA3AF]" />
          <span>Plugins Folder</span>
        </button>

        <button
          onClick={() => onOpenFolder('server')}
          className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] px-3 py-1.5 rounded-md border border-[#2A2F38] flex items-center gap-1.5 transition-colors cursor-pointer"
          title="Open server mods folder (SPT_Runtime/user/mods)"
          type="button"
        >
          <Folder className="w-3.5 h-3.5 text-[#9AA3AF]" />
          <span>Server Folder</span>
        </button>

        <button
          onClick={onUninstallAll}
          className="bg-[#20252D] hover:bg-[#DC2626] text-[#9AA3AF] hover:text-white px-3 py-1.5 rounded-md border border-[#2A2F38] flex items-center gap-1.5 transition-colors cursor-pointer"
          title="Permanently remove all installed mods"
          type="button"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Uninstall All</span>
        </button>

        <button
          onClick={onCheckUpdates}
          className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] hover:text-[#EA580C] px-3.5 py-1.5 rounded-md border border-[#2A2F38] flex items-center gap-1.5 font-medium transition-colors cursor-pointer shadow-xs"
          title="Send installed package IDs + versions to sp-mod.com update check"
          type="button"
        >
          <RefreshCw className="w-3.5 h-3.5 text-[#EA580C]" />
          <span>Check for Updates</span>
        </button>

        {/* 1-Click Batch Mod Updater Button */}
        {updateCount > 0 && (
          <button
            onClick={onOpenBatchUpdate}
            className="bg-gradient-to-r from-[#EA580C] to-[#F97316] hover:brightness-110 text-white px-3.5 py-1.5 rounded-md flex items-center gap-1.5 font-semibold transition-all cursor-pointer shadow-md animate-pulse"
            title="1-Click Batch Mod Updater: Update all outdated mods at once"
            type="button"
          >
            <ArrowUpCircle className="w-4 h-4 text-white" />
            <span>Update All ({updateCount})</span>
          </button>
        )}

        {/* Export Installed Mods Manifest (JSON / CSV) */}
        <button
          onClick={onOpenExportModal}
          className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] hover:text-[#EA580C] px-3.5 py-1.5 rounded-md border border-[#2A2F38] hover:border-[#EA580C]/40 flex items-center gap-1.5 font-medium transition-colors cursor-pointer shadow-xs"
          title="Export installed mods list as JSON manifest or CSV spreadsheet"
          type="button"
        >
          <Download className="w-3.5 h-3.5 text-[#EA580C]" />
          <span>{selectedCount > 0 ? `Export (${selectedCount})` : 'Export List'}</span>
        </button>

        {/* Missing Dependencies Warning Button / Filter */}
        {modsWithMissingDepsCount > 0 && (
          <button
            onClick={onToggleFilterMissing}
            className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 font-semibold text-xs border transition-all cursor-pointer shadow-xs ${
              filterMissingOnly
                ? 'bg-[#DC2626] text-white border-[#DC2626] shadow-[0_0_10px_rgba(220,38,38,0.5)]'
                : 'bg-[#281013] text-[#EF4444] border-[#DC2626]/50 hover:bg-[#38161A]'
            }`}
            title="Click to toggle filtering mods with missing or disabled dependencies"
            type="button"
          >
            <AlertCircle className="w-3.5 h-3.5 text-[#EF4444] animate-pulse" />
            <span>{modsWithMissingDepsCount} Missing Dependencies</span>
          </button>
        )}
      </div>

      <div className="text-[12px] text-[#9AA3AF] font-medium ml-auto flex items-center gap-2">
        <span>
          {totalInstalledCount} installed ({activeCount} active, {disabledCount} disabled
          {updateCount > 0 && (
            <span className="text-[#EA580C] font-semibold ml-1.5">
              · {updateCount} update available
            </span>
          )}
          )
        </span>
      </div>
    </div>
  );
});

InstalledModsStatsBar.displayName = 'InstalledModsStatsBar';
