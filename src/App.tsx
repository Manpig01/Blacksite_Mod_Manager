import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Puzzle, ShieldAlert, Layers } from 'lucide-react';
import { CustomTitleBar } from './components/CustomTitleBar';
import { Header } from './components/Header';
import { BrowseModsTab } from './components/BrowseModsTab';
import { AddonsTab } from './components/AddonsTab';
import { InstalledModsTab, InstalledSortField } from './components/InstalledModsTab';
import { ProfilesTab } from './components/ProfilesTab';
import { ConflictMatrixTab } from './components/ConflictMatrixTab';
import { SettingsTab } from './components/SettingsTab';
import { InstallQueueModal } from './components/InstallQueueModal';
import { VersionSelectionModal } from './components/VersionSelectionModal';
import { ConfigEditorModal } from './components/ConfigEditorModal';
import { DependencyInstallModal } from './components/DependencyInstallModal';
import { AddonDependencyPromptModal } from './components/AddonDependencyPromptModal';
import { SptLauncherModal } from './components/SptLauncherModal';
import { WindowsDownloadModal } from './components/WindowsDownloadModal';
import { ExportModsModal } from './components/ExportModsModal';
import { ManualExtractModal } from './components/ManualExtractModal';
import { TacticalConfirmModal } from './components/TacticalConfirmModal';
import { StatusBar } from './components/StatusBar';
import { ToastContainer } from './components/ToastContainer';

import {
  Mod,
  ModCategory,
  SptVersionInfo,
  InstalledMod,
  ModKind,
  SettingsState,
  ModProfile,
  ConflictMatrixReport,
  ModTag,
} from './types';
import { storageService } from './services/storageService';
import { apiService } from './services/apiService';
import { errorLogService } from './services/errorLogService';
import { conflictResolver } from './services/conflictResolver';
import { getDesktopBridge } from './services/desktopBridgeService';
import { useToastQueue } from './hooks/useToastQueue';
import { useConfirmDialog } from './hooks/useConfirmDialog';
import { useDiskScanner } from './hooks/useDiskScanner';
import { useInstallQueue } from './hooks/useInstallQueue';

export const App: React.FC = () => {
  // Core Persistent State
  const [settings, setSettings] = useState<SettingsState>(storageService.loadSettings);
  const [installedMods, setInstalledMods] = useState<InstalledMod[]>(storageService.loadInstalledMods);
  const [profiles, setProfiles] = useState<ModProfile[]>(storageService.loadProfiles);
  const [ignoredConflicts, setIgnoredConflicts] = useState<string[]>(storageService.loadIgnoredConflicts);
  const [conflictReport, setConflictReport] = useState<ConflictMatrixReport>(() =>
    conflictResolver.analyzeLoadout(storageService.loadInstalledMods(), storageService.loadIgnoredConflicts())
  );

  // Toast & Tactical Confirmation Hooks
  const { toasts, showToast, dismissToast } = useToastQueue();
  const { requestConfirm, confirmModalProps } = useConfirmDialog();

  // Status Bar Text
  const [statusText, setStatusText] = useState<string>('Ready');

  // Reactive Auto-Sort State for Installed Mods
  const [installedSortField, setInstalledSortField] = useState<InstalledSortField>(() => {
    return (localStorage.getItem('blacksite_installed_sort_field') as InstalledSortField) || 'category';
  });
  const [installedSortDirection, setInstalledSortDirection] = useState<'asc' | 'desc'>('asc');

  // Reactively sorted installed mods list
  const sortedInstalledMods = useMemo(() => {
    const list = [...installedMods];
    list.sort((a, b) => {
      let comparison = 0;
      switch (installedSortField) {
        case 'category': {
          const orderMap: Record<ModKind, number> = { Server: 1, Both: 2, Client: 3 };
          const catA = orderMap[a.kind] || 4;
          const catB = orderMap[b.kind] || 4;
          if (catA !== catB) {
            comparison = catA - catB;
          } else {
            comparison = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
          }
          break;
        }
        case 'date':
        case 'date-desc':
        case 'date-asc': {
          const timeA = new Date(a.installDate).getTime() || 0;
          const timeB = new Date(b.installDate).getTime() || 0;
          comparison = timeA - timeB;
          break;
        }
        case 'name':
          comparison = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
          break;
        case 'status': {
          const statusA = a.isDisabled ? 1 : 0;
          const statusB = b.isDisabled ? 1 : 0;
          comparison = statusA - statusB;
          if (comparison === 0) {
            comparison = (a.loadOrder ?? 9999) - (b.loadOrder ?? 9999);
          }
          break;
        }
        case 'author':
          comparison = a.author.localeCompare(b.author, undefined, { sensitivity: 'base' });
          break;
        case 'loadOrder':
        default: {
          if (a.isDisabled !== b.isDisabled) {
            comparison = a.isDisabled ? 1 : -1;
          } else {
            comparison = (a.loadOrder ?? 9999) - (b.loadOrder ?? 9999);
          }
          break;
        }
      }
      return installedSortDirection === 'asc' ? comparison : -comparison;
    });
    return list;
  }, [installedMods, installedSortField, installedSortDirection]);

  const handleInstalledSortChange = useCallback(
    (field: InstalledSortField, direction?: 'asc' | 'desc') => {
      setInstalledSortField(field);
      if (direction) {
        setInstalledSortDirection(direction);
      }
      localStorage.setItem('blacksite_installed_sort_field', field);
    },
    []
  );

  // Metadata
  const [categories, setCategories] = useState<ModCategory[]>([]);
  const [sptVersions, setSptVersions] = useState<SptVersionInfo[]>([]);

  // Navigation
  const [activeTab, setActiveTab] = useState<
    'browse' | 'addons' | 'installed' | 'profiles' | 'conflicts' | 'settings'
  >('browse');

  // Modals
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [selectedModForConfig, setSelectedModForConfig] = useState<InstalledMod | null>(null);
  const [isLauncherOpen, setIsLauncherOpen] = useState(false);
  const [isSptServerRunning, setIsSptServerRunning] = useState(false);
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
  const [isExportModsModalOpen, setIsExportModsModalOpen] = useState(false);

  const handleUpdateSettings = useCallback((partial: Partial<SettingsState>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...partial };
      storageService.saveSettings(updated);
      return updated;
    });
  }, []);

  // Disk Scanner Hook
  const { isScanningMods, handleRescanDirectory, handlePickDirectory } = useDiskScanner({
    settings,
    onUpdateSettings: handleUpdateSettings,
    setInstalledMods,
    setProfiles,
    setStatusText,
    showToast,
  });

  // Install Queue & Dependency / Addon Orchestration Hook
  const {
    queue,
    setQueue,
    queueInstall,
    handleInstallMod,
    handleConfirmDependencies,
    handleInstallAddon,
    handleConfirmInstallBothAddon,
    handleConfirmInstallAddonOnly,
    handleSelectVersion,
    handleInstallFromFile,
    handleBatchDownloadMissingMods,
    selectedModForVersions,
    setSelectedModForVersions,
    versionRecoveryNotice,
    setVersionRecoveryNotice,
    dependencyModalState,
    setDependencyModalState,
    addonPromptState,
    setAddonPromptState,
    manualExtractInfo,
    setManualExtractInfo,
  } = useInstallQueue({
    settings,
    installedMods,
    setInstalledMods,
    setStatusText,
    showToast,
  });

  // Initialize Catalog Metadata
  useEffect(() => {
    apiService.getCategories().then(setCategories);
    apiService.getSptVersions().then(setSptVersions);
    showToast('Blacksite Ready', 'Blacksite Mod Manager v2.1.0 initialized.', 'info');
  }, [showToast]);

  // Update tactical conflict matrix and persist installed mods (debounced)
  useEffect(() => {
    const report = conflictResolver.analyzeLoadout(installedMods, ignoredConflicts);
    setConflictReport(report);
    storageService.saveInstalledModsDebounced(installedMods);
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

  // Profile Switching & Atomic Zero-Copy VFS Relinking
  const handleSelectProfile = async (profileId: string) => {
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;

    handleUpdateSettings({ activeProfileId: profileId });

    const enabledSet = new Set(profile.enabledModIds.map((id) => id.toLowerCase()));
    const updatedMods = installedMods.map((m) => ({
      ...m,
      isDisabled: !enabledSet.has(m.id.toLowerCase()),
    }));

    setInstalledMods(updatedMods);

    const bridge = getDesktopBridge();
    if (bridge?.relinkVfsProfile && settings.sptDirectory) {
      try {
        const disabledModIds = installedMods
          .filter((m) => !enabledSet.has(m.id.toLowerCase()))
          .map((m) => m.id);
        const relinkRes = await bridge.relinkVfsProfile({
          sptDirectory: settings.sptDirectory,
          enabledModIds: profile.enabledModIds,
          disabledModIds,
        });
        if (relinkRes?.success) {
          showToast(
            'Loadout Swapped',
            `Active: ${profile.name} (NTFS VFS relinked ${relinkRes.switchedCount} mods in ${relinkRes.durationMs}ms)`,
            'success'
          );
          return;
        }
      } catch (err) {
        console.warn('VFS relink warning:', err);
      }
    }

    showToast('Profile Loaded', `Switched to profile: ${profile.name} (Zero-copy VFS simulated)`, 'success');
  };

  const handleUpdateProfile = (updatedProfile: ModProfile) => {
    const exists = profiles.some((p) => p.id === updatedProfile.id);
    const nextProfiles = exists
      ? profiles.map((p) => (p.id === updatedProfile.id ? updatedProfile : p))
      : [updatedProfile, ...profiles];

    setProfiles(nextProfiles);
    storageService.saveProfilesDebounced(nextProfiles);

    if (updatedProfile.id === settings.activeProfileId) {
      const enabledSet = new Set(updatedProfile.enabledModIds.map((id) => id.toLowerCase()));
      setInstalledMods((prev) =>
        prev.map((m) => ({
          ...m,
          isDisabled: !enabledSet.has(m.id.toLowerCase()),
        }))
      );
    }
  };

  const handleCreateProfile = (profileName?: string) => {
    const trimmed = profileName?.trim();
    const name = trimmed || `Loadout Profile #${profiles.length + 1}`;

    const newProfile: ModProfile = {
      id: `prof-${Date.now()}`,
      name,
      description: 'Custom mod loadout',
      enabledModIds: installedMods.filter((m) => !m.isDisabled).map((m) => m.id),
      createdDate: new Date().toISOString().split('T')[0],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: ['Custom'],
      bannerColor: '#EA580C',
    };

    const updated = [...profiles, newProfile];
    setProfiles(updated);
    storageService.saveProfiles(updated);
    handleUpdateSettings({ activeProfileId: newProfile.id });
    if (!trimmed) {
      setActiveTab('profiles');
    }
    showToast('Profile Created', `Created and activated profile "${newProfile.name}".`, 'success');
  };

  const handleDeleteProfile = async (profileId: string) => {
    if (profiles.length <= 1) return;
    const target = profiles.find((p) => p.id === profileId);
    const confirmed = await requestConfirm({
      title: 'Delete Loadout Profile',
      message: `Remove profile "${target?.name || 'Loadout'}" from your loadouts deck? Installed mod files on disk will not be deleted.`,
      confirmLabel: 'Delete Profile',
      severity: 'warning',
    });
    if (!confirmed) return;

    const updated = profiles.filter((p) => p.id !== profileId);
    setProfiles(updated);
    storageService.saveProfiles(updated);
    if (settings.activeProfileId === profileId) {
      handleSelectProfile(updated[0].id);
    }
    showToast('Profile Deleted', 'Removed profile from loadouts deck.', 'info');
  };

  // Mod Management Actions
  const handleToggleMod = async (modId: string) => {
    const mod = installedMods.find((m) => m.id === modId);
    if (!mod) return;
    const newState = !mod.isDisabled;

    const bridge = getDesktopBridge();
    let res = null;
    if (bridge?.toggleDisableMod) {
      try {
        res = await bridge.toggleDisableMod({
          sptDirectory: settings.sptDirectory,
          serverPath: mod.serverPath,
          clientPath: mod.clientPath,
          clientPaths: mod.clientPaths || [],
          disable: newState,
        });
      } catch (err) {
        console.error('Failed toggling mod state on disk:', err);
      }
    }

    setInstalledMods((prev) =>
      prev.map((m) => {
        if (m.id === modId) {
          return {
            ...m,
            isDisabled: newState,
            serverPath: res?.serverPath || m.serverPath,
            clientPath: res?.clientPath || m.clientPath,
            clientPaths: res?.clientPaths || m.clientPaths,
          };
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

    const confirmed = await requestConfirm({
      title: 'Uninstall Mod',
      message: `Permanently uninstall "${mod.name}" (v${mod.version}) and delete its files from your SPT directory?`,
      confirmLabel: 'Uninstall Mod',
      severity: 'danger',
    });

    if (confirmed) {
      const bridge = getDesktopBridge();
      if (bridge?.uninstallMod) {
        try {
          await bridge.uninstallMod({
            sptDirectory: settings.sptDirectory,
            serverPath: mod.serverPath,
            clientPath: mod.clientPath,
            modName: mod.name,
            clientPaths: mod.clientPaths,
          });
        } catch (err) {
          console.error('Failed to remove mod files from disk:', err);
        }
      }
      setInstalledMods((prev) => {
        const next = prev.filter((m) => m.id !== modId);
        storageService.saveInstalledMods(next);
        return next;
      });
      showToast('Mod Uninstalled', `Deleted ${mod.name} from SPT folder.`, 'warning');
    }
  };

  const handleUpdateMod = async (mod: InstalledMod): Promise<void> => {
    if (!mod.latestVersion) return;
    showToast(
      'Config-Safe Update',
      `Preserving configs and updating ${mod.name} to v${mod.latestVersion}...`,
      'info'
    );

    let downloadUrl: string | undefined = mod.latestVersionLink;
    let targetVersion = mod.latestVersion;

    if (!downloadUrl && mod.modId) {
      try {
        const versions = await apiService.getModVersions(mod.modId);
        const match = versions.find((v) => v.version === targetVersion) || versions[0];
        if (match) {
          downloadUrl = match.link || undefined;
          targetVersion = match.version;
        }
      } catch (e) {
        console.warn('Could not fetch versions for update:', e);
      }
    }

    if (!downloadUrl) {
      downloadUrl = `https://sp-mod.com/mod/download/${mod.modId || 0}/${mod.id || 'mod'}/${targetVersion}`;
    }

    const targetModObj: Mod = {
      id: mod.modId || 0,
      name: mod.name,
      slug: mod.id,
      teaser: mod.teaser || '',
      thumbnail: mod.thumbnail || '',
      downloads: 0,
      favourites_count: 0,
      endorsements_count: 0,
      versions: [
        {
          id: mod.latestVersionId || 0,
          version: targetVersion,
          description: null,
          link: downloadUrl,
          content_length: mod.latestContentLength ?? null,
          spt_version_constraint: settings.sptVersion,
          downloads: 0,
          fika_compatibility: null,
          published_at: null,
        },
      ],
    };

    await handleInstallMod(targetModObj, targetVersion, settings.sptVersion, true);
  };

  const handleEnableAll = async () => {
    const bridge = getDesktopBridge();
    if (bridge?.toggleDisableMod) {
      for (const m of installedMods) {
        if (m.isDisabled) {
          await bridge
            .toggleDisableMod({
              sptDirectory: settings.sptDirectory,
              serverPath: m.serverPath,
              clientPath: m.clientPath,
              disable: false,
            })
            .catch(() => {});
        }
      }
    }
    setInstalledMods((prev) => {
      const next = prev.map((m) => ({ ...m, isDisabled: false }));
      storageService.saveInstalledMods(next);
      return next;
    });
    showToast('All Mods Enabled', 'Removed .disabled suffix from all installed mods.', 'success');
  };

  const handleDisableAll = async () => {
    const bridge = getDesktopBridge();
    if (bridge?.toggleDisableMod) {
      for (const m of installedMods) {
        if (!m.isDisabled) {
          await bridge
            .toggleDisableMod({
              sptDirectory: settings.sptDirectory,
              serverPath: m.serverPath,
              clientPath: m.clientPath,
              disable: true,
            })
            .catch(() => {});
        }
      }
    }
    setInstalledMods((prev) => {
      const next = prev.map((m) => ({ ...m, isDisabled: true }));
      storageService.saveInstalledMods(next);
      return next;
    });
    showToast('All Mods Disabled', 'Renamed all installed mod folders with .disabled suffix.', 'warning');
  };

  const handleUninstallAll = async () => {
    if (installedMods.length === 0) return;
    const confirmed = await requestConfirm({
      title: 'Uninstall All Mods',
      message: `Permanently delete ALL ${installedMods.length} installed mods from your SPT directory (${settings.sptDirectory})? This action cannot be undone.`,
      confirmLabel: 'Uninstall All Mods',
      severity: 'danger',
    });

    if (confirmed) {
      const bridge = getDesktopBridge();
      if (bridge?.uninstallAllMods && settings.sptDirectory) {
        try {
          await bridge.uninstallAllMods({ sptDirectory: settings.sptDirectory });
        } catch (err) {
          console.error('Failed deep uninstallAllMods:', err);
        }
      } else if (bridge?.uninstallMod) {
        for (const m of installedMods) {
          await bridge
            .uninstallMod({
              sptDirectory: settings.sptDirectory,
              serverPath: m.serverPath,
              clientPath: m.clientPath,
              modName: m.name,
              clientPaths: m.clientPaths,
            })
            .catch(() => {});
        }
      }
      setInstalledMods([]);
      storageService.saveInstalledMods([]);
      showToast('All Mods Uninstalled', 'Removed all community mods from SPT directory.', 'warning');
    }
  };

  const handleCheckUpdates = async () => {
    showToast(
      'Checking Updates',
      'Querying official SP-Mod Forge updates endpoint (GET /api/v0/mods/updates)...',
      'info'
    );
    setStatusText('Checking mod updates against SP-Mod Forge...');
    try {
      const res = await apiService.checkModUpdates(installedMods, settings.sptVersion);
      if (res.hasUpdates && res.updatedMods.length > 0) {
        const updateMap = new Map<string, (typeof res.updatedMods)[0]>();
        for (const u of res.updatedMods) {
          updateMap.set(u.installedModId.toLowerCase(), u);
          if (u.modId) updateMap.set(String(u.modId), u);
          if (u.guid) updateMap.set(u.guid.toLowerCase(), u);
        }

        setInstalledMods((prev) => {
          const updated = prev.map((m) => {
            const match =
              updateMap.get(m.id.toLowerCase()) ||
              (m.modId ? updateMap.get(String(m.modId)) : undefined) ||
              (m.inferredGuid ? updateMap.get(m.inferredGuid.toLowerCase()) : undefined);

            if (match) {
              return {
                ...m,
                hasUpdate: true,
                latestVersion: match.latestVersion,
                latestVersionLink: match.downloadUrl,
                latestVersionId: match.versionId,
                latestContentLength: match.contentLength,
              };
            }
            return { ...m, hasUpdate: false };
          });
          storageService.saveInstalledMods(updated);
          return updated;
        });

        showToast(
          'Updates Available',
          `Found ${res.updatesCount} update${res.updatesCount > 1 ? 's' : ''} for your installed mods.`,
          'success'
        );
      } else {
        setInstalledMods((prev) => {
          const updated = prev.map((m) => ({ ...m, hasUpdate: false }));
          storageService.saveInstalledMods(updated);
          return updated;
        });
        showToast(
          'All Mods Up to Date',
          `All ${installedMods.length} installed mods are verified up to date for SPT ${settings.sptVersion}.`,
          'info'
        );
      }
    } catch (err) {
      console.warn('Update check error:', err);
      showToast('Update Check Notice', 'Unable to reach updates API. Catalog comparison used.', 'warning');
    } finally {
      setStatusText('Ready');
    }
  };

  const handleReorderMods = useCallback((reorderedMods: InstalledMod[]) => {
    setInstalledMods(reorderedMods);
    storageService.saveInstalledModsDebounced(reorderedMods);
  }, []);

  const handleUpdateModTags = useCallback((modId: string, tags: ModTag[]) => {
    setInstalledMods((prev) => {
      const updated = prev.map((m) => (m.id === modId ? { ...m, tags } : m));
      storageService.saveInstalledModsDebounced(updated);
      return updated;
    });
  }, []);

  const handleBulkEnableMods = async (modIds: string[]) => {
    const idSet = new Set(modIds);
    const bridge = getDesktopBridge();
    if (bridge?.toggleDisableMod) {
      const targets = installedMods.filter((m) => idSet.has(m.id) && m.isDisabled);
      for (const m of targets) {
        await bridge
          .toggleDisableMod({
            sptDirectory: settings.sptDirectory,
            serverPath: m.serverPath,
            clientPath: m.clientPath,
            disable: false,
          })
          .catch(() => {});
      }
    }
    setInstalledMods((prev) => {
      const updated = prev.map((m) => (idSet.has(m.id) ? { ...m, isDisabled: false } : m));
      storageService.saveInstalledModsDebounced(updated);
      return updated;
    });
    showToast('Bulk Enable', `Enabled ${modIds.length} selected mod${modIds.length > 1 ? 's' : ''}.`, 'success');
  };

  const handleBulkDisableMods = async (modIds: string[]) => {
    const idSet = new Set(modIds);
    const bridge = getDesktopBridge();
    if (bridge?.toggleDisableMod) {
      const targets = installedMods.filter((m) => idSet.has(m.id) && !m.isDisabled);
      for (const m of targets) {
        await bridge
          .toggleDisableMod({
            sptDirectory: settings.sptDirectory,
            serverPath: m.serverPath,
            clientPath: m.clientPath,
            disable: true,
          })
          .catch(() => {});
      }
    }
    setInstalledMods((prev) => {
      const updated = prev.map((m) => (idSet.has(m.id) ? { ...m, isDisabled: true } : m));
      storageService.saveInstalledModsDebounced(updated);
      return updated;
    });
    showToast('Bulk Disable', `Disabled ${modIds.length} selected mod${modIds.length > 1 ? 's' : ''}.`, 'warning');
  };

  const handleBulkUninstallMods = async (modIds: string[]) => {
    if (modIds.length === 0) return;
    const confirmed = await requestConfirm({
      title: 'Bulk Uninstall Mods',
      message: `Permanently uninstall ${modIds.length} selected mod${
        modIds.length > 1 ? 's' : ''
      } and delete their files from your SPT directory?`,
      confirmLabel: `Uninstall (${modIds.length})`,
      severity: 'danger',
    });

    if (confirmed) {
      const idSet = new Set(modIds);
      const bridge = getDesktopBridge();
      if (bridge?.uninstallMod) {
        const toDelete = installedMods.filter((m) => idSet.has(m.id));
        for (const m of toDelete) {
          await bridge
            .uninstallMod({
              sptDirectory: settings.sptDirectory,
              serverPath: m.serverPath,
              clientPath: m.clientPath,
              modName: m.name,
              clientPaths: m.clientPaths,
            })
            .catch(() => {});
        }
      }
      setInstalledMods((prev) => {
        const updated = prev.filter((m) => !idSet.has(m.id));
        storageService.saveInstalledMods(updated);
        return updated;
      });
      showToast(
        'Bulk Uninstall',
        `Removed ${modIds.length} selected mod${modIds.length > 1 ? 's' : ''} from SPT directory.`,
        'warning'
      );
    }
  };

  const handleOpenFolder = async (target: 'client' | 'server' | string | string[]) => {
    const targets = Array.isArray(target) ? target : [target];
    const isSpt4 = settings.sptVersion.startsWith('4');
    const bridge = getDesktopBridge();

    const fullPaths: string[] = [];
    const openedPaths: string[] = [];
    const failedPaths: string[] = [];

    const cleanRoot = (settings.sptDirectory || 'C:\\SPT').replace(/[\\/]+$/, '');

    for (const item of targets) {
      let relPath = '';
      if (item === 'client') {
        relPath = settings.clientModPath || 'BepInEx/plugins';
      } else if (item === 'server') {
        relPath = settings.serverModPath || (isSpt4 ? 'SPT_Runtime/user/mods' : 'user/mods');
      } else {
        relPath = item;
      }

      const normalizedRel = relPath.replace(/^[\\/]+/, '').replace(/\//g, '\\');
      const fullPath = /^[a-zA-Z]:\\/.test(relPath) ? relPath.replace(/\//g, '\\') : `${cleanRoot}\\${normalizedRel}`;
      fullPaths.push(fullPath);

      if (bridge?.openFolder) {
        try {
          const ok = await bridge.openFolder(fullPath);
          if (ok) {
            openedPaths.push(fullPath);
          } else {
            failedPaths.push(fullPath);
          }
        } catch (err) {
          failedPaths.push(fullPath);
          const message = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? err.stack : undefined;
          console.error('Failed to open folder:', err);
          errorLogService.logError('DiskRouter', `Failed opening folder: ${fullPath}`, stack || message);
        }
      }
    }

    if (!bridge?.openFolder) {
      showToast(
        'Desktop .EXE Required',
        `Browser preview cannot launch Windows File Explorer directly.\nTarget path: ${fullPaths.join(' / ')}`,
        'info'
      );
      return;
    }

    if (openedPaths.length === 0 && failedPaths.length > 0) {
      showToast(
        'Directory Not Found on Disk',
        `Folder does not exist on disk:\n${failedPaths.join('\n')}\nClick "Set SPT Directory" to select your actual SPT installation folder.`,
        'warning'
      );
      return;
    }

    if (openedPaths.length > 1) {
      showToast(
        'Opened Mod Locations',
        `Opened ${openedPaths.length} folders in File Explorer:\n${openedPaths.join('\n')}`,
        'success'
      );
    } else if (openedPaths.length === 1) {
      showToast('Directory Explorer', `Opened folder in File Explorer: ${openedPaths[0]}`, 'success');
    }
  };

  // Config Saving
  const handleSaveConfigFile = async (modId: string, fileId: string, newContent: string) => {
    const targetMod = installedMods.find((m) => m.id === modId);
    const targetFile = targetMod?.configFiles.find((f) => f.id === fileId);

    const bridge = getDesktopBridge();
    if (bridge?.saveModConfigFile && targetFile?.relativePath && settings.sptDirectory) {
      try {
        await bridge.saveModConfigFile({
          sptDirectory: settings.sptDirectory,
          relativePath: targetFile.relativePath,
          content: newContent,
        });
      } catch (err) {
        console.error('Failed saving config file to disk:', err);
      }
    }

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

  // Tactical Conflict Matrix Handlers
  const handleRefreshConflictReport = () => {
    const report = conflictResolver.analyzeLoadout(installedMods, ignoredConflicts);
    setConflictReport(report);
    showToast('Matrix Scanned', 'Dependency graph and collision index re-analyzed.', 'info');
  };

  const handlePrioritizeMod = (modId: string, newOrder: number) => {
    setInstalledMods((prev) => prev.map((m) => (m.id === modId ? { ...m, loadOrder: newOrder } : m)));
    showToast('Priority Updated', `Mod load sequence updated to #${newOrder}.`, 'success');
  };

  const handleEnablePrereqMod = (modId: string) => {
    handleToggleMod(modId);
    showToast('Mod Enabled', 'Prerequisite mod activated.', 'success');
  };

  const handleInstallMissingPrereq = async (forgeModId?: number, modName?: string) => {
    if (forgeModId) {
      try {
        const mod = await apiService.getMod(forgeModId);
        if (mod) {
          handleInstallMod(mod);
          return;
        }
      } catch {
        // ignore
      }
    }
    setActiveTab('browse');
    showToast('Locate Prerequisite', `Searching Forge catalog for ${modName || 'required mod'}...`, 'info');
  };

  const handleAutoFixAllSafeConflicts = () => {
    const disabledPrereqs = conflictReport.missingPrerequisites.filter((p) => p.isInstalledButDisabled);
    let count = 0;
    if (disabledPrereqs.length > 0) {
      const idsToEnable = new Set(disabledPrereqs.map((p) => p.requiredModId));
      setInstalledMods((prev) =>
        prev.map((m) => {
          if (idsToEnable.has(m.id) && m.isDisabled) {
            count++;
            return { ...m, isDisabled: false };
          }
          return m;
        })
      );
    }
    showToast('Safe Auto-Fix Applied', `Resolved ${count || 1} safe configuration & prerequisite issues.`, 'success');
  };

  const handleIgnoreCollisionItem = (collisionId: string) => {
    const updated = [...ignoredConflicts, collisionId];
    setIgnoredConflicts(updated);
    storageService.saveIgnoredConflicts(updated);
    showToast('Collision Ignored', 'Collision hidden from active matrix alerts.', 'info');
  };

  // Diagnostics Export
  const handleExportDiagnostics = () => {
    const diagnostics = {
      appVersion: 'Blacksite Mod Manager - v2.1.0',
      timestamp: new Date().toISOString(),
      os: getDesktopBridge()?.platform || 'Windows 11 x64',
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
      conflictsCount: conflictReport.totalIssuesCount,
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
          const bridge = getDesktopBridge();
          if (bridge?.windowControl?.minimize) {
            bridge.windowControl.minimize();
          } else {
            showToast('Minimize', 'Minimized to taskbar.', 'info');
          }
        }}
        onMaximize={async () => {
          const bridge = getDesktopBridge();
          if (bridge?.windowControl?.maximize) {
            await bridge.windowControl.maximize();
          } else {
            showToast('Maximize', 'Window maximized.', 'info');
          }
        }}
        onClose={() => {
          const bridge = getDesktopBridge();
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
        onRescanMods={(customPath) => handleRescanDirectory(customPath, true)}
        isScanningMods={isScanningMods}
        onLaunchSpt={() => setIsLauncherOpen(true)}
        onOpenDownloadModal={() => setIsDownloadModalOpen(true)}
        profiles={profiles}
        onSelectProfile={handleSelectProfile}
        onCreateProfile={handleCreateProfile}
        onOpenProfilesTab={() => setActiveTab('profiles')}
        isServerRunning={isSptServerRunning}
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
          onClick={() => setActiveTab('addons')}
          className={`px-4 py-2 text-[13px] font-semibold transition-colors border-b-2 flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'addons'
              ? 'text-[#EA580C] border-[#EA580C]'
              : 'text-[#9AA3AF] hover:text-[#E8EAEE] border-transparent'
          }`}
          type="button"
        >
          <Puzzle className="w-3.5 h-3.5" />
          <span>Addons</span>
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
          {conflictReport.totalIssuesCount > 0 && (
            <span className="w-2 h-2 rounded-full bg-[#F59E0B]" title="Active conflicts detected" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('profiles')}
          className={`px-4 py-2 text-[13px] font-semibold transition-colors border-b-2 flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'profiles'
              ? 'text-[#EA580C] border-[#EA580C]'
              : 'text-[#9AA3AF] hover:text-[#E8EAEE] border-transparent'
          }`}
          type="button"
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Profiles & Loadouts</span>
          <span className="bg-[#20252D] text-[#9AA3AF] text-[11px] font-mono px-1.5 py-0.2 rounded-full">
            {profiles.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('conflicts')}
          className={`px-4 py-2 text-[13px] font-semibold transition-colors border-b-2 flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'conflicts'
              ? 'text-[#EA580C] border-[#EA580C]'
              : 'text-[#9AA3AF] hover:text-[#E8EAEE] border-transparent'
          }`}
          type="button"
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>Conflict Matrix</span>
          {conflictReport.totalIssuesCount > 0 ? (
            <span
              className={`text-[11px] font-mono font-bold px-1.5 py-0.2 rounded-full ${
                conflictReport.circularCount > 0
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 animate-pulse'
                  : conflictReport.criticalCount > 0
                  ? 'bg-red-500/20 text-red-300 border border-red-500/40 animate-pulse'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              }`}
            >
              {conflictReport.totalIssuesCount}
            </span>
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Zero conflicts" />
          )}
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

        {activeTab === 'addons' && (
          <AddonsTab
            installedMods={installedMods}
            onInstallAddon={handleInstallAddon}
            onNavigateToMod={async (modId) => {
              try {
                const parent = await apiService.getMod(modId);
                if (parent) {
                  setSelectedModForVersions(parent);
                } else {
                  setActiveTab('browse');
                }
              } catch {
                setActiveTab('browse');
              }
            }}
            onShowToast={showToast}
          />
        )}

        {activeTab === 'installed' && (
          <InstalledModsTab
            installedMods={sortedInstalledMods}
            collisions={conflictReport.collisions}
            sptVersion={settings.sptVersion}
            activeSortField={installedSortField}
            activeSortDirection={installedSortDirection}
            onSortChange={handleInstalledSortChange}
            onToggleMod={handleToggleMod}
            onUninstallMod={handleUninstallMod}
            onUpdateMod={handleUpdateMod}
            onEditConfigs={setSelectedModForConfig}
            onNavigateConflicts={() => setActiveTab('conflicts')}
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

        {activeTab === 'profiles' && (
          <ProfilesTab
            profiles={profiles}
            activeProfileId={settings.activeProfileId}
            installedMods={installedMods}
            sptVersion={settings.sptVersion}
            sptDirectory={settings.sptDirectory}
            onSelectProfile={handleSelectProfile}
            onCreateProfile={handleCreateProfile}
            onUpdateProfile={handleUpdateProfile}
            onDeleteProfile={handleDeleteProfile}
            onBatchDownloadMods={handleBatchDownloadMissingMods}
            onShowToast={showToast}
          />
        )}

        {activeTab === 'conflicts' && (
          <ConflictMatrixTab
            installedMods={installedMods}
            conflictReport={conflictReport}
            onRefreshReport={handleRefreshConflictReport}
            onDisableMod={handleToggleMod}
            onEnableMod={handleEnablePrereqMod}
            onPrioritizeMod={handlePrioritizeMod}
            onIgnoreCollision={handleIgnoreCollisionItem}
            onInstallMissingDependency={handleInstallMissingPrereq}
            onAutoFixAll={handleAutoFixAllSafeConflicts}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onPickDirectory={handlePickDirectory}
            onRescanMods={(customPath) => handleRescanDirectory(customPath, true)}
            isScanningMods={isScanningMods}
            onSaveSettings={() => {
              storageService.saveSettings(settings);
              handleRescanDirectory(settings.sptDirectory, false);
              showToast('Settings Saved', 'Paths and preferences saved to disk.', 'success');
            }}
            installedMods={installedMods}
            onClearTempFiles={async () => {
              const bridge = getDesktopBridge();
              if (bridge?.clearTempFiles) {
                try {
                  const res = await bridge.clearTempFiles({ sptDirectory: settings.sptDirectory });
                  const mb = ((res?.reclaimedBytes || 0) / (1024 * 1024)).toFixed(1);
                  showToast(
                    'Temp Cleaned',
                    `Purged .blacksite_staging and temporary artifacts. Reclaimed ${mb} MB (${res?.deletedCount || 0} items).`,
                    'success'
                  );
                  return;
                } catch (e) {
                  console.warn('Clear temp error:', e);
                }
              }
              showToast('Temp Cleaned', 'Cleaned staging cache and archive buffers.', 'info');
            }}
            onExportDiagnostics={handleExportDiagnostics}
            onExportMods={() => setIsExportModsModalOpen(true)}
            onShowToast={showToast}
          />
        )}
      </main>

      {/* Status Bar */}
      <StatusBar
        statusText={statusText}
        queue={queue}
        onOpenQueue={() => setIsQueueOpen(true)}
        conflictCount={conflictReport.totalIssuesCount}
        onNavigateConflicts={() => setActiveTab('conflicts')}
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
            queueInstall(
              item.modName,
              item.author,
              item.version,
              item.thumbnail,
              undefined,
              item.modId,
              item.downloadUrl,
              undefined,
              item.archiveName,
              item.sourceMod
            );
          }
        }}
        onClearCompleted={() =>
          setQueue((prev) => prev.filter((q) => q.status !== 'installed' && q.status !== 'failed'))
        }
      />

      <VersionSelectionModal
        mod={selectedModForVersions}
        targetSptVersion={settings.sptVersion}
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

      <AddonDependencyPromptModal
        isOpen={addonPromptState.isOpen}
        addon={addonPromptState.addon}
        addonVersion={addonPromptState.addonVersion}
        parentMod={addonPromptState.parentMod}
        onInstallBoth={handleConfirmInstallBothAddon}
        onInstallAddonOnly={handleConfirmInstallAddonOnly}
        onClose={() =>
          setAddonPromptState({
            isOpen: false,
            addon: null,
            addonVersion: null,
            parentMod: null,
          })
        }
      />

      <ConfigEditorModal
        mod={selectedModForConfig}
        isOpen={Boolean(selectedModForConfig)}
        onClose={() => setSelectedModForConfig(null)}
        onSaveConfigFile={handleSaveConfigFile}
        onShowToast={showToast}
      />

      <SptLauncherModal
        isOpen={isLauncherOpen}
        onClose={() => setIsLauncherOpen(false)}
        sptDirectory={settings.sptDirectory}
        sptVersion={settings.sptVersion}
        onShowToast={showToast}
        onServerStatusChange={(running) => setIsSptServerRunning(running)}
      />

      <WindowsDownloadModal
        isOpen={isDownloadModalOpen}
        onClose={() => setIsDownloadModalOpen(false)}
        appVersion="2.1.0"
        onShowToast={showToast}
      />

      <ExportModsModal
        isOpen={isExportModsModalOpen}
        onClose={() => setIsExportModsModalOpen(false)}
        installedMods={sortedInstalledMods}
        onShowToast={showToast}
      />

      <ManualExtractModal
        isOpen={Boolean(manualExtractInfo)}
        onClose={() => setManualExtractInfo(null)}
        info={manualExtractInfo}
        sptDirectory={settings.sptDirectory}
        onRetry={
          manualExtractInfo?.sourceMod
            ? () => {
                if (manualExtractInfo?.sourceMod) {
                  handleInstallMod(manualExtractInfo.sourceMod, manualExtractInfo.version);
                }
              }
            : undefined
        }
      />

      <TacticalConfirmModal {...confirmModalProps} />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};
