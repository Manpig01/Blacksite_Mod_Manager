import React, { useState, useEffect } from 'react';
import { Folder, Play, Layers, Download } from 'lucide-react';
import { SettingsState, ModProfile } from '../types';

interface HeaderProps {
  settings: SettingsState;
  onUpdateSettings: (newSettings: Partial<SettingsState>) => void;
  onPickDirectory: () => void;
  onLaunchSpt: () => void;
  profiles: ModProfile[];
  onSelectProfile: (profileId: string) => void;
  onCreateProfile: (name?: string) => void;
  onOpenDownloadModal?: () => void;
  isLaunching?: boolean;
  isServerRunning?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  settings,
  onUpdateSettings,
  onPickDirectory,
  onLaunchSpt,
  profiles,
  onSelectProfile,
  onCreateProfile,
  onOpenDownloadModal,
  isLaunching = false,
  isServerRunning = false,
}) => {
  const [emblemKey, setEmblemKey] = useState(Date.now());
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleUpdate = () => setEmblemKey(Date.now());
    window.addEventListener('emblem-updated', handleUpdate);
    return () => window.removeEventListener('emblem-updated', handleUpdate);
  }, []);

  const handleEmblemFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      try {
        await fetch('/api/upload-emblem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl }),
        });
        window.dispatchEvent(new CustomEvent('emblem-updated'));
      } catch (_) {}
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
              src={`/emblem.png?t=${emblemKey}`}
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
              v2.0.0
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
          {onOpenDownloadModal && (
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

          {/* Profile Selector (task 2.5) */}
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-[#9AA3AF]" />
            <span className="text-xs text-[#9AA3AF]">Profile:</span>
          <select
            value={settings.activeProfileId}
            onChange={(e) => {
              if (e.target.value === '__new__') {
                onCreateProfile();
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

        {/* Directory display box */}
        <div
          className="bg-[#0E1013] border border-[#23272E] rounded-md px-3 py-1.5 flex-1 min-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-[#9AA3AF] select-text"
          title={settings.sptDirectory}
        >
          {settings.sptDirectory}
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
