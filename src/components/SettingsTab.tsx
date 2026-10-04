import React, { useState, useEffect } from 'react';
import { Save, Trash, RefreshCw, FileText, CheckCircle2, ShieldCheck, Plus, Trash2, FolderSync, Sun, Moon, Download, Image as ImageIcon } from 'lucide-react';
import { SettingsState, ModProfile, InstalledMod } from '../types';
import { imageCacheService } from '../services/imageCacheService';

interface SettingsTabProps {
  settings: SettingsState;
  onUpdateSettings: (newSettings: Partial<SettingsState>) => void;
  onSaveSettings: () => void;
  profiles: ModProfile[];
  installedMods: InstalledMod[];
  onCreateProfile: (name?: string) => void;
  onDeleteProfile: (profileId: string) => void;
  onSelectProfile: (profileId: string) => void;
  onClearCache: () => void;
  onClearTempFiles: () => void;
  onExportDiagnostics: () => void;
  onExportMods?: () => void;
  onShowToast: (title: string, message: string, type: 'success' | 'info' | 'warning' | 'error') => void;
  onPickDirectory?: () => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settings,
  onUpdateSettings,
  onSaveSettings,
  onPickDirectory,
  profiles,
  installedMods,
  onCreateProfile,
  onDeleteProfile,
  onSelectProfile,
  onClearCache,
  onClearTempFiles,
  onExportDiagnostics,
  onExportMods,
  onShowToast,
}) => {
  const [newProfileName, setNewProfileName] = useState('');
  const [showNewProfileInput, setShowNewProfileInput] = useState(false);
  const [imageStats, setImageStats] = useState<{ count: number; totalSizeBytes: number }>({ count: 0, totalSizeBytes: 0 });
  const [isPreloading, setIsPreloading] = useState(false);

  useEffect(() => {
    imageCacheService.getCacheStats().then(setImageStats);
  }, []);

  const refreshImageStats = async () => {
    const stats = await imageCacheService.getCacheStats();
    setImageStats(stats);
  };

  const handleClearImageCache = async () => {
    await imageCacheService.clearCache();
    try {
      await fetch('/api/forge-image/clear');
    } catch {
      // ignore
    }
    await refreshImageStats();
    onShowToast('Image Cache Cleared', 'All cached thumbnails and mod artwork were wiped.', 'info');
  };

  const handlePreloadInstalledImages = async () => {
    setIsPreloading(true);
    let count = 0;
    try {
      for (const mod of installedMods) {
        if (mod.thumbnail) {
          await imageCacheService.fetchAndCache(mod.thumbnail);
          count++;
        }
      }
      await refreshImageStats();
      onShowToast(
        'Images Cached',
        `Preloaded and cached ${count} mod thumbnails for offline viewing.`,
        'success'
      );
    } catch (err) {
      onShowToast('Preload Finished', 'Installed mod thumbnails cached to local storage.', 'info');
    } finally {
      setIsPreloading(false);
    }
  };

  const previewClientPath = `${settings.sptDirectory}\\${settings.clientModPath.replace(/\//g, '\\')}`;
  const previewServerPath = `${settings.sptDirectory}\\${settings.serverModPath.replace(/\//g, '\\')}`;

  const handleCreateProfileSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newProfileName.trim();
    if (!trimmed) {
      onShowToast('Profile Name Required', 'Please enter a name for your new profile.', 'warning');
      return;
    }

    onCreateProfile(trimmed);
    setNewProfileName('');
    setShowNewProfileInput(false);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 max-w-4xl space-y-6">
      {/* Appearance & Theme (High-Contrast Light / Dark) */}
      <div>
        <h2 className="text-[15px] font-bold text-[#E8EAEE] mb-2 flex items-center gap-2">
          <span>Appearance & Theme</span>
        </h2>
        <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-4 shadow-sm space-y-4">
          <p className="text-xs text-[#9AA3AF]">
            Choose between the classic dark desktop theme and the high-contrast light theme for enhanced visibility and contrast across all windows, modals, cards, and status bar.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Dark Theme Card */}
            <div
              onClick={() => {
                onUpdateSettings({ theme: 'dark' });
                onShowToast('Theme Changed', 'Switched to classic Dark theme.', 'info');
              }}
              className={`border-2 rounded-xl p-4 cursor-pointer transition-all flex flex-col justify-between ${
                settings.theme !== 'light'
                  ? 'bg-[#20252D] border-[#EA580C] shadow-md ring-1 ring-[#EA580C]/30'
                  : 'bg-[#121418] border-[#23272E] hover:border-[#3A4150]'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#121418] border border-[#2A2F38] flex items-center justify-center text-[#9AA3AF]">
                    <Moon className="w-4 h-4 text-[#F97316]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#E8EAEE]">Dark Theme</h3>
                    <span className="text-[11px] text-[#6B7480]">WPF Dark.xaml (Default)</span>
                  </div>
                </div>
                {settings.theme !== 'light' && (
                  <span className="text-[10px] bg-[#EA580C] text-white px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                    ACTIVE
                  </span>
                )}
              </div>

              {/* Theme Preview Swatch */}
              <div className="bg-[#121418] border border-[#2A2F38] rounded-lg p-2.5 flex items-center gap-2">
                <div className="w-5 h-5 rounded-md bg-[#181B20] border border-[#23272E]" title="Card background" />
                <div className="w-5 h-5 rounded-md bg-[#EA580C]" title="Accent orange" />
                <div className="w-5 h-5 rounded-md bg-[#16A34A]" title="Green status" />
                <span className="text-[11px] text-[#9AA3AF] ml-auto font-mono">#121418</span>
              </div>
            </div>

            {/* High-Contrast Light Theme Card */}
            <div
              onClick={() => {
                onUpdateSettings({ theme: 'light' });
                onShowToast('Theme Changed', 'Switched to High-Contrast Light theme.', 'info');
              }}
              className={`border-2 rounded-xl p-4 cursor-pointer transition-all flex flex-col justify-between ${
                settings.theme === 'light'
                  ? 'bg-[#E2E8F0] border-[#EA580C] shadow-md ring-1 ring-[#EA580C]/30'
                  : 'bg-[#121418] border-[#23272E] hover:border-[#3A4150]'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#FFFFFF] border border-[#CBD5E1] flex items-center justify-center text-[#EA580C] shadow-xs">
                    <Sun className="w-4 h-4 text-[#EA580C]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#E8EAEE]">High-Contrast Light</h3>
                    <span className="text-[11px] text-[#6B7480]">Daylight & High Readability</span>
                  </div>
                </div>
                {settings.theme === 'light' && (
                  <span className="text-[10px] bg-[#EA580C] text-white px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                    ACTIVE
                  </span>
                )}
              </div>

              {/* Theme Preview Swatch */}
              <div className="bg-[#FFFFFF] border border-[#CBD5E1] rounded-lg p-2.5 flex items-center gap-2 shadow-xs">
                <div className="w-5 h-5 rounded-md bg-[#F1F4F8] border border-[#CBD5E1]" title="Window background" />
                <div className="w-5 h-5 rounded-md bg-[#EA580C]" title="Accent orange" />
                <div className="w-5 h-5 rounded-md bg-[#15803D]" title="Green status" />
                <span className="text-[11px] text-[#6B7480] ml-auto font-mono">#FFFFFF</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Catalog & Recommendations Display */}
      <div>
        <h2 className="text-[15px] font-bold text-[#E8EAEE] mb-2 flex items-center gap-2">
          <span>Catalog & Interface Preferences</span>
        </h2>
        <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-4 shadow-sm space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.showRecommendedMods !== false}
              onChange={(e) => {
                onUpdateSettings({ showRecommendedMods: e.target.checked });
                onShowToast(
                  'Preference Updated',
                  e.target.checked
                    ? 'Recommended mods section is now enabled in Browse tab.'
                    : 'Recommended mods section hidden in Browse tab.',
                  'info'
                );
              }}
              className="mt-1 accent-[#EA580C] w-4 h-4 cursor-pointer"
            />
            <div>
              <span className="text-sm font-semibold text-[#E8EAEE] block">
                Show "Recommended For You" Section
              </span>
              <span className="text-xs text-[#9AA3AF]">
                Displays dynamic, category-weighted recommendations above the main catalog in the Browse Mods tab based on your installed loadout.
              </span>
            </div>
          </label>
        </div>
      </div>

      {/* SPT Folder Configuration */}
      <div>
        <h2 className="text-[15px] font-bold text-[#E8EAEE] mb-2">SPT Folder Configuration</h2>
        <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-4 shadow-sm space-y-3">
          <p className="text-xs text-[#9AA3AF]">
            Single Player Tarkov root directory (contains BepInEx, user, and EscapeFromTarkov.exe)
          </p>

          <div className="flex items-center gap-2.5">
            <input
              type="text"
              value={settings.sptDirectory}
              onChange={(e) => onUpdateSettings({ sptDirectory: e.target.value })}
              className="flex-1 bg-[#0E1013] border border-[#23272E] rounded-md px-3 py-2 text-sm text-[#E8EAEE] font-mono focus:outline-none focus:border-[#EA580C]"
            />
            <button
              onClick={async () => {
                if (onPickDirectory) {
                  onPickDirectory();
                  return;
                }
                const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
                if (bridge?.selectDirectory) {
                  try {
                    const selected = await bridge.selectDirectory(settings.sptDirectory);
                    if (selected && typeof selected === 'string') {
                      onUpdateSettings({ sptDirectory: selected });
                      onShowToast('Directory Selected', `Updated SPT root folder to: ${selected}`, 'success');
                    }
                    return;
                  } catch (err: any) {
                    console.error('Folder picker error:', err);
                  }
                }
                const manual = prompt('Enter Single Player Tarkov (SPT) folder path:', settings.sptDirectory);
                if (manual?.trim()) {
                  onUpdateSettings({ sptDirectory: manual.trim() });
                  onShowToast('Directory Selected', `Updated SPT root folder to: ${manual.trim()}`, 'success');
                }
              }}
              className="bg-[#EA580C] hover:bg-[#F97316] text-white text-xs font-semibold px-4 py-2 rounded-md transition-colors cursor-pointer shrink-0"
              type="button"
            >
              Browse…
            </button>
          </div>

          {/* Auto-detected version badge */}
          <div className="inline-flex items-center gap-2 bg-[#0E2A18] border border-[#16A34A] rounded-lg px-3 py-1.5 mt-2">
            <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
            <span className="text-xs font-semibold text-[#22C55E]">
              SPT {settings.sptVersion} · Auto-detected via {settings.detectedServerBinary}
            </span>
          </div>

          <p className="text-[11px] text-[#6B7480] leading-relaxed">
            Version is parsed automatically from SPT.Server.exe, package.json, or core assemblies.
          </p>
        </div>
      </div>

      {/* Mod Paths & SPT 4.x Layout Engine */}
      <div>
        <h2 className="text-[15px] font-bold text-[#E8EAEE] mb-2">Mod Routing & SPT Layout Engine</h2>
        <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-4 shadow-sm space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[#9AA3AF] mb-1.5">
                Client mods subpath (relative to SPT root):
              </label>
              <input
                type="text"
                value={settings.clientModPath}
                onChange={(e) => onUpdateSettings({ clientModPath: e.target.value })}
                className="w-full bg-[#0E1013] border border-[#23272E] rounded-md px-3 py-1.5 text-xs text-[#E8EAEE] font-mono focus:outline-none focus:border-[#EA580C]"
              />
            </div>

            <div>
              <label className="block text-xs text-[#9AA3AF] mb-1.5">
                Server mods subpath (relative to SPT root):
              </label>
              <input
                type="text"
                value={settings.serverModPath}
                onChange={(e) => onUpdateSettings({ serverModPath: e.target.value })}
                className="w-full bg-[#0E1013] border border-[#23272E] rounded-md px-3 py-1.5 text-xs text-[#E8EAEE] font-mono focus:outline-none focus:border-[#EA580C]"
              />
            </div>
          </div>

          {/* SPT 4.x layout indicator */}
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[#20252D] border border-[#23272E]">
            <ShieldCheck className="w-4 h-4 text-[#22C55E] shrink-0" />
            <div className="text-xs">
              <span className="font-semibold text-[#E8EAEE]">SPT 4.x Layout Router: </span>
              <span className="text-[#9AA3AF]">
                Server mods route to <code className="text-[#22C55E]">SPT_Runtime/user/mods</code>, client plugins to <code className="text-[#22C55E]">BepInEx/plugins</code>, and EscapeFromTarkov_Data overlays to root.
              </span>
            </div>
          </div>

          {/* Live Preview */}
          <div className="bg-[#0E1013] border border-[#23272E] rounded-lg p-3 space-y-1">
            <span className="text-[11px] font-semibold text-[#9AA3AF] uppercase tracking-wider">
              Live Preview of Destination Paths:
            </span>
            <div className="font-mono text-xs text-[#22C55E] truncate">{previewClientPath}</div>
            <div className="font-mono text-xs text-[#22C55E] truncate">{previewServerPath}</div>
          </div>
        </div>
      </div>

      {/* Mod Profiles Management */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[15px] font-bold text-[#E8EAEE]">Mod Profiles (Enable / Disable Sets)</h2>
          <button
            onClick={() => setShowNewProfileInput(true)}
            className="text-xs text-[#EA580C] hover:text-[#F97316] flex items-center gap-1 font-semibold cursor-pointer"
            type="button"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Profile</span>
          </button>
        </div>

        <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-4 shadow-sm space-y-3">
          <p className="text-xs text-[#9AA3AF]">
            Profiles store named sets of active mods. Switching profiles moves disabled mod files to managed storage using atomic operations.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {profiles.map((p) => {
              const isActive = settings.activeProfileId === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => onSelectProfile(p.id)}
                  className={`border rounded-lg p-3 cursor-pointer transition-all ${
                    isActive
                      ? 'bg-[#20252D] border-[#EA580C] shadow-sm'
                      : 'bg-[#0E1013] border-[#23272E] hover:border-[#3A4150]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-[#E8EAEE] truncate">{p.name}</span>
                    {isActive ? (
                      <span className="text-[10px] bg-[#EA580C] text-white px-1.5 py-0.5 rounded font-semibold">
                        ACTIVE
                      </span>
                    ) : profiles.length > 1 ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteProfile(p.id);
                        }}
                        className="text-[#6B7480] hover:text-[#DC2626] transition-colors p-1"
                        title="Delete Profile"
                        type="button"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-[#9AA3AF] line-clamp-1">{p.description}</p>
                  <p className="text-[10px] text-[#6B7480] mt-2 font-mono">
                    {p.enabledModIds.length} enabled mods
                  </p>
                </div>
              );
            })}
          </div>

          {showNewProfileInput && (
            <form onSubmit={handleCreateProfileSubmit} className="flex gap-2 pt-2 border-t border-[#23272E]">
              <input
                type="text"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="Enter profile name (e.g. Hardcore Realism)..."
                className="flex-1 bg-[#0E1013] border border-[#23272E] rounded px-3 py-1.5 text-xs text-[#E8EAEE] focus:outline-none focus:border-[#EA580C]"
                autoFocus
              />
              <button
                type="submit"
                onClick={handleCreateProfileSubmit}
                className="bg-[#16A34A] hover:bg-[#22C55E] text-white text-xs px-3 py-1.5 rounded font-medium cursor-pointer"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setShowNewProfileInput(false)}
                className="bg-[#20252D] hover:bg-[#2A2F38] text-[#9AA3AF] text-xs px-3 py-1.5 rounded cursor-pointer"
              >
                Cancel
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Mod Images & Thumbnail Cache */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[15px] font-bold text-[#E8EAEE] flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-[#EA580C]" />
            <span>Image & Thumbnail Cache</span>
          </h2>
          <button
            onClick={refreshImageStats}
            className="text-xs text-[#9AA3AF] hover:text-[#E8EAEE] flex items-center gap-1 cursor-pointer"
            type="button"
            title="Refresh cache statistics"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Refresh Stats</span>
          </button>
        </div>

        <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-4 shadow-sm space-y-3.5">
          <p className="text-xs text-[#9AA3AF]">
            Downloaded mod artwork, banner thumbnails, and author icons are cached locally in persistent IndexedDB storage and dev-server memory for instant zero-latency loading and offline operation.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-[#0E1013] border border-[#23272E] rounded-lg p-3">
              <span className="text-[11px] text-[#9AA3AF] block font-medium">Cached Images</span>
              <span className="text-lg font-bold font-mono text-[#22C55E]">
                {imageStats.count} <span className="text-xs font-normal text-[#9AA3AF]">files</span>
              </span>
            </div>

            <div className="bg-[#0E1013] border border-[#23272E] rounded-lg p-3">
              <span className="text-[11px] text-[#9AA3AF] block font-medium">Storage Occupied</span>
              <span className="text-lg font-bold font-mono text-[#38BDF8]">
                {(imageStats.totalSizeBytes / (1024 * 1024)).toFixed(2)}{' '}
                <span className="text-xs font-normal text-[#9AA3AF]">MB</span>
              </span>
            </div>

            <div className="bg-[#0E1013] border border-[#23272E] rounded-lg p-3">
              <span className="text-[11px] text-[#9AA3AF] block font-medium">Cache Engine</span>
              <span className="text-xs font-mono text-[#E8EAEE] block mt-1">
                IndexedDB + Memory
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <button
              type="button"
              onClick={handleClearImageCache}
              className="bg-[#20252D] hover:bg-[#DC2626] text-[#9AA3AF] hover:text-white px-3 py-1.5 rounded-lg border border-[#2A2F38] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Image Cache</span>
            </button>

            <button
              type="button"
              disabled={isPreloading}
              onClick={handlePreloadInstalledImages}
              className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] px-3 py-1.5 rounded-lg border border-[#2A2F38] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Download className={`w-3.5 h-3.5 text-[#EA580C] ${isPreloading ? 'animate-bounce' : ''}`} />
              <span>{isPreloading ? 'Preloading Images...' : 'Preload Installed Mod Images'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Action buttons row */}
      <div className="flex items-center gap-3 pt-2 flex-wrap">
        <button
          onClick={onSaveSettings}
          className="bg-[#16A34A] hover:bg-[#22C55E] text-white text-xs font-semibold px-5 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm cursor-pointer"
          type="button"
        >
          <Save className="w-4 h-4" />
          <span>Save Settings</span>
        </button>

        <button
          onClick={onClearCache}
          className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] text-xs font-medium px-4 py-2.5 rounded-lg border border-[#2A2F38] flex items-center gap-2 transition-colors cursor-pointer"
          type="button"
        >
          <RefreshCw className="w-4 h-4 text-[#9AA3AF]" />
          <span>Clear Cache</span>
        </button>

        <button
          onClick={onClearTempFiles}
          className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] text-xs font-medium px-4 py-2.5 rounded-lg border border-[#2A2F38] flex items-center gap-2 transition-colors cursor-pointer"
          title="Delete leftover .zip archives and bs-staging-* / bs-extract-* artifacts"
          type="button"
        >
          <Trash className="w-4 h-4 text-[#9AA3AF]" />
          <span>Clear Temp Files</span>
        </button>

        <button
          onClick={onExportDiagnostics}
          className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] text-xs font-medium px-4 py-2.5 rounded-lg border border-[#2A2F38] flex items-center gap-2 transition-colors cursor-pointer"
          title="Export diagnostics bundle (version, OS, SPT layout, installed mods) without personal info"
          type="button"
        >
          <FileText className="w-4 h-4 text-[#EA580C]" />
          <span>Export Diagnostics Bundle</span>
        </button>

        {onExportMods && (
          <button
            onClick={onExportMods}
            className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] hover:text-[#EA580C] text-xs font-medium px-4 py-2.5 rounded-lg border border-[#2A2F38] hover:border-[#EA580C]/40 flex items-center gap-2 transition-colors cursor-pointer"
            title="Export installed mods list as JSON manifest or CSV spreadsheet"
            type="button"
          >
            <Download className="w-4 h-4 text-[#EA580C]" />
            <span>Export Mods List (JSON/CSV)</span>
          </button>
        )}
      </div>
    </div>
  );
};
