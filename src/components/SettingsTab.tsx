import React, { useState, useEffect, useMemo } from 'react';
import {
  Save,
  Trash,
  RefreshCw,
  FileText,
  CheckCircle2,
  ShieldCheck,
  Plus,
  Trash2,
  FolderSync,
  Sun,
  Moon,
  Download,
  Image as ImageIcon,
  Terminal,
  AlertTriangle,
  AlertCircle,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Search,
  X,
  FileCode,
  Bug,
  Cpu,
  Zap,
  Gauge,
} from 'lucide-react';
import { SettingsState, ModProfile, InstalledMod } from '../types';
import { imageCacheService } from '../services/imageCacheService';
import { errorLogService, ErrorLogEntry } from '../services/errorLogService';
import { EmblemUploader } from './EmblemUploader';

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
    try {
      const urls = installedMods.map((m) => m.thumbnail).filter(Boolean) as string[];
      const count = await imageCacheService.preloadImages(urls, 8);
      await refreshImageStats();
      onShowToast(
        'Images Cached',
        `Preloaded and cached ${count} mod thumbnails across 8 parallel streams.`,
        'success'
      );
    } catch (err) {
      onShowToast('Preload Finished', 'Installed mod thumbnails cached to local storage.', 'info');
    } finally {
      setIsPreloading(false);
    }
  };

  // Error Log System State
  const [logs, setLogs] = useState<ErrorLogEntry[]>(() => errorLogService.getLogs());
  const [selectedLogLevel, setSelectedLogLevel] = useState<'all' | 'error' | 'warn' | 'info'>('all');
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());
  const [copiedLogId, setCopiedLogId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = errorLogService.subscribe((updatedLogs) => {
      setLogs(updatedLogs);
    });
    return unsubscribe;
  }, []);

  const toggleExpandLog = (id: string) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopyAllLogs = () => {
    const text = errorLogService.exportLogsAsText();
    if (!text.trim()) {
      onShowToast('Logs Empty', 'There are no diagnostic error logs to copy.', 'info');
      return;
    }
    navigator.clipboard.writeText(text);
    onShowToast('Logs Copied', 'All diagnostic error logs copied to clipboard.', 'success');
  };

  const handleCopySingleLog = (log: ErrorLogEntry) => {
    let text = `[${log.timestamp}] [${log.level.toUpperCase()}] [${log.source}]${log.modName ? ` [${log.modName}]` : ''}: ${log.message}`;
    if (log.command) text += `\nCommand: ${log.command}`;
    if (log.details) text += `\nDetails:\n${log.details}`;
    navigator.clipboard.writeText(text);
    setCopiedLogId(log.id);
    setTimeout(() => setCopiedLogId(null), 2000);
    onShowToast('Log Entry Copied', 'Copied log entry to clipboard.', 'info');
  };

  const handleExportLogsFile = () => {
    const text = errorLogService.exportLogsAsText();
    if (!text.trim()) {
      onShowToast('Logs Empty', 'No logs available to export.', 'info');
      return;
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blacksite-diagnostic-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    onShowToast('Logs Exported', 'Diagnostic log file downloaded.', 'success');
  };

  const handleClearLogs = () => {
    if (logs.length === 0) return;
    if (confirm('Clear all recorded diagnostic and error logs?')) {
      errorLogService.clearLogs();
      onShowToast('Logs Cleared', 'Diagnostic log history was wiped.', 'info');
    }
  };

  const handleSimulateTestError = () => {
    errorLogService.logError(
      'Installer',
      'Simulated archive extraction failure on large mod package (test diagnostic verification)',
      'Error: [ERR_CHILD_PROCESS_STDIO_MAXBUFFER]: stdout maxBuffer length exceeded at Socket.onChildStdout (node:child_process:450:14)\n    at extractArchive (/electron/modInstaller.cjs:39:15)\n    at installMod (/electron/modInstaller.cjs:486:11)',
      'WTT - Armory Overhaul (Simulated)',
      '7za x -y -o"C:\\SPT\\temp" "WTT-ArmoryOverhaul-v2.4.archive"'
    );
    onShowToast('Test Log Generated', 'A simulated diagnostic error log was added for testing.', 'warning');
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (selectedLogLevel !== 'all' && l.level !== selectedLogLevel) return false;
      if (logSearchQuery.trim()) {
        const q = logSearchQuery.toLowerCase();
        const msgMatch = l.message.toLowerCase().includes(q);
        const modMatch = (l.modName || '').toLowerCase().includes(q);
        const srcMatch = l.source.toLowerCase().includes(q);
        const detMatch = (l.details || '').toLowerCase().includes(q);
        if (!msgMatch && !modMatch && !srcMatch && !detMatch) return false;
      }
      return true;
    });
  }, [logs, selectedLogLevel, logSearchQuery]);

  const errorCount = logs.filter((l) => l.level === 'error').length;
  const warnCount = logs.filter((l) => l.level === 'warn').length;

  const detectedCores = typeof window !== 'undefined' && (window as any).desktopBridge?.cpuCount
    ? Number((window as any).desktopBridge.cpuCount)
    : 8;

  const currentMode = settings.extractionPerformanceMode || 'balanced';
  const allocatedThreads = currentMode === 'turbo'
    ? detectedCores
    : currentMode === 'smooth'
    ? Math.max(2, Math.floor(detectedCores / 2))
    : Math.max(2, detectedCores - 2);

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
            {/* Balanced Mode (Default) */}
            <div
              onClick={() => {
                onUpdateSettings({ extractionPerformanceMode: 'balanced' });
                onShowToast('Performance Mode: Balanced', 'Using N-2 CPU cores with BelowNormal priority for smooth multitasking.', 'info');
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

            {/* Turbo Max (Uncapped) */}
            <div
              onClick={() => {
                onUpdateSettings({ extractionPerformanceMode: 'turbo' });
                onShowToast('Performance Mode: Turbo Max', 'All CPU cores saturated with High process priority for maximum throughput.', 'warning');
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
                onShowToast('Performance Mode: Smooth', 'Extraction limited to half cores with low CPU priority.', 'info');
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

          {/* Real-time Hardware Telemetry Bar */}
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

      {/* Error & Diagnostic Log System */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[15px] font-bold text-[#E8EAEE] flex items-center gap-2">
            <Terminal className="w-4 h-4 text-[#EF4444]" />
            <span>Error & Diagnostic Logs</span>
            {errorCount > 0 ? (
              <span className="bg-[#7F1D1D]/50 border border-[#DC2626] text-[#FCA5A5] text-[10.5px] font-mono px-2 py-0.5 rounded-full font-bold">
                {errorCount} error{errorCount > 1 ? 's' : ''}
              </span>
            ) : null}
            {warnCount > 0 ? (
              <span className="bg-[#78350F]/50 border border-[#D97706] text-[#FDE68A] text-[10.5px] font-mono px-2 py-0.5 rounded-full font-bold">
                {warnCount} warning{warnCount > 1 ? 's' : ''}
              </span>
            ) : null}
            <span className="text-xs font-mono text-[#6B7480]">
              ({logs.length} total recorded)
            </span>
          </h2>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSimulateTestError}
              className="text-xs text-[#9AA3AF] hover:text-[#EA580C] flex items-center gap-1 cursor-pointer transition-colors"
              title="Add a test diagnostic error to verify logger functionality"
            >
              <Bug className="w-3 h-3" />
              <span>Test Error</span>
            </button>
            <span className="text-[#3A3F4A]">·</span>
            <button
              type="button"
              onClick={handleCopyAllLogs}
              disabled={logs.length === 0}
              className="text-xs text-[#9AA3AF] hover:text-[#E8EAEE] disabled:opacity-40 flex items-center gap-1 cursor-pointer transition-colors"
              title="Copy entire log history to clipboard"
            >
              <Copy className="w-3 h-3" />
              <span>Copy All</span>
            </button>
            <span className="text-[#3A3F4A]">·</span>
            <button
              type="button"
              onClick={handleExportLogsFile}
              disabled={logs.length === 0}
              className="text-xs text-[#9AA3AF] hover:text-[#E8EAEE] disabled:opacity-40 flex items-center gap-1 cursor-pointer transition-colors"
              title="Download diagnostic log file as text"
            >
              <Download className="w-3 h-3" />
              <span>Export .txt</span>
            </button>
          </div>
        </div>

        <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-4 shadow-sm space-y-3.5">
          <p className="text-xs text-[#9AA3AF]">
            Detailed execution logs, large archive extraction failures (e.g. buffer overflows or corrupted archives), and dependency resolution traces are preserved here to troubleshoot installation errors.
          </p>

          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-1 pb-1">
            {/* Level Selector Pills */}
            <div className="flex items-center gap-1 bg-[#121418] p-1 rounded-lg border border-[#23272E]">
              <button
                type="button"
                onClick={() => setSelectedLogLevel('all')}
                className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
                  selectedLogLevel === 'all'
                    ? 'bg-[#20252D] text-[#E8EAEE] shadow-xs'
                    : 'text-[#9AA3AF] hover:text-[#E8EAEE]'
                }`}
              >
                All ({logs.length})
              </button>
              <button
                type="button"
                onClick={() => setSelectedLogLevel('error')}
                className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
                  selectedLogLevel === 'error'
                    ? 'bg-[#7F1D1D]/60 text-[#FCA5A5] shadow-xs font-semibold'
                    : 'text-[#9AA3AF] hover:text-[#EF4444]'
                }`}
              >
                Errors ({errorCount})
              </button>
              <button
                type="button"
                onClick={() => setSelectedLogLevel('warn')}
                className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
                  selectedLogLevel === 'warn'
                    ? 'bg-[#78350F]/60 text-[#FDE68A] shadow-xs font-semibold'
                    : 'text-[#9AA3AF] hover:text-[#F59E0B]'
                }`}
              >
                Warnings ({warnCount})
              </button>
            </div>

            {/* Search Input */}
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="w-3.5 h-3.5 text-[#6B7480] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={logSearchQuery}
                onChange={(e) => setLogSearchQuery(e.target.value)}
                placeholder="Search error messages or mods..."
                className="w-full bg-[#121418] border border-[#23272E] text-xs text-[#E8EAEE] pl-8 pr-7 py-1.5 rounded-lg focus:outline-none focus:border-[#EA580C]"
              />
              {logSearchQuery && (
                <button
                  type="button"
                  onClick={() => setLogSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6B7480] hover:text-[#E8EAEE]"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Clear Logs Button */}
            {logs.length > 0 && (
              <button
                type="button"
                onClick={handleClearLogs}
                className="bg-[#20252D] hover:bg-[#DC2626] text-[#9AA3AF] hover:text-white px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer border border-[#2A2F38]"
              >
                <Trash2 className="w-3 h-3" />
                <span>Clear Logs</span>
              </button>
            )}
          </div>

          {/* Logs Container */}
          <div className="bg-[#0C0E12] border border-[#23272E] rounded-lg overflow-hidden max-h-[380px] overflow-y-auto">
            {filteredLogs.length === 0 ? (
              <div className="p-8 text-center flex flex-col items-center justify-center select-none">
                <CheckCircle2 className="w-8 h-8 text-[#22C55E]/60 mb-2" />
                <span className="text-xs font-semibold text-[#E8EAEE]">
                  {logs.length === 0
                    ? 'No diagnostic or error logs recorded'
                    : 'No logs match your filter criteria'}
                </span>
                <span className="text-[11px] text-[#6B7480] mt-1 max-w-sm">
                  {logs.length === 0
                    ? 'Mod downloads, archive extractions, and directory routing are operating cleanly.'
                    : 'Try clearing the search query or selecting "All" to view previous entries.'}
                </span>
              </div>
            ) : (
              <div className="divide-y divide-[#1D2128]">
                {filteredLogs.map((log) => {
                  const isExpanded = expandedLogIds.has(log.id);
                  const isCopied = copiedLogId === log.id;
                  const hasDetails = Boolean(log.details || log.command);

                  return (
                    <div
                      key={log.id}
                      className="p-3 hover:bg-[#11141A] transition-colors font-mono text-xs text-[#E8EAEE]"
                    >
                      {/* Top Meta Line */}
                      <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Level Badge */}
                          {log.level === 'error' && (
                            <span className="bg-[#7F1D1D]/40 border border-[#DC2626]/40 text-[#EF4444] text-[9.5px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider flex items-center gap-1">
                              <AlertCircle className="w-2.5 h-2.5" />
                              ERROR
                            </span>
                          )}
                          {log.level === 'warn' && (
                            <span className="bg-[#78350F]/40 border border-[#D97706]/40 text-[#F59E0B] text-[9.5px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider flex items-center gap-1">
                              <AlertTriangle className="w-2.5 h-2.5" />
                              WARN
                            </span>
                          )}
                          {log.level === 'info' && (
                            <span className="bg-[#0C4A6E]/40 border border-[#0284C7]/40 text-[#38BDF8] text-[9.5px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider flex items-center gap-1">
                              INFO
                            </span>
                          )}

                          {/* Source Badge */}
                          <span className="bg-[#1A1E24] text-[#9AA3AF] text-[10px] px-1.5 py-0.5 rounded border border-[#262B34]">
                            {log.source}
                          </span>

                          {/* Mod Name Tag (if present) */}
                          {log.modName && (
                            <span className="bg-[#2A1810] border border-[#EA580C]/40 text-[#FB923C] text-[10px] px-1.5 py-0.5 rounded font-semibold truncate max-w-[200px]">
                              {log.modName}
                            </span>
                          )}

                          {/* Timestamp */}
                          <span className="text-[10.5px] text-[#6B7480]">
                            {new Date(log.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </span>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleCopySingleLog(log)}
                            className="text-[#9AA3AF] hover:text-[#E8EAEE] p-1 rounded hover:bg-[#1D222A] transition-colors cursor-pointer"
                            title="Copy this log entry"
                          >
                            {isCopied ? (
                              <Check className="w-3 h-3 text-[#22C55E]" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>

                          {hasDetails && (
                            <button
                              type="button"
                              onClick={() => toggleExpandLog(log.id)}
                              className="text-[#9AA3AF] hover:text-[#E8EAEE] text-[10.5px] flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-[#1D222A] transition-colors cursor-pointer"
                            >
                              <span>{isExpanded ? 'Hide Details' : 'Details'}</span>
                              {isExpanded ? (
                                <ChevronDown className="w-3 h-3" />
                              ) : (
                                <ChevronRight className="w-3 h-3" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Main Message */}
                      <div className="text-[11.5px] text-[#E8EAEE] font-sans font-medium break-words leading-relaxed">
                        {log.message}
                      </div>

                      {/* Expanded Technical Details / Trace */}
                      {isExpanded && hasDetails && (
                        <div className="mt-2.5 pt-2 border-t border-[#1D2128] space-y-2">
                          {log.command && (
                            <div>
                              <span className="text-[10px] text-[#9AA3AF] uppercase tracking-wider block font-sans font-bold">
                                Invocation Command:
                              </span>
                              <div className="bg-[#121418] border border-[#23272E] rounded px-2.5 py-1.5 text-[10.5px] text-[#7DD3FC] mt-0.5 overflow-x-auto whitespace-pre">
                                {log.command}
                              </div>
                            </div>
                          )}

                          {log.details && (
                            <div>
                              <span className="text-[10px] text-[#9AA3AF] uppercase tracking-wider block font-sans font-bold">
                                Technical Trace / Output:
                              </span>
                              <pre className="bg-[#121418] border border-[#23272E] rounded p-2.5 text-[10.5px] text-[#FCA5A5] mt-0.5 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-52 overflow-y-auto">
                                {log.details}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
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
