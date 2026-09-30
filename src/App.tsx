import React, { useState, useEffect } from 'react';
import { CustomTitleBar } from './components/CustomTitleBar';
import { Header } from './components/Header';
import { BrowseModsTab } from './components/BrowseModsTab';
import { InstalledModsTab } from './components/InstalledModsTab';
import { SettingsTab } from './components/SettingsTab';
import { InstallQueueModal } from './components/InstallQueueModal';
import { VersionSelectionModal } from './components/VersionSelectionModal';
import { ConfigEditorModal } from './components/ConfigEditorModal';
import { ConflictResolverModal } from './components/ConflictResolverModal';
import { SptLauncherModal } from './components/SptLauncherModal';
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
  const [activeTab, setActiveTab] = useState<'browse' | 'installed' | 'settings'>('browse');

  // Modals
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [selectedModForVersions, setSelectedModForVersions] = useState<Mod | null>(null);
  const [selectedModForConfig, setSelectedModForConfig] = useState<InstalledMod | null>(null);
  const [selectedConflict, setSelectedConflict] = useState<ConflictInfo | null>(null);
  const [isLauncherOpen, setIsLauncherOpen] = useState(false);

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

  // Update conflict state when installed mods change
  useEffect(() => {
    const foundConflicts = storageService.detectConflicts(installedMods, ignoredConflicts);
    setConflicts(foundConflicts);
    storageService.saveInstalledMods(installedMods);
  }, [installedMods, ignoredConflicts]);

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

  // Queue & Installation Pipeline (respecting Parallel 7za-first & atomic Directory.Move design)
  const queueInstall = (modName: string, author: string, version: string, thumbnail: string, guid?: string, modId?: number) => {
    const queueId = `q-${Date.now()}-${Math.random()}`;
    const targetGuid = guid || `mod.${modName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

    const totalBytes = 12 * 1024 * 1024; // 12 MB
    const newQueueItem: QueueItem = {
      id: queueId,
      modId: modId || Date.now(),
      modName,
      author,
      version,
      thumbnail,
      status: 'downloading',
      progressPercent: 5,
      bytesReceived: 500000,
      totalBytes,
      downloadSpeed: '14.2 MB/s',
      archiveName: `${targetGuid}-${version}.zip`,
    };

    setQueue((prev) => [newQueueItem, ...prev]);
    setStatusText(`Downloading ${modName} v${version}...`);
    showToast('Download Started', `Queued ${modName} v${version} for installation.`, 'info');

    // Simulate multi-stage download -> extraction -> placement
    let currentPercent = 5;
    const interval = setInterval(() => {
      currentPercent += 20;

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
        // Stage 2: Extracting (7za-first)
        setQueue((prev) =>
          prev.map((item) =>
            item.id === queueId
              ? {
                  ...item,
                  status: 'extracting',
                  progressPercent: 100,
                  downloadSpeed: 'Extracting...',
                }
              : item
          )
        );
        setStatusText(`Extracting ${modName} with 7za engine...`);

        setTimeout(() => {
          // Stage 3: Routing & Placement
          setQueue((prev) =>
            prev.map((item) =>
              item.id === queueId
                ? {
                    ...item,
                    status: 'routing',
                    downloadSpeed: 'Routing...',
                  }
                : item
            )
          );
          setStatusText(`Routing ${modName} into SPT_Runtime/user/mods...`);

          setTimeout(() => {
            // Stage 4: Finished
            setQueue((prev) =>
              prev.map((item) =>
                item.id === queueId
                  ? {
                      ...item,
                      status: 'installed',
                      downloadSpeed: 'Complete',
                    }
                  : item
              )
            );
            setStatusText('Ready');

            // Add or update in installed mods list
            setInstalledMods((prev) => {
              const existingIdx = prev.findIndex((m) => m.id === targetGuid);
              const isServerMod = modName.toLowerCase().includes('server') || modName.toLowerCase().includes('trader');
              const isClientMod = modName.toLowerCase().includes('sain') || modName.toLowerCase().includes('brain') || modName.toLowerCase().includes('graphics');

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
                serverPath: isServerMod || !isClientMod ? `SPT_Runtime/user/mods/${modName.replace(/\s+/g, '')}` : undefined,
                clientPath: isClientMod || !isServerMod ? `BepInEx/plugins/${modName.replace(/\s+/g, '')}.dll` : undefined,
                isDisabled: false,
                hasUpdate: false,
                latestVersion: version,
                configFiles: [
                  {
                    id: `cfg-${Date.now()}`,
                    fileName: `${targetGuid}.json`,
                    relativePath: `BepInEx/config/${targetGuid}.json`,
                    fileType: 'json',
                    content: `{\n  "Enabled": true,\n  "Debug": false,\n  "Version": "${version}"\n}`,
                    originalContent: `{\n  "Enabled": true,\n  "Debug": false,\n  "Version": "${version}"\n}`,
                  },
                ],
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
              `Successfully installed ${modName} v${version}.`,
              'success'
            );
          }, 700);
        }, 800);
      }
    }, 250);
  };

  const handleInstallMod = (mod: Mod, specificVersion?: string) => {
    const version = specificVersion || mod.versions?.[0]?.version || '1.0.0';
    queueInstall(mod.name, mod.owner?.name || 'Unknown', version, mod.thumbnail, mod.guid || undefined, mod.id);
  };

  const handleSelectVersion = (mod: Mod, ver: ModVersion) => {
    setSelectedModForVersions(null);
    handleInstallMod(mod, ver.version);
  };

  const handleInstallFromFile = (file: File) => {
    const cleanName = file.name.replace(/\.(zip|7z|rar)$/i, '');
    queueInstall(cleanName, 'Local Archive', '1.0.0', '', undefined, undefined);
  };

  // Mod Management Actions
  const handleToggleMod = (modId: string) => {
    setInstalledMods((prev) =>
      prev.map((m) => {
        if (m.id === modId) {
          const newState = !m.isDisabled;
          showToast(
            newState ? 'Mod Disabled' : 'Mod Enabled',
            `${m.name} is now ${newState ? 'disabled (.disabled)' : 'active'}.`,
            'info'
          );
          return { ...m, isDisabled: newState };
        }
        return m;
      })
    );
  };

  const handleUninstallMod = (modId: string) => {
    const mod = installedMods.find((m) => m.id === modId);
    if (!mod) return;

    if (confirm(`Permanently uninstall "${mod.name}" and delete its files?`)) {
      setInstalledMods((prev) => prev.filter((m) => m.id !== modId));
      showToast('Mod Uninstalled', `Deleted ${mod.name} from SPT folder.`, 'warning');
    }
  };

  const handleUpdateMod = (mod: InstalledMod) => {
    if (!mod.latestVersion) return;
    showToast('Config-Safe Update', `Preserving configs and updating ${mod.name} to v${mod.latestVersion}...`, 'info');
    queueInstall(mod.name, mod.author, mod.latestVersion, mod.thumbnail || '', mod.id, mod.modId);
  };

  const handleEnableAll = () => {
    setInstalledMods((prev) => prev.map((m) => ({ ...m, isDisabled: false })));
    showToast('All Mods Enabled', 'Removed .disabled suffix from all installed mods.', 'success');
  };

  const handleDisableAll = () => {
    setInstalledMods((prev) => prev.map((m) => ({ ...m, isDisabled: true })));
    showToast('All Mods Disabled', 'Renamed all installed mod folders with .disabled suffix.', 'warning');
  };

  const handleUninstallAll = () => {
    if (confirm('Permanently delete ALL installed mods from your SPT folder? This cannot be undone.')) {
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

  const handleOpenFolder = (folderType: 'client' | 'server') => {
    const path = folderType === 'client' ? settings.clientModPath : settings.serverModPath;
    showToast(
      'Directory Explorer',
      `Opening ${settings.sptDirectory}\\${path.replace(/\//g, '\\')}`,
      'info'
    );
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
        onMinimize={() => showToast('Minimize', 'Minimized to taskbar.', 'info')}
        onMaximize={() => showToast('Maximize', 'Window maximized.', 'info')}
        onClose={() => showToast('Close', 'Closing Blacksite Mod Manager.', 'info')}
      />

      {/* Header */}
      <Header
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onPickDirectory={() => {
          const samplePaths = ['C:\\Games\\SPT-Tarkov', 'D:\\Games\\SPT-4.0', 'E:\\SPT'];
          const next = samplePaths[(samplePaths.indexOf(settings.sptDirectory) + 1) % samplePaths.length] || samplePaths[0];
          handleUpdateSettings({ sptDirectory: next });
          showToast('SPT Directory', `Set active SPT directory: ${next}`, 'info');
        }}
        onLaunchSpt={() => setIsLauncherOpen(true)}
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
            onShowToast={showToast}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
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
        onClose={() => setSelectedModForVersions(null)}
        onSelectVersion={handleSelectVersion}
      />

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

      {/* Toasts */}
      <ToastContainer toasts={toasts} onDismiss={handleDismissToast} />
    </div>
  );
};
