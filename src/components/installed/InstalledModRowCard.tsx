import React from 'react';
import {
  Check,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Layers,
  AlertCircle,
  Plus,
  ArrowUpCircle,
  RefreshCw,
  Tag,
  Sliders,
  Folder,
  Trash2,
} from 'lucide-react';
import { InstalledMod, FileCollision } from '../../types';
import { InstalledModThumbnail } from '../InstalledModThumbnail';
import { HighlightText } from '../HighlightText';

export interface ModDependencyStatus {
  hasMissing: boolean;
  missingUninstalled: string[];
  missingDisabled: { id: string; name: string }[];
  allMissing: string[];
}

interface InstalledModRowCardProps {
  mod: InstalledMod;
  collision?: FileCollision;
  depStatus: ModDependencyStatus;
  searchText: string;
  isMultiSelectMode: boolean;
  isSelected: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onToggleSelect: (modId: string, enableMultiSelect?: boolean) => void;
  onDragStart: (modId: string, e: React.DragEvent) => void;
  onDragOver: (modId: string, e: React.DragEvent) => void;
  onDragLeave: (modId: string) => void;
  onDrop: (modId: string, e: React.DragEvent) => void;
  onDragEnd: () => void;
  onMoveStep: (modId: string, direction: 'up' | 'down') => void;
  onNavigateConflicts: () => void;
  onToggleMod: (modId: string) => void;
  onUpdateMod: (mod: InstalledMod) => void;
  onEditConfigs: (mod: InstalledMod) => void;
  onOpenTagModal: (mod: InstalledMod) => void;
  onFilterByTag: (tagName: string) => void;
  onOpenFolder: (target: 'client' | 'server' | string | string[]) => void;
  onUninstallMod: (modId: string) => void;
}

const getModFolderPaths = (mod: InstalledMod): string[] => {
  const paths: string[] = [];

  if (mod.serverPath || mod.clientPath) {
    if (mod.serverPath) {
      paths.push(mod.serverPath);
    }
    if (mod.clientPath) {
      const cleanDir = /\.[a-zA-Z0-9]+$/.test(mod.clientPath)
        ? mod.clientPath.replace(/[\\/][^\\/]+$/, '')
        : mod.clientPath;
      paths.push(cleanDir || mod.clientPath);
    }
    return Array.from(new Set(paths));
  }

  if (mod.kind === 'Server' || mod.kind === 'Both') {
    paths.push('SPT_Runtime/user/mods');
  }
  if (mod.kind === 'Client' || mod.kind === 'Both') {
    paths.push('BepInEx/plugins');
  }

  return Array.from(new Set(paths));
};

const getTagBadgeStyle = (color: string) => {
  switch (color) {
    case 'emerald':
      return 'bg-[#0E2A18] text-[#22C55E] border-[#16A34A]/50';
    case 'amber':
      return 'bg-[#3A2A10] text-[#F59E0B] border-[#F59E0B]/50';
    case 'crimson':
      return 'bg-[#2A1015] text-[#EF4444] border-[#EF4444]/50';
    case 'purple':
      return 'bg-[#22102A] text-[#C084FC] border-[#A855F7]/50';
    case 'cyan':
      return 'bg-[#0D2428] text-[#22D3EE] border-[#06B6D4]/50';
    case 'indigo':
      return 'bg-[#181A38] text-[#818CF8] border-[#6366F1]/50';
    case 'pink':
      return 'bg-[#2B1020] text-[#F472B6] border-[#EC4899]/50';
    case 'lime':
      return 'bg-[#1D2B0D] text-[#A3E635] border-[#84CC16]/50';
    case 'slate':
      return 'bg-[#1E232B] text-[#94A3B8] border-[#475569]/50';
    case 'orange':
    default:
      return 'bg-[#3A2415] text-[#F97316] border-[#EA580C]/50';
  }
};

export const InstalledModRowCard: React.FC<InstalledModRowCardProps> = React.memo(({
  mod,
  collision,
  depStatus,
  searchText,
  isMultiSelectMode,
  isSelected,
  isDragging,
  isDragOver,
  onToggleSelect,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onMoveStep,
  onNavigateConflicts,
  onToggleMod,
  onUpdateMod,
  onEditConfigs,
  onOpenTagModal,
  onFilterByTag,
  onOpenFolder,
  onUninstallMod,
}) => {
  const hasMissingDeps = depStatus.hasMissing;
  const paths = getModFolderPaths(mod);
  const hasBothFolders = paths.length > 1;

  return (
    <div
      draggable={!mod.isDisabled && !isMultiSelectMode}
      onDragStart={(e) => onDragStart(mod.id, e)}
      onDragOver={(e) => onDragOver(mod.id, e)}
      onDragLeave={() => onDragLeave(mod.id)}
      onDrop={(e) => onDrop(mod.id, e)}
      onDragEnd={onDragEnd}
      onClick={() => {
        if (isMultiSelectMode) {
          onToggleSelect(mod.id);
        }
      }}
      className={`min-h-[245px] rounded-lg p-2.5 transition-all flex gap-2 relative border ${
        isSelected
          ? 'ring-2 ring-[#EA580C] bg-[#EA580C]/10 border-[#EA580C] shadow-lg'
          : isDragging
          ? 'opacity-40 border-dashed border-[#EA580C] scale-[0.98]'
          : isDragOver
          ? 'ring-2 ring-[#EA580C] bg-[#EA580C]/10 border-[#EA580C] shadow-lg scale-[1.01]'
          : hasMissingDeps
          ? 'bg-[#1C0D0F] border-2 border-[#DC2626] shadow-[0_0_16px_rgba(220,38,38,0.28)] ring-1 ring-[#DC2626]/50'
          : mod.isDisabled
          ? 'bg-[#14161A] border-[#20252D] opacity-75'
          : 'bg-[#181B20] border-[#23272E] hover:border-[#EA580C]'
      }`}
    >
      {/* Multi-Select Checkbox Overlay */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect(mod.id, true);
        }}
        className={`absolute top-2 right-2 z-20 cursor-pointer p-0.5 rounded transition-transform ${
          isMultiSelectMode || isSelected
            ? 'opacity-100 scale-100'
            : 'opacity-0 hover:opacity-100 scale-95 hover:scale-100'
        }`}
        title={isSelected ? 'Deselect mod' : 'Select mod for bulk actions'}
      >
        <div
          className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
            isSelected
              ? 'bg-[#EA580C] border-[#EA580C] text-white shadow-md ring-2 ring-[#EA580C]/40'
              : 'bg-[#0E1013]/90 border-[#3A4150] hover:border-[#EA580C] text-transparent'
          }`}
        >
          <Check className={`w-3.5 h-3.5 ${isSelected ? 'opacity-100 stroke-[3]' : 'opacity-0'}`} />
        </div>
      </div>

      {/* Far-Left Drag Handle & Step Controls */}
      <div
        className={`w-6 flex flex-col items-center justify-between py-1 px-0.5 rounded shrink-0 select-none ${
          mod.isDisabled || isMultiSelectMode
            ? 'opacity-25 cursor-not-allowed'
            : 'cursor-grab active:cursor-grabbing hover:bg-[#20252D] text-[#9AA3AF] hover:text-[#EA580C]'
        }`}
        title={
          isMultiSelectMode
            ? 'Drag reorder is disabled in multi-select mode'
            : mod.isDisabled
            ? 'Disabled mods cannot be reordered'
            : `Drag to reorder (Load Order #${mod.loadOrder ?? '?'})`
        }
      >
        <button
          type="button"
          disabled={mod.isDisabled || isMultiSelectMode}
          onClick={(e) => {
            e.stopPropagation();
            onMoveStep(mod.id, 'up');
          }}
          className="p-0.5 text-[#6B7480] hover:text-[#EA580C] disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed rounded"
          title="Move up in load order"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>

        <GripVertical className="w-3.5 h-3.5 text-[#9AA3AF] hover:text-[#EA580C] my-auto" />

        <button
          type="button"
          disabled={mod.isDisabled || isMultiSelectMode}
          onClick={(e) => {
            e.stopPropagation();
            onMoveStep(mod.id, 'down');
          }}
          className="p-0.5 text-[#6B7480] hover:text-[#EA580C] disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed rounded"
          title="Move down in load order"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Thumbnail column */}
      <InstalledModThumbnail
        mod={mod}
        collision={collision}
        hasMissingDeps={hasMissingDeps}
        missingDepSummary={depStatus.allMissing}
        onNavigateConflicts={onNavigateConflicts}
      />

      {/* Content area right */}
      <div className="flex-1 flex flex-col justify-between overflow-hidden min-w-0">
        <div>
          {/* Load Order Badge + Title */}
          <div className="flex items-center gap-1.5 pr-6">
            {!mod.isDisabled && typeof mod.loadOrder === 'number' ? (
              <span
                className="bg-[#EA580C]/15 border border-[#EA580C]/40 text-[#F97316] text-[10px] font-mono font-bold px-1.5 py-0.2 rounded shrink-0 shadow-2xs flex items-center gap-0.5"
                title={`SPT Execution Load Order #${mod.loadOrder}`}
              >
                <Layers className="w-2.5 h-2.5" />
                #{mod.loadOrder}
              </span>
            ) : (
              <span
                className="bg-[#20252D] text-[#6B7480] text-[9.5px] font-mono px-1 py-0.2 rounded shrink-0"
                title="Disabled mod (no active load order)"
              >
                Inactive
              </span>
            )}

            <h3
              className={`text-[13.5px] font-bold truncate tracking-tight ${
                hasMissingDeps ? 'text-[#EF4444]' : 'text-[#E8EAEE]'
              }`}
              title={mod.name}
            >
              <HighlightText text={mod.name} query={searchText} />
            </h3>
          </div>

          {/* Package ID */}
          <p className="font-mono text-[10.5px] text-[#6B7480] truncate mt-0.5" title={mod.id}>
            <HighlightText text={mod.id} query={searchText} />
          </p>

          {/* Missing Dependencies Alert Banner */}
          {hasMissingDeps && (
            <div className="mt-1 bg-[#281013] border border-[#DC2626] rounded px-2 py-1 text-[11px] text-[#EF4444] shadow-xs">
              <div className="flex items-center gap-1 font-bold">
                <AlertCircle className="w-3 h-3 text-[#EF4444] shrink-0" />
                <span>Missing Required Dependencies:</span>
              </div>
              <div className="mt-0.5 space-y-0.5 pl-4 text-[10.5px]">
                {depStatus.missingUninstalled.map((missingId) => (
                  <div key={missingId} className="text-[#FCA5A5] font-mono truncate">
                    • <HighlightText text={missingId} query={searchText} />{' '}
                    <span className="text-[#EF4444] font-sans font-semibold">(Not Installed)</span>
                  </div>
                ))}
                {depStatus.missingDisabled.map((dis) => (
                  <div key={dis.id} className="text-[#FCA5A5] font-mono truncate flex items-center gap-1">
                    • <HighlightText text={dis.name} query={searchText} />{' '}
                    <span className="text-[#F59E0B] font-sans font-semibold">(Disabled)</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleMod(dis.id);
                      }}
                      className="ml-1 text-[9.5px] bg-[#3A2A10] hover:bg-[#F59E0B] text-[#F59E0B] hover:text-black font-sans px-1.5 py-0.2 rounded border border-[#F59E0B]/50 transition-colors cursor-pointer"
                      title={`Enable prerequisite ${dis.name}`}
                    >
                      Enable Now
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Author + Category + Mod Kind */}
          <div className="flex items-center gap-1 mt-1 text-[11px] flex-wrap">
            <span className="bg-[#20252D] text-[#EA580C] px-1.5 py-0.2 rounded font-semibold text-[10.5px]">
              <HighlightText text={mod.author} query={searchText} />
            </span>

            {mod.categoryTitle && (
              <span className="bg-[#181B20] border border-[#2A2F38] text-[#9AA3AF] text-[10.5px] px-1.5 py-0.2 rounded font-medium">
                <HighlightText text={mod.categoryTitle} query={searchText} />
              </span>
            )}

            {mod.kind === 'Server' && (
              <span className="bg-[#20252D] border border-[#23272E] text-[#9AA3AF] text-[10.5px] px-1.5 py-0.2 rounded-full">
                <HighlightText text="Server" query={searchText} />
              </span>
            )}
            {mod.kind === 'Client' && (
              <span className="bg-[#20252D] border border-[#23272E] text-[#9AA3AF] text-[10.5px] px-1.5 py-0.2 rounded-full">
                <HighlightText text="Client Plugin" query={searchText} />
              </span>
            )}
            {mod.kind === 'Both' && (
              <>
                <span className="bg-[#20252D] border border-[#23272E] text-[#9AA3AF] text-[10.5px] px-1.5 py-0.2 rounded-full">
                  <HighlightText text="Server" query={searchText} />
                </span>
                <span className="bg-[#20252D] border border-[#23272E] text-[#9AA3AF] text-[10.5px] px-1.5 py-0.2 rounded-full">
                  <HighlightText text="Client" query={searchText} />
                </span>
              </>
            )}
          </div>

          {/* Custom Tags Row */}
          <div className="flex items-center gap-1 mt-1.5 overflow-hidden flex-wrap max-h-6">
            {mod.tags && mod.tags.length > 0
              ? mod.tags.map((t) => (
                  <span
                    key={t.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onFilterByTag(t.name);
                    }}
                    className={`text-[9.5px] font-semibold px-1.5 py-0.2 rounded-md border flex items-center gap-1 cursor-pointer transition-transform hover:scale-105 ${getTagBadgeStyle(
                      t.color
                    )}`}
                    title={`Filter by tag "${t.name}"`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
                    <span>
                      <HighlightText text={t.name} query={searchText} />
                    </span>
                  </span>
                ))
              : null}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenTagModal(mod);
              }}
              className="text-[9.5px] text-[#6B7480] hover:text-[#E8EAEE] hover:bg-[#20252D] px-1 py-0.2 rounded border border-transparent hover:border-[#2A2F38] flex items-center gap-0.5 cursor-pointer transition-colors"
              title="Manage custom tags for this mod"
            >
              <Plus className="w-2.5 h-2.5" />
              <span>Tag</span>
            </button>
          </div>

          {/* Version & path stats */}
          <div className="text-[11px] text-[#9AA3AF] mt-1 truncate">
            <span>v{mod.version}</span>
            {mod.serverPath && (
              <span className="text-[#6B7480] ml-1.5">
                · <HighlightText text={mod.serverPath.split('/').pop() || ''} query={searchText} />
              </span>
            )}
            {mod.clientPath && !mod.serverPath && (
              <span className="text-[#6B7480] ml-1.5">
                · <HighlightText text={mod.clientPath.split('/').pop() || ''} query={searchText} />
              </span>
            )}
          </div>

          {/* Update Notice */}
          {mod.hasUpdate && (
            <div className="flex items-center gap-1 text-[11px] text-[#EA580C] font-semibold mt-1">
              <ArrowUpCircle className="w-3 h-3" />
              <span>Update available: v{mod.latestVersion}</span>
            </div>
          )}
        </div>

        {/* Action Row */}
        <div className="flex items-center justify-between pt-2 border-t border-[#23272E] mt-2">
          {/* Enable/Disable Toggle button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleMod(mod.id);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold cursor-pointer transition-colors ${
              mod.isDisabled
                ? 'bg-[#20252D] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-[#E8EAEE]'
                : 'bg-[#15281B] hover:bg-[#1C3624] text-[#22C55E]'
            }`}
            title={mod.isDisabled ? 'Click to enable mod' : 'Click to disable mod (.disabled suffix)'}
            type="button"
          >
            <span className={`w-2 h-2 rounded-full ${mod.isDisabled ? 'bg-[#9AA3AF]' : 'bg-[#22C55E]'}`} />
            <span>{mod.isDisabled ? 'Disabled' : 'Enabled'}</span>
          </button>

          {/* Right action icons */}
          <div className="flex items-center gap-1">
            {mod.hasUpdate && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateMod(mod);
                }}
                className="bg-[#EA580C] hover:bg-[#F97316] text-white p-1.5 rounded transition-colors cursor-pointer"
                title={`Update to v${mod.latestVersion}`}
                type="button"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenTagModal(mod);
              }}
              className="bg-[#20252D] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-[#E8EAEE] p-1.5 rounded transition-colors cursor-pointer"
              title="Manage tags"
              type="button"
            >
              <Tag className="w-3.5 h-3.5" />
            </button>

            {mod.configFiles && mod.configFiles.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEditConfigs(mod);
                }}
                className="bg-[#20252D] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-[#E8EAEE] p-1.5 rounded transition-colors cursor-pointer"
                title={`Edit mod configuration (${mod.configFiles.length} file${mod.configFiles.length > 1 ? 's' : ''})`}
                type="button"
              >
                <Sliders className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                if (hasBothFolders) {
                  onOpenFolder(paths);
                } else {
                  onOpenFolder(paths[0] || 'BepInEx/plugins');
                }
              }}
              className={`p-1.5 rounded transition-colors cursor-pointer relative ${
                hasBothFolders
                  ? 'bg-[#182333] hover:bg-[#203147] text-[#38BDF8] hover:text-[#7DD3FC] border border-[#0284C7]/40'
                  : 'bg-[#20252D] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-[#E8EAEE]'
              }`}
              title={
                hasBothFolders
                  ? `Show in folders: Open both BepInEx and SPT_Runtime/user/mods folders in File Explorer (${paths.join(' + ')})`
                  : `Show in folder: Open ${paths[0] || 'mod folder'} in File Explorer`
              }
              type="button"
              aria-label={hasBothFolders ? 'Show in folders: open both BepInEx and server mods folders' : 'Show in folder'}
            >
              <Folder className="w-3.5 h-3.5" />
              {hasBothFolders && (
                <span
                  className="absolute -top-1 -right-1 bg-[#0284C7] text-white text-[8px] font-mono font-bold px-1 py-0.2 rounded-full leading-none shadow-xs"
                  title="Both BepInEx & SPT_Runtime/user/mods folders will open"
                >
                  2
                </span>
              )}
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onUninstallMod(mod.id);
              }}
              className="bg-[#20252D] hover:bg-[#DC2626] text-[#9AA3AF] hover:text-white p-1.5 rounded transition-colors cursor-pointer"
              title="Uninstall and delete mod files"
              type="button"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

InstalledModRowCard.displayName = 'InstalledModRowCard';
