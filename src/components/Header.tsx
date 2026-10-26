import React from 'react';
import { Folder, Play, Layers, Download, RefreshCw } from 'lucide-react';
import { SettingsState, ModProfile } from '../types';
import { useAppEmblem } from '../hooks/useAppEmblem';
import { isDesktopEnvironment } from '../services/desktopBridgeService';

interface HeaderProps {
  settings: SettingsState;
  onUpdateSettings: (newSettings: Partial<SettingsState>) => void;
  onPickDirectory: () => void;
  onRescanMods?: (customPath?: string) => void;
  isScanningMods?: boolean;
  onLaunchSpt: () => void;
  profiles: ModProfile[];
  onSelectProfile: (profileId: string) => void;
  onCreateProfile: (name?: string) => void;
  onOpenProfilesTab?: () => void;
  onOpenDownloadModal?: () => void;
  isLaunching?: boolean;
  isServerRunning?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  settings,
  onUpdateSettings,
  onPickDirectory,
  onRescanMods,
  isScanningMods = false,
  onLaunchSpt,
  profiles,
  onSelectProfile,
  onCreateProfile,
  onOpenProfilesTab,
  onOpenDownloadModal,
  isLaunching = false,
  isServerRunning = false,
}) => {
  const { emblemSrc, setCustomEmblem, defaultEmblem, fallbackEmblem } = useAppEmblem();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleEmblemFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (dataUrl) {
        setCustomEmblem(dataUrl);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="bg-[#181B20] border-b border-[#23272E] px-4.5 pt-3 pb-3 shrink-0">
      {/* Title row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleEmblemFileChange}
          />
          <div
            onClick={() => fileInputRef.current?.click()}
            className="relative group cursor-pointer"
            title="Click to apply custom emblem image (.png)"
          >
            <img
              src={emblemSrc}
              onError={(e) => {
                if (e.currentTarget.src !== defaultEmblem) {
                  e.currentTarget.src = defaultEmblem;
                } else if (e.currentTarget.src !== fallbackEmblem) {
                  e.currentTarget.src = fallbackEmblem;
                }
              }}
              alt="Blacksite Shield Patch"
              className="w-8 h-8 object-contain drop-shadow select-none rounded-sm transition-transform group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 rounded-sm flex items-center justify-center transition-opacity">
              <span className="text-[8px] text-white font-bold uppercase">EDIT</span>
            </div>
          </div>
          <span className="text-[20px] font-bold text-[#E8EAEE] tracking-tight">Blacksite</span>
          <span className="text-[15px] text-[#9AA3AF] mt-0.5">Mod Manager</span>
          <div className="bg-[#EA580C]/15 border border-[#EA580C]/35 rounded px-2 py-0.5 ml-2">
            <span className="text-[11px] text-[#EA580C] font-semibold tracking-wide">
              v2.1.0
            </span>
          </div>
          <div className="bg-[#20252D] rounded px-2 py-0.5 ml-1">
            <span className="text-[11px] text-[#6B7480] font-medium tracking-wide">
              SPT · sp-mod.com
            </span>
          </div>
        </div>

        {/* Action Controls: Windows Download + Profile Selector */}
        <div className="flex items-center gap-2.5">
          {onOpenDownloadModal && !isDesktopEnvironment() && (
            <button
              onClick={onOpenDownloadModal}
              className="bg-[#20252D] hover:bg-[#282F3A] border border-[#2B303C] hover:border-[#EA580C]/60 text-[#E8EAEE] text-xs font-semibold px-2.5 py-1.5 rounded-md flex items-center gap-1.5 transition-all cursor-pointer shadow-xs group"
              title="Download Blacksite Windows Desktop Standalone (.exe)"
              type="button"
            >
              <Download className="w-3.5 h-3.5 text-[#EA580C] group-hover:scale-110 transition-transform" />
              <span>Windows .EXE</span>
            </button>
          )}

          {/* Profile Selector */}
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenProfilesTab}
              type="button"
              className="flex items-center gap-1.5 text-xs text-[#9AA3AF] hover:text-[#EA580C] transition-colors cursor-pointer group"
              title="Open Tactical Profiles & Loadout Swapper"
            >
              <Layers className="w-3.5 h-3.5 group-hover:scale-110 transition-transform text-[#EA580C]" />
              <span className="hidden sm:inline">Profile:</span>
            </button>
            <select
              value={settings.activeProfileId}
              onChange={(e) => {
                if (e.target.value === '__new__') {
                  onCreateProfile();
                } else if (e.target.value === '__manage__') {
                  if (onOpenProfilesTab) onOpenProfilesTab();
                } else {
                  onSelectProfile(e.target.value);
                }
              }}
              className="bg-[#0E1013] border border-[#23272E] rounded text-xs text-[#E8EAEE] px-2.5 py-1 focus:outline-none focus:border-[#EA580C] cursor-pointer"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.enabledModIds.length} mods)
                </option>
              ))}
              <option value="__new__">+ New Profile...</option>
              <option value="__manage__">⚡ Manage & Compare Profiles...</option>
            </select>
          </div>
        </div>
      </div>

      {/* Global controls row */}
      <div className="flex items-center gap-2.5 flex-wrap">
        {/* Set SPT Directory button */}
        <button
          onClick={onPickDirectory}
          className="bg-[#EA580C] hover:bg-[#F97316] text-white text-[13px] font-medium px-3 py-1.5 rounded-md flex items-center gap-2 transition-colors shrink-0 shadow-sm cursor-pointer"
          title="Choose the Single Player Tarkov root folder (contains BepInEx and user)"
          type="button"
        >
          <Folder className="w-4 h-4" />
          <span>Set SPT Directory</span>
        </button>

        {/* Editable Directory input box + Rescan button */}
        <div className="flex items-center flex-1 min-w-[220px] gap-1.5">
          <input
            type="text"
            value={settings.sptDirectory}
            onChange={(e) => onUpdateSettings({ sptDirectory: e.target.value })}
            onBlur={() => {
              if (onRescanMods) onRescanMods(settings.sptDirectory);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && onRescanMods) {
                e.currentTarget.blur();
              }
            }}
            placeholder="C:\Games\SPT"
            className="bg-[#0E1013] border border-[#23272E] focus:border-[#EA580C] rounded-md px-3 py-1.5 flex-1 min-w-0 text-[13px] text-[#E8EAEE] font-mono focus:outline-none transition-colors"
            title="Current Single Player Tarkov Root Directory (Edit or click Set SPT Directory)"
          />
          {onRescanMods && (
            <button
              onClick={() => onRescanMods(settings.sptDirectory)}
              disabled={isScanningMods}
              className="bg-[#20252D] hover:bg-[#2A2F38] border border-[#2B303C] text-[#E8EAEE] text-xs font-medium px-2.5 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
              title="Rescan SPT Directory on disk for installed mods and SPT version"
              type="button"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#EA580C] ${isScanningMods ? 'animate-spin' : ''}`} />
              <span className="hidden md:inline">{isScanningMods ? 'Scanning...' : 'Rescan'}</span>
            </button>
          )}
        </div>

        {/* SPT Version input */}
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-[13px] text-[#9AA3AF] cursor-help"
            title="Used to resolve compatible versions, dependencies and updates. Auto-detected when possible."
          >
            SPT Version
          </span>
          <input
            type="text"
            value={settings.sptVersion}
            onChange={(e) => onUpdateSettings({ sptVersion: e.target.value })}
            className="w-[90px] bg-[#0E1013] border border-[#23272E] rounded-md px-2.5 py-1 text-[13px] text-[#E8EAEE] font-mono focus:outline-none focus:border-[#EA580C]"
            title="Your installed SPT version, e.g. 4.0.12"
          />
        </div>

        {/* Launch SPT button */}
        <button
          onClick={onLaunchSpt}
          className={`${
            isServerRunning
              ? 'bg-[#15803D] hover:bg-[#16A34A] ring-1 ring-[#22C55E]/50'
              : 'bg-[#16A34A] hover:bg-[#22C55E]'
          } text-white text-[13px] font-semibold px-4 py-1.5 rounded-md flex items-center gap-2 transition-all shrink-0 shadow-sm ml-auto cursor-pointer`}
          title={
            isServerRunning
              ? 'SPT.Server is actively running on 127.0.0.1:6969. Click to view console or stop.'
              : 'Start SPT.Server.exe, watch console until ready, then chain SPT.Launcher.exe'
          }
          type="button"
        >
          {isServerRunning ? (
            <>
              <span className="w-2 h-2 rounded-full bg-[#4ADE80] animate-pulse" />
              <span>SPT Server Active</span>
            </>
          ) : (
            <>
              <Play className={`w-3.5 h-3.5 fill-current ${isLaunching ? 'animate-pulse' : ''}`} />
              <span>{isLaunching ? 'Launching SPT...' : '🚀 Launch SPT'}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
