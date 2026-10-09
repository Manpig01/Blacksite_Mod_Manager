import React, { useState, useEffect } from 'react';
import { X, ArrowUpCircle, Check, Loader2, ShieldCheck, RefreshCw, AlertCircle, ArrowRight } from 'lucide-react';
import { InstalledMod } from '../types';

interface BatchModUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  modsToUpdate: InstalledMod[];
  onExecuteUpdateMod: (mod: InstalledMod) => Promise<boolean | void>;
  onShowToast: (title: string, message: string, type: 'success' | 'info' | 'warning' | 'error') => void;
  sptVersion?: string;
}

type ModUpdateStatus = 'idle' | 'updating' | 'completed' | 'failed';

export const BatchModUpdateModal: React.FC<BatchModUpdateModalProps> = ({
  isOpen,
  onClose,
  modsToUpdate,
  onExecuteUpdateMod,
  onShowToast,
  sptVersion = '4.1.6',
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, ModUpdateStatus>>({});
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [completedCount, setCompletedCount] = useState(0);

  // Initialize selected IDs whenever modal opens or modsToUpdate changes
  useEffect(() => {
    if (isOpen) {
      setSelectedIds(new Set(modsToUpdate.map((m) => m.id)));
      setStatuses({});
      setIsProcessing(false);
      setCurrentIndex(-1);
      setCompletedCount(0);
    }
  }, [isOpen, modsToUpdate]);

  if (!isOpen) return null;

  const targetMods = modsToUpdate.filter((m) => selectedIds.has(m.id));

  const toggleSelect = (id: string) => {
    if (isProcessing) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (isProcessing) return;
    if (selectedIds.size === modsToUpdate.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(modsToUpdate.map((m) => m.id)));
    }
  };

  const handleStartBatch = async () => {
    if (targetMods.length === 0 || isProcessing) return;

    setIsProcessing(true);
    let successful = 0;

    for (let i = 0; i < targetMods.length; i++) {
      const mod = targetMods[i];
      setCurrentIndex(i);
      setStatuses((prev) => ({ ...prev, [mod.id]: 'updating' }));

      try {
        await onExecuteUpdateMod(mod);
        setStatuses((prev) => ({ ...prev, [mod.id]: 'completed' }));
        successful++;
        setCompletedCount(successful);
      } catch (err) {
        console.error(`Failed batch updating ${mod.name}:`, err);
        setStatuses((prev) => ({ ...prev, [mod.id]: 'failed' }));
      }

      // Small breather to allow React render / disk buffer flush
      await new Promise((r) => setTimeout(r, 450));
    }

    setIsProcessing(false);
    setCurrentIndex(-1);

    if (successful > 0) {
      onShowToast(
        'Batch Update Complete',
        `Successfully updated ${successful} of ${targetMods.length} mod${successful > 1 ? 's' : ''} to latest releases.`,
        'success'
      );
    } else {
      onShowToast('Batch Update Encountered Issues', 'None of the queued mods could be updated.', 'error');
    }
  };

  const isAllDone = completedCount === targetMods.length && targetMods.length > 0 && !isProcessing;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-fade-in">
      <div className="bg-[#181B20] border border-[#2A2F38] rounded-xl shadow-2xl max-w-2xl w-full flex flex-col overflow-hidden max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-[#2A2F38] flex items-center justify-between bg-[#14161A]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#EA580C]/15 border border-[#EA580C]/30 flex items-center justify-center">
              <ArrowUpCircle className="w-5 h-5 text-[#EA580C]" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#E8EAEE] flex items-center gap-2">
                <span>1-Click Batch Mod Updater</span>
                <span className="text-[11px] font-normal text-[#9AA3AF] bg-[#20252D] px-2 py-0.5 rounded-sm border border-[#2A2F38]">
                  Target SPT {sptVersion}
                </span>
              </h2>
              <p className="text-xs text-[#9AA3AF]">
                Automatically download and install the latest compatible version for outdated mods.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="text-[#9AA3AF] hover:text-white p-1 rounded-md hover:bg-[#20252D] transition-colors disabled:opacity-40 cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Config Safety Callout */}
        <div className="px-4 py-2.5 bg-[#1F242C] border-b border-[#2A2F38] flex items-center gap-2 text-xs text-[#9AA3AF]">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>
            <strong className="text-emerald-400 font-semibold">Config-Safe Update:</strong> All your custom mod settings and JSON/CFG configurations are preserved during installation.
          </span>
        </div>

        {/* Progress Bar (Visible while processing or done) */}
        {(isProcessing || completedCount > 0) && (
          <div className="px-4 py-2.5 bg-[#14171C] border-b border-[#2A2F38]">
            <div className="flex items-center justify-between text-xs mb-1.5 font-medium">
              <span className="text-[#E8EAEE]">
                {isProcessing
                  ? `Updating mod ${currentIndex + 1} of ${targetMods.length}...`
                  : `Batch update finished (${completedCount}/${targetMods.length} successful)`}
              </span>
              <span className="text-[#EA580C] font-mono">
                {Math.round(((completedCount) / (targetMods.length || 1)) * 100)}%
              </span>
            </div>
            <div className="w-full h-1.5 bg-[#20252D] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#EA580C] to-[#F97316] transition-all duration-300"
                style={{
                  width: `${Math.round((completedCount / (targetMods.length || 1)) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Mod List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {modsToUpdate.length === 0 ? (
            <div className="text-center py-10 text-xs text-[#9AA3AF]">
              <Check className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="font-semibold text-[#E8EAEE]">All installed mods are up to date!</p>
              <p className="mt-1">No pending updates found for your current SPT version.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between pb-1 text-xs text-[#9AA3AF]">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  disabled={isProcessing}
                  className="hover:text-white transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.size === modsToUpdate.length}
                    onChange={toggleSelectAll}
                    disabled={isProcessing}
                    className="accent-[#EA580C] rounded-sm cursor-pointer"
                  />
                  <span>Select All ({modsToUpdate.length})</span>
                </button>
                <span>{selectedIds.size} queued</span>
              </div>

              {modsToUpdate.map((mod) => {
                const isSelected = selectedIds.has(mod.id);
                const status = statuses[mod.id] || 'idle';

                return (
                  <div
                    key={mod.id}
                    onClick={() => !isProcessing && toggleSelect(mod.id)}
                    className={`p-3 rounded-lg border transition-all flex items-center justify-between gap-3 text-xs cursor-pointer ${
                      isSelected
                        ? 'bg-[#1C2027] border-[#38404D]'
                        : 'bg-[#14161A] border-[#22272E] opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(mod.id)}
                        disabled={isProcessing}
                        className="accent-[#EA580C] rounded-sm cursor-pointer"
                        onClick={(e) => e.stopPropagation()}
                      />

                      {mod.thumbnail ? (
                        <img
                          src={mod.thumbnail}
                          alt={mod.name}
                          className="w-9 h-9 rounded object-cover bg-[#20252D] shrink-0"
                          onError={(e) => ((e.target as HTMLElement).style.display = 'none')}
                        />
                      ) : (
                        <div className="w-9 h-9 rounded bg-[#20252D] border border-[#2A2F38] flex items-center justify-center shrink-0 text-[#9AA3AF] font-bold text-xs">
                          {mod.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}

                      <div className="min-w-0">
                        <div className="font-semibold text-[#E8EAEE] truncate">{mod.name}</div>
                        <div className="text-[11px] text-[#9AA3AF] flex items-center gap-1.5 mt-0.5">
                          <span>{mod.author || 'Community Author'}</span>
                          <span>·</span>
                          <span className="text-[#9AA3AF]">{mod.kind}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-1.5 font-mono text-[11px]">
                        <span className="text-[#9AA3AF] bg-[#14161A] px-2 py-0.5 rounded border border-[#2A2F38]">
                          v{mod.version}
                        </span>
                        <ArrowRight className="w-3 h-3 text-[#EA580C]" />
                        <span className="text-white font-bold bg-[#EA580C]/20 border border-[#EA580C]/40 px-2 py-0.5 rounded text-[#EA580C]">
                          v{mod.latestVersion || 'Latest'}
                        </span>
                      </div>

                      {/* Status indicator */}
                      <div className="w-20 flex justify-end">
                        {status === 'idle' && (
                          <span className="text-[11px] text-[#9AA3AF]">Ready</span>
                        )}
                        {status === 'updating' && (
                          <span className="text-[11px] text-[#EA580C] flex items-center gap-1 font-medium">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Updating...
                          </span>
                        )}
                        {status === 'completed' && (
                          <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-medium">
                            <Check className="w-3.5 h-3.5" />
                            Updated
                          </span>
                        )}
                        {status === 'failed' && (
                          <span className="text-[11px] text-[#EF4444] flex items-center gap-1 font-medium">
                            <AlertCircle className="w-3.5 h-3.5" />
                            Failed
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#2A2F38] bg-[#14161A] flex items-center justify-between">
          <div className="text-xs text-[#9AA3AF]">
            {targetMods.length > 0 && (
              <span>
                Ready to update <strong className="text-white">{targetMods.length}</strong> mod{targetMods.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isProcessing}
              className="px-4 py-1.5 rounded-md text-xs font-medium text-[#9AA3AF] hover:text-white hover:bg-[#20252D] transition-colors disabled:opacity-40 cursor-pointer"
            >
              {isAllDone ? 'Close' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={handleStartBatch}
              disabled={isProcessing || targetMods.length === 0}
              className="bg-[#EA580C] hover:bg-[#F97316] text-white px-4 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer shadow-sm"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Updating ({currentIndex + 1}/{targetMods.length})...</span>
                </>
              ) : isAllDone ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Update Again</span>
                </>
              ) : (
                <>
                  <ArrowUpCircle className="w-3.5 h-3.5" />
                  <span>Update All ({targetMods.length})</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
