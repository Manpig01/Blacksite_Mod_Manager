import React, { useState } from 'react';
import { RefreshCw, CheckCircle, XCircle, Folder, Trash2, ArrowUpCircle, Search, Sliders, AlertTriangle } from 'lucide-react';
import { InstalledMod, ConflictInfo } from '../types';

interface InstalledModsTabProps {
  installedMods: InstalledMod[];
  conflicts: ConflictInfo[];
  onToggleMod: (modId: string) => void;
  onUninstallMod: (modId: string) => void;
  onUpdateMod: (mod: InstalledMod) => void;
  onEditConfigs: (mod: InstalledMod) => void;
  onShowConflict: (conflict: ConflictInfo) => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
  onUninstallAll: () => void;
  onCheckUpdates: () => void;
  onOpenFolder: (folderType: 'client' | 'server') => void;
  onShowToast: (title: string, message: string, type: 'success' | 'info' | 'warning' | 'error') => void;
}

export const InstalledModsTab: React.FC<InstalledModsTabProps> = ({
  installedMods,
  conflicts,
  onToggleMod,
  onUninstallMod,
  onUpdateMod,
  onEditConfigs,
  onShowConflict,
  onEnableAll,
  onDisableAll,
  onUninstallAll,
  onCheckUpdates,
  onOpenFolder,
  onShowToast,
}) => {
  const [searchText, setSearchText] = useState('');
  const [sortMode, setSortMode] = useState<'name' | 'author' | 'date' | 'update'>('name');
  const [updatesFirst, setUpdatesFirst] = useState(false);
  const [hideDisabled, setHideDisabled] = useState(false);

  // Active / disabled counts
  const activeCount = installedMods.filter((m) => !m.isDisabled).length;
  const disabledCount = installedMods.filter((m) => m.isDisabled).length;
  const updateCount = installedMods.filter((m) => m.hasUpdate).length;

  // Filter & sort
  let displayed = [...installedMods];

  if (searchText.trim()) {
    const q = searchText.trim().toLowerCase();
    displayed = displayed.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.author.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q)
    );
  }

  if (hideDisabled) {
    displayed = displayed.filter((m) => !m.isDisabled);
  }

  displayed.sort((a, b) => {
    if (updatesFirst) {
      if (a.hasUpdate && !b.hasUpdate) return -1;
      if (!a.hasUpdate && b.hasUpdate) return 1;
    }

    switch (sortMode) {
      case 'author':
        return a.author.localeCompare(b.author);
      case 'date':
        return new Date(b.installDate).getTime() - new Date(a.installDate).getTime();
      case 'update':
        return (b.hasUpdate ? 1 : 0) - (a.hasUpdate ? 1 : 0);
      case 'name':
      default:
        return a.name.localeCompare(b.name);
    }
  });

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-2">
      {/* Installed action bar */}
      <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-2.5 mb-2 flex items-center justify-between flex-wrap gap-2 text-[12.5px] shadow-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => {
              onShowToast('Mod Scanner', 'Re-scanned user/mods and BepInEx/plugins directories.', 'info');
            }}
            className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] px-3 py-1.5 rounded-md border border-[#2A2F38] flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Re-scan user/mods and BepInEx/plugins for installed mods"
            type="button"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>

          <button
            onClick={onEnableAll}
            className="bg-[#16A34A] hover:bg-[#22C55E] text-white px-3 py-1.5 rounded-md flex items-center gap-1.5 font-medium transition-colors cursor-pointer"
            title="Re-enable every disabled mod (removes .disabled suffix)"
            type="button"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            <span>Enable All</span>
          </button>

          <button
            onClick={onDisableAll}
            className="bg-[#DC2626] hover:bg-red-600 text-white px-3 py-1.5 rounded-md flex items-center gap-1.5 font-medium transition-colors cursor-pointer"
            title="Disable every mod (renames folder with .disabled suffix)"
            type="button"
          >
            <XCircle className="w-3.5 h-3.5" />
            <span>Disable All</span>
          </button>

          <button
            onClick={() => onOpenFolder('client')}
            className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] px-3 py-1.5 rounded-md border border-[#2A2F38] flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Open client mods folder (BepInEx/plugins)"
            type="button"
          >
            <Folder className="w-3.5 h-3.5 text-[#9AA3AF]" />
            <span>Client Folder</span>
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
            className="bg-[#EA580C] hover:bg-[#F97316] text-white px-3.5 py-1.5 rounded-md flex items-center gap-1.5 font-medium transition-colors cursor-pointer"
            title="Send installed package IDs + versions to sp-mod.com update check"
            type="button"
          >
            <ArrowUpCircle className="w-3.5 h-3.5" />
            <span>Check for Updates</span>
          </button>
        </div>

        <div className="text-[12px] text-[#9AA3AF] font-medium ml-auto">
          {installedMods.length} installed ({activeCount} active, {disabledCount} disabled
          {updateCount > 0 && (
            <span className="text-[#EA580C] font-semibold ml-1.5">
              · {updateCount} update available
            </span>
          )}
          )
        </div>
      </div>

      {/* Installed filter bar */}
      <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-2.5 mb-2 flex items-center justify-between flex-wrap gap-2 text-[12.5px] shadow-sm">
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <div className="relative w-[280px]">
            <Search className="w-4 h-4 text-[#6B7480] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search installed mods..."
              className="w-full bg-[#0E1013] border border-[#23272E] rounded-md pl-8 pr-3 py-1 text-[13px] text-[#E8EAEE] placeholder-[#6B7480] focus:outline-none focus:border-[#EA580C]"
            />
          </div>

          <button
            onClick={() => {
              setSearchText('');
              setUpdatesFirst(false);
              setHideDisabled(false);
            }}
            className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] px-3 py-1 rounded border border-[#2A2F38] transition-colors cursor-pointer"
            type="button"
          >
            Clear
          </button>

          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-[#9AA3AF]">Sort:</span>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as any)}
              className="bg-[#0E1013] border border-[#23272E] rounded px-2.5 py-1 text-[#E8EAEE] focus:outline-none focus:border-[#EA580C] cursor-pointer"
            >
              <option value="name">Name</option>
              <option value="author">Author</option>
              <option value="date">Install Date</option>
              <option value="update">Update Status</option>
            </select>
          </div>

          <label className="flex items-center gap-1.5 cursor-pointer text-[#9AA3AF] hover:text-[#E8EAEE] ml-2">
            <input
              type="checkbox"
              checked={updatesFirst}
              onChange={(e) => setUpdatesFirst(e.target.checked)}
              className="accent-[#EA580C]"
            />
            <span>Updates first</span>
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer text-[#9AA3AF] hover:text-[#E8EAEE]">
            <input
              type="checkbox"
              checked={hideDisabled}
              onChange={(e) => setHideDisabled(e.target.checked)}
              className="accent-[#EA580C]"
            />
            <span>Hide Disabled mods</span>
          </label>
        </div>
      </div>

      {/* Installed Mod Grid */}
      <div className="flex-1 overflow-y-auto pr-1">
        {displayed.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-[#9AA3AF]">
            <span className="text-4xl opacity-50 mb-2">📦</span>
            <p className="text-base font-medium text-[#E8EAEE]">No installed mods found</p>
            <p className="text-sm">Install mods from the Browse Mods tab or drop an archive.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pb-6">
            {displayed.map((mod) => {
              const conflict = conflicts.find((c) => c.conflictingModIds.includes(mod.id));
              const hasThumbnail = Boolean(mod.thumbnail);

              return (
                <div
                  key={mod.id}
                  className={`h-[220px] rounded-lg p-3 transition-colors flex gap-3 relative border ${
                    mod.isDisabled
                      ? 'bg-[#14161A] border-[#20252D] opacity-75'
                      : 'bg-[#181B20] border-[#23272E] hover:border-[#EA580C]'
                  }`}
                >
                  {/* Thumbnail column (135x135) */}
                  <div className="w-[135px] h-[135px] shrink-0 relative bg-[#20252D] rounded-md overflow-hidden self-center border border-[#23272E]">
                    {hasThumbnail ? (
                      <img
                        src={mod.thumbnail}
                        alt={mod.name}
                        className={`w-full h-full object-cover ${mod.isDisabled ? 'grayscale' : ''}`}
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : null}

                    {/* Placeholder initial */}
                    <div className="absolute inset-0 flex items-center justify-center text-4xl font-bold text-[#3A4150] -z-10 select-none">
                      {mod.name.charAt(0).toUpperCase()}
                    </div>

                    {/* Top-left: green SPT version badge */}
                    <div className="absolute top-1 left-1 bg-[#16A34A] rounded px-1.5 py-0.5 text-[9.5px] font-semibold text-white tracking-tight shadow">
                      SPT {mod.sptVersion || '4.x'}
                    </div>

                    {/* Top-right: Conflict Warning Badge (task 2.4) */}
                    {conflict && (
                      <button
                        onClick={() => onShowConflict(conflict)}
                        className="absolute top-1 right-1 bg-[#3A2A10] border border-[#F59E0B] text-[#F59E0B] rounded px-1.5 py-0.5 text-[9.5px] font-bold flex items-center gap-0.5 cursor-pointer shadow hover:bg-[#4A3515] transition-colors"
                        title={conflict.details}
                        type="button"
                      >
                        <AlertTriangle className="w-2.5 h-2.5" />
                        <span>CONFLICT</span>
                      </button>
                    )}

                    {/* Bottom-left: Fika Compatible overlay */}
                    {mod.fikaCompatibility && (
                      <div className="absolute bottom-1 left-1 bg-[#0E2A18] border border-[#16A34A] rounded px-1.5 py-0.5 text-[9.5px] font-semibold text-[#22C55E] tracking-tight shadow">
                        Fika Compatible
                      </div>
                    )}
                  </div>

                  {/* Content area right */}
                  <div className="flex-1 flex flex-col justify-between overflow-hidden min-w-0">
                    <div>
                      {/* Title */}
                      <h3
                        className="text-[14px] font-bold text-[#E8EAEE] truncate tracking-tight"
                        title={mod.name}
                      >
                        {mod.name}
                      </h3>

                      {/* Package ID */}
                      <p
                        className="font-mono text-[10.5px] text-[#6B7480] truncate mt-0.5"
                        title={mod.id}
                      >
                        {mod.id}
                      </p>

                      {/* Pills: Author + Kind Pills */}
                      <div className="flex items-center gap-1.5 mt-1.5 overflow-hidden flex-wrap max-h-6">
                        <span className="bg-[#3A2415] border border-[#EA580C] text-[#F97316] text-[11px] font-semibold px-2 py-0.5 rounded-full truncate max-w-[110px]">
                          {mod.author}
                        </span>

                        {mod.kind === 'Server' && (
                          <span className="bg-[#20252D] border border-[#23272E] text-[#9AA3AF] text-[11px] px-2 py-0.5 rounded-full">
                            Server Mod
                          </span>
                        )}
                        {mod.kind === 'Client' && (
                          <span className="bg-[#20252D] border border-[#23272E] text-[#9AA3AF] text-[11px] px-2 py-0.5 rounded-full">
                            Client Plugin
                          </span>
                        )}
                        {mod.kind === 'Both' && (
                          <>
                            <span className="bg-[#20252D] border border-[#23272E] text-[#9AA3AF] text-[11px] px-1.5 py-0.5 rounded-full">
                              Server
                            </span>
                            <span className="bg-[#20252D] border border-[#23272E] text-[#9AA3AF] text-[11px] px-1.5 py-0.5 rounded-full">
                              Client
                            </span>
                          </>
                        )}
                      </div>

                      {/* Version & path stats */}
                      <div className="text-[11.5px] text-[#9AA3AF] mt-1.5 truncate">
                        <span>v{mod.version}</span>
                        {mod.hasUpdate && (
                          <span className="text-[#EA580C] font-semibold ml-1.5">
                            (Update: v{mod.latestVersion})
                          </span>
                        )}
                        <span className="mx-1.5">·</span>
                        <span>{mod.installDate}</span>
                      </div>

                      {/* Teaser or path */}
                      <p
                        className="text-[11px] text-[#6B7480] mt-1 line-clamp-2 leading-[14px]"
                        title={mod.teaser || mod.serverPath || mod.clientPath || ''}
                      >
                        {mod.teaser || mod.serverPath || mod.clientPath || 'Installed mod'}
                      </p>
                    </div>

                    {/* Action buttons row */}
                    <div className="flex items-center justify-between pt-1 border-t border-[#23272E]/50">
                      <div className="text-[11px] font-medium">
                        {mod.isDisabled ? (
                          <span className="text-[#DC2626]">.disabled</span>
                        ) : (
                          <span className="text-[#16A34A]">Active</span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {/* Edit configs button */}
                        <button
                          onClick={() => onEditConfigs(mod)}
                          className="h-7 px-2 bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] rounded text-xs flex items-center gap-1 transition-colors cursor-pointer"
                          title="Edit Configs — open this mod's .json / .cfg / .yaml files"
                          type="button"
                        >
                          <Sliders className="w-3 h-3 text-[#9AA3AF]" />
                          <span>Config</span>
                        </button>

                        {/* Update button */}
                        {mod.hasUpdate && (
                          <button
                            onClick={() => onUpdateMod(mod)}
                            className="h-7 px-2 bg-[#EA580C] hover:bg-[#F97316] text-white rounded text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer shadow-sm"
                            title={`Update to v${mod.latestVersion}`}
                            type="button"
                          >
                            <ArrowUpCircle className="w-3 h-3" />
                            <span>Update</span>
                          </button>
                        )}

                        {/* Disable / Enable toggle */}
                        <button
                          onClick={() => onToggleMod(mod.id)}
                          className={`h-7 px-2.5 rounded text-xs font-medium transition-colors cursor-pointer ${
                            mod.isDisabled
                              ? 'bg-[#16A34A] hover:bg-[#22C55E] text-white'
                              : 'bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE]'
                          }`}
                          title="Toggle mod active or disabled with .disabled suffix"
                          type="button"
                        >
                          {mod.isDisabled ? 'Enable' : 'Disable'}
                        </button>

                        {/* Uninstall button */}
                        <button
                          onClick={() => onUninstallMod(mod.id)}
                          className="h-7 px-2 bg-[#20252D] hover:bg-[#DC2626] text-[#9AA3AF] hover:text-white rounded text-xs transition-colors cursor-pointer"
                          title="Uninstall and delete mod files"
                          type="button"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
