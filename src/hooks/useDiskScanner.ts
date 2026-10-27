import { useState, useEffect, useCallback } from 'react';
import { InstalledMod, ModProfile, SettingsState } from '../types';
import { getDesktopBridge } from '../services/desktopBridgeService';
import { storageService } from '../services/storageService';
import { getKnownDependencyMeta } from '../data/knownDependencies';
import { ShowToastFn } from './useToastQueue';

interface UseDiskScannerParams {
  settings: SettingsState;
  onUpdateSettings: (partial: Partial<SettingsState>) => void;
  setInstalledMods: React.Dispatch<React.SetStateAction<InstalledMod[]>>;
  setProfiles: React.Dispatch<React.SetStateAction<ModProfile[]>>;
  setStatusText: (text: string) => void;
  showToast: ShowToastFn;
}

export function useDiskScanner({
  settings,
  onUpdateSettings,
  setInstalledMods,
  setProfiles,
  setStatusText,
  showToast,
}: UseDiskScannerParams) {
  const [isScanningMods, setIsScanningMods] = useState<boolean>(false);

  const handleRescanDirectory = useCallback(
    async (customPath?: string, showNotification = true) => {
      const rawTarget = (customPath ?? settings.sptDirectory ?? '').trim();
      if (!rawTarget) return;

      const bridge = getDesktopBridge();
      if (!bridge?.scanInstalledMods) {
        onUpdateSettings({ sptDirectory: rawTarget });
        if (showNotification) {
          showToast('SPT Directory Updated', `Active SPT path: ${rawTarget}`, 'info');
        }
        return;
      }

      setIsScanningMods(true);
      setStatusText(`Scanning SPT directory: ${rawTarget}...`);

      try {
        let resolvedPath = rawTarget;
        let detectedVersion: string | null = null;
        let detectedBinary: string | null = null;
        let activeServerModPath = settings.serverModPath || 'SPT/user/mods';
        let layoutWarningText: string | null = null;

        if (bridge.inspectSptDirectory) {
          try {
            const info = await bridge.inspectSptDirectory(rawTarget, {
              preferredSptVersion: settings.sptVersion,
              preferredServerModPath: settings.serverModPath,
            });
            if (info) {
              if (info.normalizedPath) resolvedPath = info.normalizedPath;
              const settingsPatch: Partial<SettingsState> = {
                sptDirectory: resolvedPath,
              };
              if (info.sptVersion) {
                settingsPatch.sptVersion = info.sptVersion;
                detectedVersion = info.sptVersion;
              }
              if (info.detectedServerBinary) {
                settingsPatch.detectedServerBinary = info.detectedServerBinary;
                detectedBinary = info.detectedServerBinary;
              }
              if (info.serverModPath) {
                // If layout is ambiguous and user already configured a valid serverModPath, preserve it
                if (info.layoutAmbiguous && settings.serverModPath) {
                  settingsPatch.serverModPath = settings.serverModPath;
                  activeServerModPath = settings.serverModPath;
                } else {
                  settingsPatch.serverModPath = info.serverModPath;
                  activeServerModPath = info.serverModPath;
                }
              }
              if (info.clientModPath) {
                settingsPatch.clientModPath = info.clientModPath;
              }
              if (typeof info.isSpt4xLayout === 'boolean') {
                settingsPatch.isSpt4xLayout = info.isSpt4xLayout;
              }
              if (info.layoutWarning) {
                layoutWarningText = info.layoutWarning;
              }
              onUpdateSettings(settingsPatch);
            }
          } catch (inspectErr) {
            console.warn('inspectSptDirectory warning:', inspectErr);
            onUpdateSettings({ sptDirectory: resolvedPath });
          }
        } else {
          onUpdateSettings({ sptDirectory: resolvedPath });
        }

        const diskMods = await bridge.scanInstalledMods({
          sptDirectory: resolvedPath,
          preferredServerModPath: activeServerModPath,
        });
        if (Array.isArray(diskMods)) {
          setInstalledMods((prev) => {
            const prevByKey = new Map<string, InstalledMod>();
            for (const pm of prev) {
              prevByKey.set(pm.id.toLowerCase(), pm);
              prevByKey.set(pm.name.toLowerCase(), pm);
              if (pm.inferredGuid) prevByKey.set(pm.inferredGuid.toLowerCase(), pm);
              if (pm.serverPath) prevByKey.set(pm.serverPath.toLowerCase(), pm);
              if (pm.clientPath) prevByKey.set(pm.clientPath.toLowerCase(), pm);
            }

            const enriched: InstalledMod[] = diskMods.map((dm, idx) => {
              const dmId = String(dm.id || `mod-${idx}`);
              const dmName = String(dm.name || dmId);
              const existing =
                prevByKey.get(dmId.toLowerCase()) ||
                (dm.inferredGuid ? prevByKey.get(String(dm.inferredGuid).toLowerCase()) : undefined) ||
                (dm.serverPath ? prevByKey.get(String(dm.serverPath).toLowerCase()) : undefined) ||
                (dm.clientPath ? prevByKey.get(String(dm.clientPath).toLowerCase()) : undefined) ||
                prevByKey.get(dmName.toLowerCase());

              const known =
                getKnownDependencyMeta(dm.inferredGuid) ||
                getKnownDependencyMeta(dmId) ||
                getKnownDependencyMeta(dmName);

              const resolvedServerPath = dm.serverPath || undefined;
              const resolvedClientPath = dm.clientPath || undefined;
              const inferredKindFromPaths =
                resolvedServerPath && resolvedClientPath
                  ? 'Both'
                  : resolvedServerPath
                  ? 'Server'
                  : resolvedClientPath
                  ? 'Client'
                  : undefined;

              const kind = inferredKindFromPaths || dm.kind || known?.kind || 'Client';

              return {
                id: dmId,
                name: dmName,
                version: dm.version || existing?.version || '1.0.0',
                kind,
                installDate: dm.installDate || existing?.installDate || new Date().toISOString().split('T')[0],
                isDisabled: Boolean(dm.isDisabled),
                serverPath: resolvedServerPath,
                clientPath: resolvedClientPath,
                clientPaths: dm.clientPaths,
                duplicateLocations: dm.duplicateLocations,
                inferredGuid: dm.inferredGuid ?? existing?.inferredGuid,
                isPatcher: dm.isPatcher ?? existing?.isPatcher,
                modId: dm.modId ?? existing?.modId ?? known?.id,
                author:
                  dm.author && dm.author !== 'Community Author' && dm.author !== 'Unknown'
                    ? dm.author
                    : existing?.author || known?.author || dm.author || 'Community Author',
                thumbnail: dm.thumbnail || existing?.thumbnail || known?.thumbnail,
                categoryTitle:
                  dm.categoryTitle ||
                  existing?.categoryTitle ||
                  known?.categoryTitle ||
                  (kind === 'Server' ? 'Server Mods' : kind === 'Both' ? 'Hybrid Mods' : 'Client Plugins'),
                teaser: dm.teaser || existing?.teaser || known?.teaser,
                loadOrder: typeof existing?.loadOrder === 'number' ? existing.loadOrder : idx + 1,
                tags: existing?.tags ?? [],
                dependencies: dm.dependencies?.length ? dm.dependencies : existing?.dependencies ?? [],
                configFiles:
                  Array.isArray(dm.configFiles) && dm.configFiles.length > 0
                    ? dm.configFiles
                    : existing?.configFiles ?? [],
                hasUpdate: existing?.hasUpdate ?? false,
                latestVersion: existing?.hasUpdate ? existing.latestVersion : dm.version || '1.0.0',
                latestVersionLink: existing?.latestVersionLink,
                latestVersionId: existing?.latestVersionId,
              };
            });

            storageService.saveInstalledMods(enriched);
            return enriched;
          });

          setProfiles((prevProfiles) => {
            const enabledIds = diskMods
              .filter((m) => !m.isDisabled && m.id)
              .map((m) => String(m.id));
            const updatedProfiles = prevProfiles.map((p) =>
              p.id === settings.activeProfileId
                ? { ...p, enabledModIds: enabledIds, updatedAt: Date.now() }
                : p
            );
            storageService.saveProfiles(updatedProfiles);
            return updatedProfiles;
          });

          if (layoutWarningText) {
            showToast('SPT Layout Warning', layoutWarningText, 'warning');
          }

          if (showNotification) {
            const verBadge = detectedVersion
              ? ` (SPT ${detectedVersion}${detectedBinary ? ` · ${detectedBinary}` : ''})`
              : '';
            showToast(
              'SPT Directory Synced',
              `Scanned ${resolvedPath}${verBadge}: ${diskMods.length} installed mod${
                diskMods.length === 1 ? '' : 's'
              } detected.`,
              'success'
            );
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed scanning SPT folder.';
        console.warn('Could not scan disk mods:', err);
        if (showNotification) {
          showToast('Directory Scan Error', message, 'error');
        }
      } finally {
        setIsScanningMods(false);
        setStatusText('Ready');
      }
    },
    [settings.sptDirectory, settings.activeProfileId, onUpdateSettings, setInstalledMods, setProfiles, setStatusText, showToast]
  );

  // Synchronize real mods from disk on launch if running in Electron desktop
  useEffect(() => {
    const bridge = getDesktopBridge();
    if (bridge?.scanInstalledMods && settings.sptDirectory) {
      handleRescanDirectory(settings.sptDirectory, false);
    }
  }, []);

  const handlePickDirectory = useCallback(async () => {
    // 1. Electron Desktop Native OS Folder Picker
    const bridge = getDesktopBridge();
    if (bridge?.selectDirectory) {
      try {
        const selected = await bridge.selectDirectory(settings.sptDirectory);
        if (selected && typeof selected === 'string') {
          await handleRescanDirectory(selected, true);
        }
        return;
      } catch (err) {
        console.error('Native folder picker error:', err);
      }
    }

    // 2. Modern Browser File System Access API
    if (typeof window !== 'undefined' && window.showDirectoryPicker) {
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
        if (dirHandle?.name) {
          const formatted = `C:\\Games\\${dirHandle.name}`;
          await handleRescanDirectory(formatted, true);
          return;
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }

    // 3. Web fallback prompt when outside Electron
    const manual = prompt(
      'Enter your Single Player Tarkov (SPT) root folder path (e.g. D:\\Games\\SPT-4.0):',
      settings.sptDirectory
    );
    if (manual?.trim()) {
      await handleRescanDirectory(manual.trim(), true);
    }
  }, [settings.sptDirectory, handleRescanDirectory]);

  return {
    isScanningMods,
    handleRescanDirectory,
    handlePickDirectory,
  };
}
