import React from 'react';
import { RefreshCw, CheckCircle2, ShieldCheck } from 'lucide-react';
import { SettingsState } from '../../types';
import { getDesktopBridge } from '../../services/desktopBridgeService';

interface SptDirectorySectionProps {
  settings: SettingsState;
  installedModCount: number;
  isScanningMods: boolean;
  onUpdateSettings: (newSettings: Partial<SettingsState>) => void;
  onPickDirectory?: () => void;
  onRescanMods?: (customPath?: string) => void;
  onShowToast: (title: string, message: string, type: 'success' | 'info' | 'warning' | 'error') => void;
}

export const SptDirectorySection: React.FC<SptDirectorySectionProps> = React.memo(({
  settings,
  installedModCount,
  isScanningMods,
  onUpdateSettings,
  onPickDirectory,
  onRescanMods,
  onShowToast,
}) => {
  const previewClientPath = `${settings.sptDirectory}\\${settings.clientModPath.replace(/\//g, '\\')}`;
  const previewServerPath = `${settings.sptDirectory}\\${settings.serverModPath.replace(/\//g, '\\')}`;

  return (
    <div className="space-y-6">
      {/* SPT Folder Configuration */}
      <div>
        <h2 className="text-[15px] font-bold text-[#E8EAEE] mb-2">SPT Folder Configuration</h2>
        <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-4 shadow-sm space-y-3">
          <p className="text-xs text-[#9AA3AF]">
            Single Player Tarkov root directory (contains BepInEx, user, and EscapeFromTarkov.exe)
          </p>

          <div className="flex items-center gap-2.5 flex-wrap">
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
              className="flex-1 min-w-[220px] bg-[#0E1013] border border-[#23272E] rounded-md px-3 py-2 text-sm text-[#E8EAEE] font-mono focus:outline-none focus:border-[#EA580C]"
            />
            <button
              onClick={async () => {
                if (onPickDirectory) {
                  onPickDirectory();
                  return;
                }
                const bridge = getDesktopBridge();
                if (bridge?.selectDirectory) {
                  try {
                    const selected = await bridge.selectDirectory(settings.sptDirectory);
                    if (selected && typeof selected === 'string') {
                      onUpdateSettings({ sptDirectory: selected });
                      if (onRescanMods) onRescanMods(selected);
                      onShowToast('Directory Selected', `Updated SPT root folder to: ${selected}`, 'success');
                    }
                    return;
                  } catch (err) {
                    console.error('Folder picker error:', err);
                  }
                }
                const manual = prompt('Enter Single Player Tarkov (SPT) folder path:', settings.sptDirectory);
                if (manual?.trim()) {
                  onUpdateSettings({ sptDirectory: manual.trim() });
                  if (onRescanMods) onRescanMods(manual.trim());
                  onShowToast('Directory Selected', `Updated SPT root folder to: ${manual.trim()}`, 'success');
                }
              }}
              className="bg-[#EA580C] hover:bg-[#F97316] text-white text-xs font-semibold px-4 py-2 rounded-md transition-colors cursor-pointer shrink-0"
              type="button"
            >
              Browse…
            </button>
            {onRescanMods && (
              <button
                onClick={() => onRescanMods(settings.sptDirectory)}
                disabled={isScanningMods}
                className="bg-[#20252D] hover:bg-[#2A2F38] border border-[#2B303C] text-[#E8EAEE] text-xs font-semibold px-3.5 py-2 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                type="button"
                title="Inspect SPT directory on disk, auto-detect SPT version, and rescan all installed mods"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#EA580C] ${isScanningMods ? 'animate-spin' : ''}`} />
                <span>{isScanningMods ? 'Scanning Disk...' : 'Rescan Mods'}</span>
              </button>
            )}
          </div>

          {/* Auto-detected version badge */}
          <div className="inline-flex items-center gap-2 bg-[#0E2A18] border border-[#16A34A] rounded-lg px-3 py-1.5 mt-2">
            <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
            <span className="text-xs font-semibold text-[#22C55E]">
              SPT {settings.sptVersion} · Auto-detected via {settings.detectedServerBinary || 'SPT.Server.exe'} ({installedModCount} mods on disk)
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
    </div>
  );
});

SptDirectorySection.displayName = 'SptDirectorySection';
