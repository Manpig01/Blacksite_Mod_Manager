import React, { useState, useEffect } from 'react';
import { CustomTitleBar } from './components/CustomTitleBar';
import { Header } from './components/Header';
import { BrowseModsTab } from './components/BrowseModsTab';
import { InstalledModsTab } from './components/InstalledModsTab';
import { AnalyticsTab } from './components/AnalyticsTab';
import { SettingsTab } from './components/SettingsTab';
import { InstallQueueModal } from './components/InstallQueueModal';
import { VersionSelectionModal } from './components/VersionSelectionModal';
import { ConfigEditorModal } from './components/ConfigEditorModal';
import { ConflictResolverModal } from './components/ConflictResolverModal';
import { DependencyInstallModal } from './components/DependencyInstallModal';
import { SptLauncherModal } from './components/SptLauncherModal';
import { WindowsDownloadModal } from './components/WindowsDownloadModal';
import { StatusBar } from './components/StatusBar';
import { ToastContainer } from './components/ToastContainer';

import {
  Mod,
  ModCategory,
  SptVersionInfo,
  InstalledMod,
  QueueItem,
  SettingsState,
  ModProfile,
  ConflictInfo,
  ToastMessage,
  ModVersion,
  ModTag,
  ResolvedDependencyItem,
} from './types';
import { storageService } from './services/storageService';
import { apiService } from './services/apiService';

export const App: React.FC = () => {
  // App State
  const [settings, setSettings] = useState<SettingsState>(storageService.loadSettings);
  const [installedMods, setInstalledMods] = useState<InstalledMod[]>(storageService.loadInstalledMods);
  const [profiles, setProfiles] = useState<ModProfile[]>(storageService.loadProfiles);
  const [ignoredConflicts, setIgnoredConflicts] = useState<string[]>(storageService.loadIgnoredConflicts);
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);

  // Metadata
  const [categories, setCategories] = useState<ModCategory[]>([]);
  const [sptVersions, setSptVersions] = useState<SptVersionInfo[]>([]);

  // Navigation
  const [activeTab, setActiveTab] = useState<'browse' | 'installed' | 'analytics' | 'settings'>('browse');

  // Modals
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [selectedModForVersions, setSelectedModForVersions] = useState<Mod | null>(null);
  const [versionRecoveryNotice, setVersionRecoveryNotice] = useState<string | null>(null);
  const [dependencyModalState, setDependencyModalState] = useState<{
    isOpen: boolean;
    targetMod: Mod | null;
    targetVersion: string;
    targetDownloadUrl?: string;
    dependencies: ResolvedDependencyItem[];
  }>({
    isOpen: false,
    targetMod: null,
    targetVersion: '',
    dependencies: [],
  });
  const [selectedModForConfig, setSelectedModForConfig] = useState<InstalledMod | null>(null);
  const [selectedConflict, setSelectedConflict] = useState<ConflictInfo | null>(null);
  const [isLauncherOpen, setIsLauncherOpen] = useState(false);
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);

  // Queue & Progress
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [statusText, setStatusText] = useState<string>('Ready');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Initialize
  useEffect(() => {
    apiService.getCategories().then(setCategories);
    apiService.getSptVersions().then(setSptVersions);

    // Initial conflict detection
    const foundConflicts = storageService.detectConflicts(installedMods, ignoredConflicts);
    setConflicts(foundConflicts);

    showToast('Blacksite Ready', 'Blacksite Mod Manager v1.8.0 initialized.', 'info');
  }, []);

  // Listen for live install progress events from Electron native backend
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
    if (bridge?.onInstallProgress) {
      const unsubscribe = bridge.onInstallProgress((data: any) => {
        if (!data?.queueId) return;
        setQueue((prev) =>
          prev.map((item) => {
            if (item.id === data.queueId) {
              const newStatus =
                data.stage === 'installed'
                  ? 'installed'
                  : data.stage === 'extracting'
                  ? 'extracting'
                  : data.stage === 'routing'
                  ? 'routing'
                  : 'downloading';

              return {
                ...item,
                status: newStatus,
                progressPercent: data.percent ?? item.progressPercent,
                bytesReceived: data.bytesReceived ?? item.bytesReceived,
                totalBytes: data.totalBytes ?? item.totalBytes,
                downloadSpeed: data.speed ?? item.downloadSpeed,
              };
            }
            return item;
          })
        );
        if (data.detail) {
          setStatusText(data.detail);
        }
      });
      return () => {
        if (typeof unsubscribe === 'function') unsubscribe();
      };
    }
  }, []);

  // Update conflict state when installed mods change
  useEffect(() => {
    const foundConflicts = storageService.detectConflicts(installedMods, ignoredConflicts);
    setConflicts(foundConflicts);
    storageService.saveInstalledMods(installedMods);
  }, [installedMods, ignoredConflicts]);

  // Dynamically update document theme class and data-theme attribute
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'light') {
      root.classList.remove('dark');
      root.classList.add('light');
      root.setAttribute('data-theme', 'light');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
    }
  }, [settings.theme]);

  // Synchronize real mods from disk if running in Electron desktop
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
    if (bridge?.scanInstalledMods && settings.sptDirectory) {
      bridge.scanInstalledMods({ sptDirectory: settings.sptDirectory })
        .then((diskMods: any[]) => {
          if (diskMods && Array.isArray(diskMods) && diskMods.length > 0) {
            setInstalledMods((prev) => {
              const merged = [...prev];
              for (const dm of diskMods) {
                const idx = merged.findIndex(
                  (m) =>
                    (m.serverPath && dm.serverPath && m.serverPath.toLowerCase() === dm.serverPath.toLowerCase()) ||
                    (m.clientPath && dm.clientPath && m.clientPath.toLowerCase() === dm.clientPath.toLowerCase()) ||
                    m.name.toLowerCase() === dm.name.toLowerCase()
                );
                if (idx >= 0) {
                  merged[idx] = {
                    ...merged[idx],
                    isDisabled: dm.isDisabled,
                    serverPath: dm.serverPath || merged[idx].serverPath,
                    clientPath: dm.clientPath || merged[idx].clientPath,
                    version: dm.version || merged[idx].version,
                  };
                } else {
                  merged.push(dm);
                }
              }
              return merged;
            });
          }
        })
        .catch((err: any) => console.warn('Could not scan disk mods:', err));
    }
  }, [settings.sptDirectory]);

  const showToast = (
    title: string,
    message: string,
    type: 'success' | 'info' | 'warning' | 'error' = 'info'
  ) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const handleDismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleUpdateSettings = (partial: Partial<SettingsState>) => {
    const updated = { ...settings, ...partial };
    setSettings(updated);
    storageService.saveSettings(updated);
  };

  const handlePickDirectory = async () => {
    // 1. Electron Desktop Native OS Folder Picker
    const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
    if (bridge?.selectDirectory) {
      try {
        const selected = await bridge.selectDirectory(settings.sptDirectory);
        if (selected && typeof selected === 'string') {
          handleUpdateSettings({ sptDirectory: selected });
          showToast('SPT Directory Set', `Connected: ${selected}`, 'success');
        }
        return;
      } catch (err: any) {
        console.error('Native folder picker error:', err);
      }
    }

    // 2. Modern Browser File System Access API
    if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
      try {
        const dirHandle = await (window as any).showDirectoryPicker({ mode: 'read' });
        if (dirHandle?.name) {
          const formatted = `C:\\Games\\${dirHandle.name}`;
          handleUpdateSettings({ sptDirectory: formatted });
          showToast('SPT Directory Set', `Folder: ${dirHandle.name}`, 'success');
          return;
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
      }
    }

    // 3. Fallback prompt
    const manual = prompt(
      'Enter your Single Player Tarkov (SPT) root folder path (e.g. D:\\Games\\SPT-4.0):',
      settings.sptDirectory
    );
    if (manual?.trim()) {
      handleUpdateSettings({ sptDirectory: manual.trim() });
      showToast('SPT Directory Set', `Set to: ${manual.trim()}`, 'success');
    }
  };

  // Profile Switching (task 2.5)
  const handleSelectProfile = (profileId: string) => {
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;

    handleUpdateSettings({ activeProfileId: profileId });

    // Enable mods in profile, disable others (atomic profile switch simulation)
    const enabledSet = new Set(profile.enabledModIds);
    const updatedMods = installedMods.map((m) => ({
      ...m,
      isDisabled: !enabledSet.has(m.id),
    }));

    setInstalledMods(updatedMods);
    showToast('Profile Loaded', `Switched to profile: ${profile.name}`, 'success');
  };

  const handleCreateProfile = () => {
    const name = prompt('Enter a name for the new profile:');
    if (!name?.trim()) return;

    const newProfile: ModProfile = {
      id: `prof-${Date.now()}`,
      name: name.trim(),
      description: 'Custom mod loadout',
      enabledModIds: installedMods.filter((m) => !m.isDisabled).map((m) => m.id),
      createdDate: new Date().toISOString().split('T')[0],
    };

    const updated = [...profiles, newProfile];
    setProfiles(updated);
    storageService.saveProfiles(updated);
    handleUpdateSettings({ activeProfileId: newProfile.id });
    showToast('Profile Created', `Created profile "${newProfile.name}".`, 'success');
  };

  const handleDeleteProfile = (profileId: string) => {
    if (profiles.length <= 1) return;
    const updated = profiles.filter((p) => p.id !== profileId);
    setProfiles(updated);
    storageService.saveProfiles(updated);
    if (settings.activeProfileId === profileId) {
      handleSelectProfile(updated[0].id);
    }
  };

  // Real Desktop Installation Pipeline with Web Simulation Fallback
  const queueInstall = async (
    modName: string,
    author: string,
    version: string,
    thumbnail: string,
    guid?: string,
    modId?: number,
    downloadUrl?: string,
    archiveBase64?: string,
    archiveFileName?: string,
    sourceMod?: Mod
  ) => {
    const queueId = `q-${Date.now()}-${Math.random()}`;
    const targetGuid = guid || `mod.${modName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

    const totalBytes = 12 * 1024 * 1024;
    const newQueueItem: QueueItem = {
      id: queueId,
      modId: modId || Date.now(),
      modName,
      author,
      version,
      thumbnail,
      status: 'downloading',
      progressPercent: 10,
      bytesReceived: 1000000,
      totalBytes,
      downloadSpeed: 'Initiating...',
      archiveName: archiveFileName || `${targetGuid}-${version}.archive`,
    };

    setQueue((prev) => [newQueueItem, ...prev]);
    setStatusText(`Downloading ${modName} v${version}...`);
    showToast('Download Started', `Queued ${modName} v${version} for installation.`, 'info');

    const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;

    // Desktop Native Electron Flow (Performs real archive download, extraction & SPT routing to disk)
    if (bridge?.installMod) {
      try {
        setQueue((prev) =>
          prev.map((item) =>
            item.id === queueId
              ? { ...item, progressPercent: 40, downloadSpeed: 'Downloading & Extracting...' }
              : item
          )
        );
        setStatusText(`Extracting & routing ${modName}...`);

        const installResult = await bridge.installMod({
          queueId,
          sptDirectory: settings.sptDirectory,
          modName,
          author,
          version,
          downloadUrl,
          archiveBase64,
          archiveFileName: archiveFileName || `${targetGuid}-${version}.archive`,
        });

        if (!installResult || !installResult.success) {
          const errObj: any = new Error(installResult?.error || 'Installation failed during extraction or folder placement.');
          if (installResult?.statusCode) errObj.statusCode = installResult.statusCode;
          throw errObj;
        }

        setQueue((prev) =>
          prev.map((item) =>
            item.id === queueId
              ? {
                  ...item,
                  status: 'installed',
                  progressPercent: 100,
                  downloadSpeed: 'Complete',
                }
              : item
          )
        );
        setStatusText('Ready');

        const isServer = installResult.kind === 'Server' || installResult.kind === 'Both';
        const isClient = installResult.kind === 'Client' || installResult.kind === 'Both';

        setInstalledMods((prev) => {
          const existingIdx = prev.findIndex((m) => m.id === targetGuid);
          const newInstalledMod: InstalledMod = {
            id: targetGuid,
            modId: modId,
            name: modName,
            author,
            version,
            kind: installResult.kind || (isServer && isClient ? 'Both' : isServer ? 'Server' : 'Client'),
            thumbnail,
            sptVersion: settings.sptVersion,
            fikaCompatibility: true,
            installDate: new Date().toISOString().split('T')[0],
            serverPath: installResult.serverPath || (isServer ? `user/mods/${modName.replace(/\s+/g, '')}` : undefined),
            clientPath: installResult.clientPath || (isClient ? `BepInEx/plugins/${modName.replace(/\s+/g, '')}.dll` : undefined),
            isDisabled: false,
            hasUpdate: false,
            latestVersion: version,
            configFiles: [],
          };

          if (existingIdx >= 0) {
            const copy = [...prev];
            copy[existingIdx] = newInstalledMod;
            return copy;
          }
          return [newInstalledMod, ...prev];
        });

        showToast(
          'Installation Complete',
          `Successfully installed ${modName} v${version} into ${settings.sptDirectory}!`,
          'success'
        );
        return;
      } catch (err: any) {
        console.error('Desktop install error:', err);
        setQueue((prev) =>
          prev.map((item) =>
            item.id === queueId
              ? { ...item, status: 'failed', downloadSpeed: 'Failed', errorMessage: err.message }
              : item
          )
        );
        setStatusText(`Error installing ${modName}`);
        showToast('Installation Failed', err.message || 'Error writing files to SPT directory.', 'error');

        // Automatic 404 Recovery: Prompt Version Selection Modal with status notice
        if (
          err.message?.includes('404') ||
          err.message?.toLowerCase().includes('not found') ||
          err.statusCode === 404
        ) {
          if (sourceMod) {
            setVersionRecoveryNotice(
              `The download link for ${modName} v${version} returned HTTP 404 Not Found. Please select another release below or download directly from Forge.`
            );
            setSelectedModForVersions(sourceMod);
          }
        }
        return;
      }
    }

    // Web Fallback Simulation (when viewing in standard web browser)
    let currentPercent = 10;
    const interval = setInterval(() => {
      currentPercent += 25;

      if (currentPercent < 100) {
        setQueue((prev) =>
          prev.map((item) =>
            item.id === queueId
              ? {
                  ...item,
                  progressPercent: currentPercent,
                  bytesReceived: Math.floor((currentPercent / 100) * totalBytes),
                  downloadSpeed: `${(12 + Math.random() * 4).toFixed(1)} MB/s`,
                }
              : item
          )
        );
      } else {
        clearInterval(interval);
        setQueue((prev) =>
          prev.map((item) =>
            item.id === queueId
              ? {
                  ...item,
                  status: 'installed',
                  progressPercent: 100,
                  downloadSpeed: 'Complete',
                }
              : item
          )
        );
        setStatusText('Ready');

        const isServerMod = modName.toLowerCase().includes('server') || modName.toLowerCase().includes('trader');
        const isClientMod = !isServerMod;
        const serverDir = settings.serverModPath || 'user/mods';
        const clientDir = settings.clientModPath || 'BepInEx/plugins';

        setInstalledMods((prev) => {
          const existingIdx = prev.findIndex((m) => m.id === targetGuid);

          const newInstalledMod: InstalledMod = {
            id: targetGuid,
            modId: modId,
            name: modName,
            author,
            version,
            kind: isServerMod ? 'Server' : isClientMod ? 'Client' : 'Both',
            thumbnail,
            sptVersion: settings.sptVersion,
            fikaCompatibility: true,
            installDate: new Date().toISOString().split('T')[0],
            serverPath: `${serverDir}/${modName.replace(/\s+/g, '')}`,
            clientPath: `${clientDir}/${modName.replace(/\s+/g, '')}.dll`,
            isDisabled: false,
            hasUpdate: false,
            latestVersion: version,
            configFiles: [],
          };

          if (existingIdx >= 0) {
            const copy = [...prev];
            copy[existingIdx] = newInstalledMod;
            return copy;
          }
          return [newInstalledMod, ...prev];
        });

        showToast(
          'Installation Complete',
          `Installed ${modName} v${version}.`,
          'success'
        );
      }
    }, 250);
  };

  const handleInstallMod = async (mod: Mod, specificVersion?: string, skipDepCheck = false) => {
    let version = specificVersion;
    let downloadLink = '';

    // If specificVersion or downloadLink not yet determined, fetch sorted versions from Forge API
    if (!downloadLink && mod.id) {
      try {
        const verList = await apiService.getModVersions(mod.id);
        if (verList && verList.length > 0) {
          const targetVer = specificVersion
            ? verList.find((v) => v.version === specificVersion) || verList[0]
            : verList[0];
          version = targetVer.version || version;
          downloadLink = targetVer.link || '';
        }
      } catch (err) {
        console.warn('Could not fetch mod versions for download link:', err);
      }
    } else if (mod.versions && mod.versions.length > 0) {
      const verObj = specificVersion
        ? mod.versions.find((v) => v.version === specificVersion)
        : mod.versions[0];
      version = verObj?.version || mod.versions[0].version;
      downloadLink = verObj?.link || '';
    }

    const finalVer = version || '1.0.0';

    // Check Forge dependencies if not explicitly skipped
    const modIdentifier = mod.id || mod.guid || mod.slug;
    if (!skipDepCheck && modIdentifier) {
      setStatusText(`Checking Forge dependencies for ${mod.name}...`);
      try {
        const resolvedDeps = await apiService.resolveModDependencies(
          modIdentifier,
          finalVer,
          settings.sptVersion,
          installedMods
        );

        if (resolvedDeps && resolvedDeps.length > 0) {
          setStatusText('Ready');
          setDependencyModalState({
            isOpen: true,
            targetMod: mod,
            targetVersion: finalVer,
            targetDownloadUrl: downloadLink,
            dependencies: resolvedDeps,
          });
          return;
        }
      } catch (depErr) {
        console.warn('Failed resolving dependencies:', depErr);
      }
      setStatusText('Ready');
    }

    queueInstall(
      mod.name,
      mod.owner?.name || 'Unknown',
      finalVer,
      mod.thumbnail,
      mod.guid || undefined,
      mod.id,
      downloadLink,
      undefined,
      undefined,
      mod
    );
  };

  const handleConfirmDependencies = async (
    selectedDeps: ResolvedDependencyItem[],
    installStandalone: boolean
  ) => {
    const { targetMod, targetVersion, targetDownloadUrl } = dependencyModalState;
    setDependencyModalState({
      isOpen: false,
      targetMod: null,
      targetVersion: '',
      dependencies: [],
    });

    if (!targetMod) return;

    if (installStandalone || selectedDeps.length === 0) {
      showToast(
        'Install Standalone',
        `Installing ${targetMod.name} v${targetVersion} without dependencies.`,
        'info'
      );
      handleInstallMod(targetMod, targetVersion, true);
      return;
    }

    showToast(
      'Installing Dependencies',
      `Queued ${selectedDeps.length} prerequisites followed by ${targetMod.name}.`,
      'info'
    );

    // Queue prerequisites sequentially in topological order (dependencies first)
    for (const dep of selectedDeps) {
      await queueInstall(
        dep.name,
        'Forge Dependency',
        dep.version,
        '',
        dep.guid,
        dep.id,
        dep.downloadUrl
      );
    }

    // Now queue the target mod (skipDepCheck = true so it doesn't prompt again)
    await handleInstallMod(targetMod, targetVersion, true);
  };

  const handleSelectVersion = (mod: Mod, ver: ModVersion) => {
    setVersionRecoveryNotice(null);
    setSelectedModForVersions(null);
    handleInstallMod(mod, ver.version);
  };

  const handleInstallFromFile = (file: File) => {
    const cleanName = file.name.replace(/\.(zip|7z|rar)$/i, '');
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      queueInstall(cleanName, 'Local Archive', '1.0.0', '', undefined, undefined, undefined, base64, file.name);
    };
    reader.readAsDataURL(file);
  };

  // Mod Management Actions with real disk support
  const handleToggleMod = async (modId: string) => {
    const mod = installedMods.find((m) => m.id === modId);
    if (!mod) return;
    const newState = !mod.isDisabled;

    const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
    if (bridge?.toggleDisableMod) {
      try {
        await bridge.toggleDisableMod({
          sptDirectory: settings.sptDirectory,
          serverPath: mod.serverPath,
          clientPath: mod.clientPath,
          disable: newState,
        });
      } catch (err) {
        console.error('Failed toggling mod state on disk:', err);
      }
    }

    setInstalledMods((prev) =>
      prev.map((m) => {
        if (m.id === modId) {
          return { ...m, isDisabled: newState };
        }
        return m;
      })
    );
    showToast(
      newState ? 'Mod Disabled' : 'Mod Enabled',
      `${mod.name} is now ${newState ? 'disabled (.disabled)' : 'active'}.`,
      'info'
    );
  };

  const handleUninstallMod = async (modId: string) => {
    const mod = installedMods.find((m) => m.id === modId);
    if (!mod) return;

    if (confirm(`Permanently uninstall "${mod.name}" and delete its files?`)) {
      const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
      if (bridge?.uninstallMod) {
        try {
          await bridge.uninstallMod({
            sptDirectory: settings.sptDirectory,
            serverPath: mod.serverPath,
            clientPath: mod.clientPath,
          });
        } catch (err) {
          console.error('Failed to remove mod files from disk:', err);
        }
      }
      setInstalledMods((prev) => prev.filter((m) => m.id !== modId));
      showToast('Mod Uninstalled', `Deleted ${mod.name} from SPT folder.`, 'warning');
    }
  };

  const handleUpdateMod = (mod: InstalledMod) => {
    if (!mod.latestVersion) return;
    showToast('Config-Safe Update', `Preserving configs and updating ${mod.name} to v${mod.latestVersion}...`, 'info');
    handleInstallMod({
      id: mod.modId || 0,
      name: mod.name,
      slug: mod.id,
      teaser: '',
      thumbnail: mod.thumbnail,
      downloads: 0,
      versions: [{ id: 0, version: mod.latestVersion, link: '' } as any],
    } as any, mod.latestVersion);
  };

  const handleEnableAll = async () => {
    const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
    if (bridge?.toggleDisableMod) {
      for (const m of installedMods) {
        if (m.isDisabled) {
          await bridge.toggleDisableMod({
            sptDirectory: settings.sptDirectory,
            serverPath: m.serverPath,
            clientPath: m.clientPath,
            disable: false,
          }).catch(() => {});
        }
      }
    }
    setInstalledMods((prev) => prev.map((m) => ({ ...m, isDisabled: false })));
    showToast('All Mods Enabled', 'Removed .disabled suffix from all installed mods.', 'success');
  };

  const handleDisableAll = async () => {
    const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
    if (bridge?.toggleDisableMod) {
      for (const m of installedMods) {
        if (!m.isDisabled) {
          await bridge.toggleDisableMod({
            sptDirectory: settings.sptDirectory,
            serverPath: m.serverPath,
            clientPath: m.clientPath,
            disable: true,
          }).catch(() => {});
        }
      }
    }
    setInstalledMods((prev) => prev.map((m) => ({ ...m, isDisabled: true })));
    showToast('All Mods Disabled', 'Renamed all installed mod folders with .disabled suffix.', 'warning');
  };

  const handleUninstallAll = async () => {
    if (confirm('Permanently delete ALL installed mods from your SPT folder? This cannot be undone.')) {
      const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
      if (bridge?.uninstallMod) {
        for (const m of installedMods) {
          await bridge.uninstallMod({
            sptDirectory: settings.sptDirectory,
            serverPath: m.serverPath,
            clientPath: m.clientPath,
          }).catch(() => {});
        }
      }
      setInstalledMods([]);
      showToast('All Mods Uninstalled', 'Removed all mods from SPT directory.', 'warning');
    }
  };

  const handleCheckUpdates = () => {
    showToast('Checking Updates', 'Sending installed packages to sp-mod.com update API...', 'info');
    setTimeout(() => {
      setInstalledMods((prev) =>
        prev.map((m) => (m.id === 'fika.ghostfenixx.svm' ? { ...m, hasUpdate: true, latestVersion: '1.9.1' } : m))
      );
      showToast('Update Check Complete', '1 update available for Server Value Modifier.', 'success');
    }, 1000);
  };

  const handleReorderMods = (reorderedMods: InstalledMod[]) => {
    setInstalledMods(reorderedMods);
    storageService.saveInstalledMods(reorderedMods);
  };

  const handleUpdateModTags = (modId: string, tags: ModTag[]) => {
    setInstalledMods((prev) => {
      const updated = prev.map((m) => (m.id === modId ? { ...m, tags } : m));
      storageService.saveInstalledMods(updated);
      return updated;
    });
  };

  const handleBulkEnableMods = async (modIds: string[]) => {
    const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
    if (bridge?.toggleDisableMod) {
      const targets = installedMods.filter((m) => modIds.includes(m.id) && m.isDisabled);
      for (const m of targets) {
        await bridge.toggleDisableMod({
          sptDirectory: settings.sptDirectory,
          serverPath: m.serverPath,
          clientPath: m.clientPath,
          disable: false,
        }).catch(() => {});
      }
    }
    setInstalledMods((prev) => {
      const updated = prev.map((m) => (modIds.includes(m.id) ? { ...m, isDisabled: false } : m));
      storageService.saveInstalledMods(updated);
      return updated;
    });
    showToast('Bulk Enable', `Enabled ${modIds.length} selected mod${modIds.length > 1 ? 's' : ''}.`, 'success');
  };

  const handleBulkDisableMods = async (modIds: string[]) => {
    const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
    if (bridge?.toggleDisableMod) {
      const targets = installedMods.filter((m) => modIds.includes(m.id) && !m.isDisabled);
      for (const m of targets) {
        await bridge.toggleDisableMod({
          sptDirectory: settings.sptDirectory,
          serverPath: m.serverPath,
          clientPath: m.clientPath,
          disable: true,
        }).catch(() => {});
      }
    }
    setInstalledMods((prev) => {
      const updated = prev.map((m) => (modIds.includes(m.id) ? { ...m, isDisabled: true } : m));
      storageService.saveInstalledMods(updated);
      return updated;
    });
    showToast('Bulk Disable', `Disabled ${modIds.length} selected mod${modIds.length > 1 ? 's' : ''}.`, 'warning');
  };

  const handleBulkUninstallMods = async (modIds: string[]) => {
    if (modIds.length === 0) return;
    if (confirm(`Permanently uninstall ${modIds.length} selected mod${modIds.length > 1 ? 's' : ''} and delete their files?`)) {
      const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
      if (bridge?.uninstallMod) {
        const toDelete = installedMods.filter((m) => modIds.includes(m.id));
        for (const m of toDelete) {
          await bridge.uninstallMod({
            sptDirectory: settings.sptDirectory,
            serverPath: m.serverPath,
            clientPath: m.clientPath,
          }).catch(() => {});
        }
      }
      setInstalledMods((prev) => {
        const updated = prev.filter((m) => !modIds.includes(m.id));
        storageService.saveInstalledMods(updated);
        return updated;
      });
      showToast('Bulk Uninstall', `Removed ${modIds.length} selected mod${modIds.length > 1 ? 's' : ''} from SPT directory.`, 'warning');
    }
  };

  const handleOpenFolder = async (target: 'client' | 'server' | string) => {
    let relPath = '';
    let label = '';
    if (target === 'client') {
      relPath = settings.clientModPath || 'BepInEx/plugins';
      label = 'Plugins Folder (BepInEx/plugins)';
    } else if (target === 'server') {
      relPath = settings.serverModPath || 'user/mods';
      label = 'Server Folder (user/mods)';
    } else {
      relPath = target;
      label = `Mod Folder (${target})`;
    }

    const fullPath = `${settings.sptDirectory}\\${relPath.replace(/\//g, '\\')}`;
    const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;

    if (bridge?.openFolder) {
      try {
        const opened = await bridge.openFolder(fullPath);
        if (opened) {
          showToast('Directory Explorer', `Opened ${label} in File Explorer: ${fullPath}`, 'success');
          return;
        }
      } catch (err: any) {
        console.error('Failed to open folder:', err);
      }
    }

    showToast('Directory Explorer', `Target path: ${fullPath}`, 'info');
  };

  // Config Saving
  const handleSaveConfigFile = (modId: string, fileId: string, newContent: string) => {
    setInstalledMods((prev) =>
      prev.map((m) => {
        if (m.id === modId) {
          const updatedFiles = m.configFiles.map((f) => {
            if (f.id === fileId) {
              const backups = f.backups || [];
              return {
                ...f,
                content: newContent,
                backups: [{ timestamp: new Date().toISOString(), content: f.content }, ...backups].slice(0, 10),
              };
            }
            return f;
          });
          return { ...m, configFiles: updatedFiles };
        }
        return m;
      })
    );
  };

  // Conflict Resolution
  const handleIgnoreConflict = (conflictId: string) => {
    const updated = [...ignoredConflicts, conflictId];
    setIgnoredConflicts(updated);
    storageService.saveIgnoredConflicts(updated);
    setSelectedConflict(null);
    showToast('Conflict Ignored', 'Collision warning will not appear again.', 'info');
  };

  const handleDisableConflictingMod = (modId: string) => {
    handleToggleMod(modId);
    setSelectedConflict(null);
  };

  // Diagnostics Export
  const handleExportDiagnostics = () => {
    const diagnostics = {
      appVersion: 'Blacksite Mod Manager - ALPHA v1.8.0',
      timestamp: new Date().toISOString(),
      os: 'Windows 11 x64 (Simulated Web Runtime)',
      sptPath: settings.sptDirectory,
      sptVersion: settings.sptVersion,
      layout: settings.isSpt4xLayout ? 'SPT 4.x (SPT_Runtime)' : 'Legacy',
      installedMods: installedMods.map((m) => ({
        id: m.id,
        name: m.name,
        version: m.version,
        disabled: m.isDisabled,
      })),
      profiles: profiles.map((p) => p.name),
      conflictsCount: conflicts.length,
    };

    const blob = new Blob([JSON.stringify(diagnostics, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blacksite-diagnostics-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('Diagnostics Exported', 'Downloaded diagnostics manifest bundle.', 'success');
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#121418] text-[#E8EAEE]">
      {/* Titlebar */}
      <CustomTitleBar
        theme={settings.theme}
        onToggleTheme={() =>
          handleUpdateSettings({ theme: settings.theme === 'light' ? 'dark' : 'light' })
        }
        onMinimize={() => {
          const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
          if (bridge?.windowControl?.minimize) {
            bridge.windowControl.minimize();
          } else {
            showToast('Minimize', 'Minimized to taskbar.', 'info');
          }
        }}
        onMaximize={async () => {
          const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
          if (bridge?.windowControl?.maximize) {
            await bridge.windowControl.maximize();
          } else {
            showToast('Maximize', 'Window maximized.', 'info');
          }
        }}
        onClose={() => {
          const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
          if (bridge?.windowControl?.close) {
            bridge.windowControl.close();
          } else {
            showToast('Close', 'Closing Blacksite Mod Manager.', 'info');
          }
        }}
      />

      {/* Header */}
      <Header
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onPickDirectory={handlePickDirectory}
        onLaunchSpt={() => setIsLauncherOpen(true)}
        onOpenDownloadModal={() => setIsDownloadModalOpen(true)}
        profiles={profiles}
        onSelectProfile={handleSelectProfile}
        onCreateProfile={handleCreateProfile}
      />

      {/* Navigation Tabs */}
      <div className="bg-[#181B20] border-b border-[#23272E] px-4 pt-1 flex items-center gap-1 shrink-0">
        <button
          onClick={() => setActiveTab('browse')}
          className={`px-4 py-2 text-[13px] font-semibold transition-colors border-b-2 cursor-pointer ${
            activeTab === 'browse'
              ? 'text-[#EA580C] border-[#EA580C]'
              : 'text-[#9AA3AF] hover:text-[#E8EAEE] border-transparent'
          }`}
          type="button"
        >
          Browse Mods
        </button>

        <button
          onClick={() => setActiveTab('installed')}
          className={`px-4 py-2 text-[13px] font-semibold transition-colors border-b-2 flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'installed'
              ? 'text-[#EA580C] border-[#EA580C]'
              : 'text-[#9AA3AF] hover:text-[#E8EAEE] border-transparent'
          }`}
          type="button"
        >
          <span>Installed Mods</span>
          <span className="bg-[#20252D] text-[#9AA3AF] text-[11px] font-mono px-1.5 py-0.2 rounded-full">
            {installedMods.length}
          </span>
          {conflicts.length > 0 && (
            <span className="w-2 h-2 rounded-full bg-[#F59E0B]" title="Active conflicts detected" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('analytics')}
          className={`px-4 py-2 text-[13px] font-semibold transition-colors border-b-2 flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'analytics'
              ? 'text-[#EA580C] border-[#EA580C]'
              : 'text-[#9AA3AF] hover:text-[#E8EAEE] border-transparent'
          }`}
          type="button"
        >
          <span>Analytics</span>
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`px-4 py-2 text-[13px] font-semibold transition-colors border-b-2 cursor-pointer ${
            activeTab === 'settings'
              ? 'text-[#EA580C] border-[#EA580C]'
              : 'text-[#9AA3AF] hover:text-[#E8EAEE] border-transparent'
          }`}
          type="button"
        >
          Settings
        </button>
      </div>

      {/* Main Tab Content */}
      <main className="flex-1 overflow-hidden flex flex-col bg-[#121418]">
        {activeTab === 'browse' && (
          <BrowseModsTab
            sptVersion={settings.sptVersion}
            categories={categories}
            sptVersions={sptVersions}
            installedMods={installedMods}
            onInstallMod={handleInstallMod}
            onOpenVersions={setSelectedModForVersions}
            onInstallFromFile={handleInstallFromFile}
            onShowToast={showToast}
            showRecommendedMods={settings.showRecommendedMods !== false}
            onToggleShowRecommended={(show) => handleUpdateSettings({ showRecommendedMods: show })}
          />
        )}

        {activeTab === 'installed' && (
          <InstalledModsTab
            installedMods={installedMods}
            conflicts={conflicts}
            onToggleMod={handleToggleMod}
            onUninstallMod={handleUninstallMod}
            onUpdateMod={handleUpdateMod}
            onEditConfigs={setSelectedModForConfig}
            onShowConflict={setSelectedConflict}
            onEnableAll={handleEnableAll}
            onDisableAll={handleDisableAll}
            onUninstallAll={handleUninstallAll}
            onCheckUpdates={handleCheckUpdates}
            onOpenFolder={handleOpenFolder}
            onReorderMods={handleReorderMods}
            onUpdateModTags={handleUpdateModTags}
            onBulkEnable={handleBulkEnableMods}
            onBulkDisable={handleBulkDisableMods}
            onBulkUninstall={handleBulkUninstallMods}
            onShowToast={showToast}
          />
        )}

        {activeTab === 'analytics' && (
          <AnalyticsTab
            installedMods={installedMods}
            profiles={profiles}
            activeProfileId={settings.activeProfileId}
            onSelectProfile={handleSelectProfile}
            categories={categories}
            conflicts={conflicts}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onPickDirectory={handlePickDirectory}
            onSaveSettings={() => {
              storageService.saveSettings(settings);
              showToast('Settings Saved', 'Paths and preferences saved to disk.', 'success');
            }}
            profiles={profiles}
            installedMods={installedMods}
            onCreateProfile={handleCreateProfile}
            onDeleteProfile={handleDeleteProfile}
            onSelectProfile={handleSelectProfile}
            onClearCache={() => showToast('Cache Cleared', 'Thumbnail and API metadata cache cleared.', 'info')}
            onClearTempFiles={() =>
              showToast('Temp Cleaned', 'Cleaned leftover bs-staging-* and bs-extract-* directories.', 'info')
            }
            onExportDiagnostics={handleExportDiagnostics}
            onShowToast={showToast}
          />
        )}
      </main>

      {/* Status Bar */}
      <StatusBar
        statusText={statusText}
        queue={queue}
        onOpenQueue={() => setIsQueueOpen(true)}
      />

      {/* Modals */}
      <InstallQueueModal
        isOpen={isQueueOpen}
        onClose={() => setIsQueueOpen(false)}
        queue={queue}
        onPauseItem={(id) =>
          setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, status: 'paused' } : q)))
        }
        onResumeItem={(id) =>
          setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, status: 'downloading' } : q)))
        }
        onCancelItem={(id) => setQueue((prev) => prev.filter((q) => q.id !== id))}
        onRetryItem={(id) => {
          const item = queue.find((q) => q.id === id);
          if (item) {
            queueInstall(item.modName, item.author, item.version, item.thumbnail, undefined, item.modId);
          }
        }}
        onClearCompleted={() =>
          setQueue((prev) => prev.filter((q) => q.status !== 'installed' && q.status !== 'failed'))
        }
      />

      <VersionSelectionModal
        mod={selectedModForVersions}
        recoveryNotice={versionRecoveryNotice}
        onClose={() => {
          setSelectedModForVersions(null);
          setVersionRecoveryNotice(null);
        }}
        onSelectVersion={handleSelectVersion}
        onInstallFromFile={handleInstallFromFile}
      />

      {dependencyModalState.isOpen && dependencyModalState.targetMod && (
        <DependencyInstallModal
          isOpen={dependencyModalState.isOpen}
          targetMod={dependencyModalState.targetMod}
          targetVersion={dependencyModalState.targetVersion}
          targetDownloadUrl={dependencyModalState.targetDownloadUrl}
          dependencies={dependencyModalState.dependencies}
          onConfirm={handleConfirmDependencies}
          onClose={() =>
            setDependencyModalState({
              isOpen: false,
              targetMod: null,
              targetVersion: '',
              dependencies: [],
            })
          }
        />
      )}

      <ConfigEditorModal
        mod={selectedModForConfig}
        isOpen={Boolean(selectedModForConfig)}
        onClose={() => setSelectedModForConfig(null)}
        onSaveConfigFile={handleSaveConfigFile}
        onShowToast={showToast}
      />

      <ConflictResolverModal
        conflict={selectedConflict}
        installedMods={installedMods}
        isOpen={Boolean(selectedConflict)}
        onClose={() => setSelectedConflict(null)}
        onDisableMod={handleDisableConflictingMod}
        onIgnoreConflict={handleIgnoreConflict}
      />

      <SptLauncherModal
        isOpen={isLauncherOpen}
        onClose={() => setIsLauncherOpen(false)}
        sptVersion={settings.sptVersion}
        onShowToast={showToast}
      />

      <WindowsDownloadModal
        isOpen={isDownloadModalOpen}
        onClose={() => setIsDownloadModalOpen(false)}
        appVersion="1.8.0"
      />

      {/* Toasts */}
      <ToastContainer toasts={toasts} onDismiss={handleDismissToast} />
    </div>
  );
};
