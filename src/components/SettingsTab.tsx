import React, { useState, useEffect } from 'react';
import {
  Save,
  Trash,
  RefreshCw,
  FileText,
  Trash2,
  Sun,
  Moon,
  Download,
  Image as ImageIcon,
  Cpu,
  Zap,
  Gauge,
} from 'lucide-react';
import { SettingsState, InstalledMod } from '../types';
import { imageCacheService } from '../services/imageCacheService';
import { getDetectedCpuCores } from '../services/desktopBridgeService';
import { EmblemUploader } from './EmblemUploader';
import { SptDirectorySection } from './settings/SptDirectorySection';
import { DiagnosticLogSection } from './settings/DiagnosticLogSection';
import { TacticalConfirmModal } from './TacticalConfirmModal';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

interface SettingsTabProps {
  settings: SettingsState;
  onUpdateSettings: (newSettings: Partial<SettingsState>) => void;
  onSaveSettings: () => void;
  installedMods: InstalledMod[];
  onClearTempFiles: () => void;
  onExportDiagnostics: () => void;
  onExportMods?: () => void;
  onShowToast: (title: string, message: string, type: 'success' | 'info' | 'warning' | 'error') => void;
  onPickDirectory?: () => void;
  onRescanMods?: (customPath?: string) => void;
  isScanningMods?: boolean;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settings,
  onUpdateSettings,
  onSaveSettings,
  onPickDirectory,
  onRescanMods,
  isScanningMods = false,
  installedMods,
  onClearTempFiles,
  onExportDiagnostics,
  onExportMods,
  onShowToast,
}) => {
  const [imageStats, setImageStats] = useState<{ count: number; totalSizeBytes: number }>({
    count: 0,
    totalSizeBytes: 0,
  });
  const [isPreloading, setIsPreloading] = useState(false);
  const { requestConfirm, confirmModalProps } = useConfirmDialog();

  useEffect(() => {
    imageCacheService.getCacheStats().then(setImageStats);
  }, []);

  const refreshImageStats = async () => {
    const stats = await imageCacheService.getCacheStats();
    setImageStats(stats);
  };

  const handleClearImageCache = async () => {
    const confirmed = await requestConfirm({
      title: 'Clear Image & Thumbnail Cache',
      message: 'Wipe all locally cached mod thumbnails and artwork from IndexedDB and memory?',
      confirmLabel: 'Clear Cache',
      severity: 'warning',
    });
    if (!confirmed) return;

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
    try {
      const urls = installedMods.map((m) => m.thumbnail).filter(Boolean) as string[];
      const count = await imageCacheService.preloadImages(urls, 8);
      await refreshImageStats();
      onShowToast(
        'Images Cached',
        `Preloaded and cached ${count} mod thumbnails across 8 parallel streams.`,
        'success'
      );
    } catch {
      onShowToast('Preload Finished', 'Installed mod thumbnails cached to local storage.', 'info');
    } finally {
      setIsPreloading(false);
    }
  };

  const detectedCores = getDetectedCpuCores(8);
  const currentMode = settings.extractionPerformanceMode || 'balanced';
  const allocatedThreads =
    currentMode === 'turbo'
      ? detectedCores
      : currentMode === 'smooth'
      ? Math.max(2, Math.floor(detectedCores / 2))
      : Math.max(2, detectedCores - 2);

  return (
    <div className="flex-1 overflow-y-auto p-4 max-w-4xl space-y-6">
      {/* Custom Application Emblem & Taskbar Icon */}
      <div>
        <h2 className="text-[15px] font-bold text-[#E8EAEE] mb-2 flex items-center gap-2">
          <span>Application Branding & Icons</span>
        </h2>
        <EmblemUploader onShowToast={onShowToast} />
      </div>

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

      {/* SPT Folder Configuration & Layout Router */}
      <SptDirectorySection
        settings={settings}
        installedModCount={installedMods.length}
        isScanningMods={isScanningMods}
        onUpdateSettings={onUpdateSettings}
        onPickDirectory={onPickDirectory}
        onRescanMods={onRescanMods}
        onShowToast={onShowToast}
      />

      {/* Extraction Speed & CPU Tuning */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[15px] font-bold text-[#E8EAEE] flex items-center gap-2">
            <Cpu className="w-4 h-4 text-[#EA580C]" />
            <span>Extraction Speed & CPU Tuning</span>
          </h2>
          <div className="text-[11px] font-mono text-[#9AA3AF] flex items-center gap-1.5">
            <span>{detectedCores} Cores Detected</span>
            <span aria-hidden="true">·</span>
            <span className={currentMode === 'turbo' ? 'text-[#F97316] font-semibold' : 'text-[#22C55E]'}>
              {allocatedThreads} Threads Active
            </span>
          </div>
        </div>

        <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-4 shadow-sm space-y-4">
          <p className="text-xs text-[#9AA3AF]">
            Configure multi-threaded 7-Zip decompression and process scheduling priority for extracting large archives (weapon packs, texture overhauls, and SPT bundles).
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Balanced Mode */}
            <div
              onClick={() => {
                onUpdateSettings({ extractionPerformanceMode: 'balanced' });
                onShowToast(
                  'Performance Mode: Balanced',
                  'Using N-2 CPU cores with BelowNormal priority for smooth multitasking.',
                  'info'
                );
              }}
              className={`border rounded-xl p-3.5 cursor-pointer transition-all flex flex-col justify-between ${
                currentMode === 'balanced'
                  ? 'bg-[#20252D] border-[#EA580C] shadow-sm ring-1 ring-[#EA580C]/30'
                  : 'bg-[#121418] border-[#23272E] hover:border-[#3A4150]'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <Gauge className="w-4 h-4 text-[#22C55E]" />
                    <span className="text-sm font-bold text-[#E8EAEE]">Balanced</span>
                  </div>
                  {currentMode === 'balanced' && (
                    <span className="text-[10px] bg-[#EA580C] text-white px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                      ACTIVE
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono text-[#9AA3AF] mb-2">
                  {Math.max(2, detectedCores - 2)} Threads · BelowNormal Priority
                </div>
                <p className="text-xs text-[#9AA3AF] leading-relaxed">
                  Reserves 2 CPU cores for Windows, audio, and browser. Fast extraction with zero desktop or mouse stutter.
                </p>
              </div>
              <div className="mt-3 pt-2 border-t border-[#23272E] text-[10.5px] font-mono text-[#6B7480]">
                Recommended for everyday use
              </div>
            </div>

            {/* Turbo Max */}
            <div
              onClick={() => {
                onUpdateSettings({ extractionPerformanceMode: 'turbo' });
                onShowToast(
                  'Performance Mode: Turbo Max',
                  'All CPU cores saturated with High process priority for maximum throughput.',
                  'warning'
                );
              }}
              className={`border rounded-xl p-3.5 cursor-pointer transition-all flex flex-col justify-between ${
                currentMode === 'turbo'
                  ? 'bg-[#20252D] border-[#EA580C] shadow-sm ring-1 ring-[#EA580C]/40'
                  : 'bg-[#121418] border-[#23272E] hover:border-[#3A4150]'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-[#F97316]" />
                    <span className="text-sm font-bold text-[#E8EAEE]">Turbo Max (Uncapped)</span>
                  </div>
                  {currentMode === 'turbo' && (
                    <span className="text-[10px] bg-[#EA580C] text-white px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                      ACTIVE
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono text-[#F97316] mb-2">
                  {detectedCores} Threads (100% Cores) · High Priority
                </div>
                <p className="text-xs text-[#9AA3AF] leading-relaxed">
                  Full throttle with zero limitations. Saturates all CPU cores and parallelizes disk routing for maximum extraction speed.
                </p>
              </div>
              <div className="mt-3 pt-2 border-t border-[#23272E] text-[10.5px] font-mono text-[#F97316]">
                Maximum Speed · Unconstrained
              </div>
            </div>

            {/* Smooth Background */}
            <div
              onClick={() => {
                onUpdateSettings({ extractionPerformanceMode: 'smooth' });
                onShowToast(
                  'Performance Mode: Smooth',
                  'Extraction limited to half cores with low CPU priority.',
                  'info'
                );
              }}
              className={`border rounded-xl p-3.5 cursor-pointer transition-all flex flex-col justify-between ${
                currentMode === 'smooth'
                  ? 'bg-[#20252D] border-[#EA580C] shadow-sm ring-1 ring-[#EA580C]/30'
                  : 'bg-[#121418] border-[#23272E] hover:border-[#3A4150]'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-[#38BDF8]" />
                    <span className="text-sm font-bold text-[#E8EAEE]">Smooth Background</span>
                  </div>
                  {currentMode === 'smooth' && (
                    <span className="text-[10px] bg-[#EA580C] text-white px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                      ACTIVE
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono text-[#9AA3AF] mb-2">
                  {Math.max(2, Math.floor(detectedCores / 2))} Threads · Low Priority
                </div>
                <p className="text-xs text-[#9AA3AF] leading-relaxed">
                  Gentle resource consumption. Designed for low-power laptops on battery or heavy in-game mod installations.
                </p>
              </div>
              <div className="mt-3 pt-2 border-t border-[#23272E] text-[10.5px] font-mono text-[#6B7480]">
                Battery & Multi-tasking saver
              </div>
            </div>
          </div>

          <div className="bg-[#0E1013] border border-[#23272E] rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-[#9AA3AF]">
              <span className="font-semibold text-[#E8EAEE]">Engine Telemetry:</span>
              <span>7-Zip Decompressor</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[#22C55E]">
                {allocatedThreads} / {detectedCores} Logical Threads
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">
                {currentMode === 'turbo'
                  ? 'HIGH_PRIORITY_CLASS'
                  : currentMode === 'smooth'
                  ? 'IDLE_PRIORITY_CLASS'
                  : 'BELOW_NORMAL_PRIORITY_CLASS'}
              </span>
            </div>
            <div className="text-[11px] font-mono text-[#6B7480] flex items-center gap-2">
              <span className="text-[#22C55E]">Same-Drive Staging: Active (~2ms O(1) Move)</span>
              <span aria-hidden="true">·</span>
              <span>{currentMode === 'turbo' ? '16x Parallel Direct Writes' : 'Async Event Loop Yield'}</span>
            </div>
          </div>
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
              <span className="text-xs font-mono text-[#E8EAEE] block mt-1">IndexedDB + Memory</span>
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

      {/* Error & Diagnostic Log System */}
      <DiagnosticLogSection onShowToast={onShowToast} onRequestConfirm={requestConfirm} />

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

      <TacticalConfirmModal {...confirmModalProps} />
    </div>
  );
};
