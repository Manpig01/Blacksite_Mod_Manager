import React, { useState, useEffect } from 'react';
import { Mod, ResolvedDependencyItem } from '../types';
import {
  PackageCheck,
  AlertTriangle,
  CheckCircle2,
  Download,
  X,
  Layers,
  CheckSquare,
  Square,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';

interface DependencyInstallModalProps {
  isOpen: boolean;
  targetMod: Mod;
  targetVersion: string;
  targetDownloadUrl?: string;
  dependencies: ResolvedDependencyItem[];
  onConfirm: (selectedDeps: ResolvedDependencyItem[], installStandalone: boolean) => void;
  onClose: () => void;
}

export const DependencyInstallModal: React.FC<DependencyInstallModalProps> = ({
  isOpen,
  targetMod,
  targetVersion,
  targetDownloadUrl,
  dependencies,
  onConfirm,
  onClose,
}) => {
  const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (isOpen) {
      const initial: Record<string, boolean> = {};
      dependencies.forEach((d) => {
        // Pre-select dependencies that are not yet installed
        initial[d.guid] = !d.isInstalled;
      });
      setSelectedItems(initial);
    }
  }, [isOpen, dependencies]);

  if (!isOpen) return null;

  const toggleItem = (guid: string) => {
    setSelectedItems((prev) => ({
      ...prev,
      [guid]: !prev[guid],
    }));
  };

  const handleSelectAll = (select: boolean) => {
    const next: Record<string, boolean> = {};
    dependencies.forEach((d) => {
      next[d.guid] = select ? true : false;
    });
    setSelectedItems(next);
  };

  const missingDeps = dependencies.filter((d) => !d.isInstalled);
  const installedDeps = dependencies.filter((d) => d.isInstalled);
  const selectedCount = dependencies.filter((d) => selectedItems[d.guid]).length;
  const hasConflicts = dependencies.some((d) => d.conflict);

  const formatBytes = (bytes?: number | null) => {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#181B20] border border-[#2A2F38] rounded-xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[85vh] overflow-hidden text-[#E8EAEE]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#23272E] flex items-center justify-between bg-[#121418]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-[#EA580C]/15 border border-[#EA580C]/30 text-[#EA580C]">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#E8EAEE] tracking-tight">
                Dependency Resolver
              </h2>
              <p className="text-xs text-[#9AA3AF]">
                Review and select prerequisites required by this package
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-[#20252D] text-[#9AA3AF] hover:text-[#E8EAEE] transition-colors cursor-pointer"
            title="Cancel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {/* Target mod banner */}
          <div className="bg-[#0E1013] border border-[#2A2F38] rounded-lg p-3 flex items-center gap-3">
            {targetMod.thumbnail ? (
              <img
                src={targetMod.thumbnail}
                alt=""
                className="w-12 h-12 rounded object-cover border border-[#23272E] shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded bg-[#20252D] border border-[#23272E] flex items-center justify-center text-[#9AA3AF] font-mono text-sm shrink-0">
                SPT
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[#EA580C] uppercase tracking-wider">
                  Target Mod
                </span>
                <span className="text-[11px] font-mono text-[#4ADE80] bg-[#16A34A]/20 border border-[#16A34A]/40 px-1.5 py-0.2 rounded">
                  v{targetVersion}
                </span>
              </div>
              <h3 className="text-sm font-bold text-[#E8EAEE] truncate mt-0.5">
                {targetMod.name}
              </h3>
              <p className="text-xs text-[#9AA3AF]">
                by <span className="text-[#C2C9D6]">{targetMod.owner?.name || 'Community'}</span>
              </p>
            </div>
          </div>

          {/* Conflict warning banner if needed */}
          {hasConflicts && (
            <div className="bg-[#2A1015] border border-[#EF4444]/50 rounded-lg p-3 flex items-start gap-2.5 text-[#F87171]">
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-semibold text-white">Potential Dependency Conflict Detected</p>
                <p className="mt-0.5 text-[#FCA5A5]">
                  One or more items in the dependency tree report a compatibility conflict. Review carefully before installing.
                </p>
              </div>
            </div>
          )}

          {/* Dependencies header & actions */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#E8EAEE]">Required Dependencies</span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#20252D] border border-[#2A2F38] text-[#9AA3AF]">
                {dependencies.length} detected ({missingDeps.length} missing)
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => handleSelectAll(true)}
                className="text-[#EA580C] hover:text-[#F97316] font-medium transition-colors cursor-pointer"
              >
                Select All
              </button>
              <span className="text-[#3A404D]">|</span>
              <button
                type="button"
                onClick={() => handleSelectAll(false)}
                className="text-[#9AA3AF] hover:text-[#E8EAEE] transition-colors cursor-pointer"
              >
                Deselect All
              </button>
            </div>
          </div>

          {/* Dependency items list */}
          <div className="space-y-2">
            {dependencies.map((dep) => {
              const isChecked = !!selectedItems[dep.guid];
              const sizeLabel = formatBytes(dep.contentLength);

              return (
                <div
                  key={dep.guid}
                  onClick={() => toggleItem(dep.guid)}
                  className={`p-3 rounded-lg border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                    dep.conflict
                      ? 'bg-[#201214] border-[#EF4444]/40 hover:border-[#EF4444]'
                      : isChecked
                      ? 'bg-[#1C2027] border-[#EA580C]/60 shadow-[0_0_12px_rgba(234,88,12,0.1)]'
                      : 'bg-[#14171C] border-[#23272E] hover:border-[#2A2F38]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      className="text-[#EA580C] shrink-0 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleItem(dep.guid);
                      }}
                    >
                      {isChecked ? (
                        <CheckSquare className="w-4 h-4 text-[#EA580C]" />
                      ) : (
                        <Square className="w-4 h-4 text-[#4B5563]" />
                      )}
                    </button>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-[#E8EAEE] truncate">
                          {dep.name}
                        </span>
                        <span className="text-[11px] font-mono text-[#9AA3AF] bg-[#0E1013] px-1.5 py-0.5 rounded border border-[#23272E]">
                          v{dep.version}
                        </span>
                        {dep.conflict && (
                          <span className="text-[10px] bg-[#EF4444]/20 border border-[#EF4444]/50 text-[#EF4444] px-1.5 py-0.2 rounded font-semibold">
                            Conflict
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#6B7480] truncate mt-0.5 font-mono">
                        {dep.guid}
                      </p>
                    </div>
                  </div>

                  {/* Status badge on right */}
                  <div className="flex items-center gap-2 shrink-0">
                    {sizeLabel && (
                      <span className="text-[11px] text-[#9AA3AF] font-mono hidden sm:inline">
                        {sizeLabel}
                      </span>
                    )}
                    {dep.isInstalled ? (
                      <span className="text-[11px] bg-[#16A34A]/20 border border-[#16A34A]/40 text-[#4ADE80] font-semibold px-2 py-0.5 rounded flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-[#4ADE80]" />
                        Installed{dep.installedVersion ? ` (v${dep.installedVersion})` : ''}
                      </span>
                    ) : (
                      <span className="text-[11px] bg-[#EA580C]/15 border border-[#EA580C]/40 text-[#F97316] font-semibold px-2 py-0.5 rounded">
                        Missing
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-[#121418] border border-[#23272E] rounded-lg p-3 text-xs text-[#9AA3AF] space-y-1">
            <p className="flex items-center gap-1.5 text-[#C2C9D6] font-medium">
              <PackageCheck className="w-3.5 h-3.5 text-[#EA580C]" />
              Sequential Installation Guarantee
            </p>
            <p>
              Prerequisites are automatically staged and extracted in topological order into your SPT directory before the target mod is deployed.
            </p>
          </div>
        </div>

        {/* Footer controls */}
        <div className="px-5 py-3.5 border-t border-[#23272E] bg-[#121418] flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-semibold text-[#9AA3AF] hover:text-[#E8EAEE] hover:bg-[#20252D] rounded-lg transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onConfirm([], true)}
              className="px-3 py-2 text-xs font-semibold text-[#C2C9D6] hover:text-white bg-[#20252D] hover:bg-[#2A2F38] border border-[#2A2F38] rounded-lg transition-colors cursor-pointer"
              title="Skip downloading dependencies and install only the target mod"
            >
              Install Without Dependencies
            </button>

            <button
              type="button"
              onClick={() => {
                const selected = dependencies.filter((d) => selectedItems[d.guid]);
                onConfirm(selected, false);
              }}
              className="px-4 py-2 text-xs font-bold text-white bg-[#16A34A] hover:bg-[#22C55E] rounded-lg transition-colors shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>
                {selectedCount > 0
                  ? `Install with Selected (${selectedCount + 1} Mods)`
                  : 'Install Target Mod'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
