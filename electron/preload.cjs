const { contextBridge, ipcRenderer } = require('electron');

function getSafeCpuCount() {
  try {
    if (typeof navigator !== 'undefined' && Number(navigator.hardwareConcurrency) > 0) {
      return Number(navigator.hardwareConcurrency);
    }
  } catch (_) {}
  return 4;
}

// Expose safe desktop environment flags and helper APIs to sandboxed renderer process
contextBridge.exposeInMainWorld('desktopBridge', {
  isElectron: true,
  platform: (typeof process !== 'undefined' && process.platform) || 'win32',
  version: '2.1.0',
  cpuCount: getSafeCpuCount(),
  selectDirectory: (defaultPath) => ipcRenderer.invoke('dialog:select-directory', defaultPath),
  inspectSptDirectory: (targetPath) => ipcRenderer.invoke('spt:inspect-directory', targetPath),
  fetchImageDataUrl: (url) => ipcRenderer.invoke('forge:fetch-image-data-url', url),
  openFolder: (targetPath) => ipcRenderer.invoke('shell:open-folder', targetPath),
  showItemInFolder: (targetPath) => ipcRenderer.invoke('shell:show-item-in-folder', targetPath),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  installMod: (params) => ipcRenderer.invoke('mod:install', params),
  onInstallProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('mod:install-progress', listener);
    return () => ipcRenderer.removeListener('mod:install-progress', listener);
  },
  uninstallMod: (params) => ipcRenderer.invoke('mod:uninstall', params),
  uninstallAllMods: (params) => ipcRenderer.invoke('mod:uninstall-all', params),
  toggleDisableMod: (params) => ipcRenderer.invoke('mod:toggle-disable', params),
  scanInstalledMods: (params) => ipcRenderer.invoke('mod:scan-installed', params),
  saveModConfigFile: (params) => ipcRenderer.invoke('mod:save-config', params),
  relinkVfsProfile: (params) => ipcRenderer.invoke('profile:relink-vfs', params),
  scanSptPlayerProfiles: (params) => ipcRenderer.invoke('profile:scan-player-saves', params),
  clearTempFiles: (params) => ipcRenderer.invoke('mod:clear-temp', params),
  launchSpt: (params) => ipcRenderer.invoke('spt:launch', params),
  stopSptServer: () => ipcRenderer.invoke('spt:stop'),
  getSptStatus: () => ipcRenderer.invoke('spt:status'),
  onSptServerLog: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('spt:server-log', listener);
    return () => ipcRenderer.removeListener('spt:server-log', listener);
  },
  onSptClientLaunched: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('spt:client-launched', listener);
    return () => ipcRenderer.removeListener('spt:client-launched', listener);
  },
  onSptServerExit: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('spt:server-exit', listener);
    return () => ipcRenderer.removeListener('spt:server-exit', listener);
  },
  setCustomEmblem: (dataUrl) => ipcRenderer.invoke('app:set-custom-emblem', dataUrl),
  updateAppIcon: (buffer) => ipcRenderer.invoke('branding:update-icon', buffer),
  resetCustomEmblem: () => ipcRenderer.invoke('app:reset-custom-emblem'),
  windowControl: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (callback) => {
      const listener = (_event, isMaximized) => callback(isMaximized);
      ipcRenderer.on('window:maximized-change', listener);
      return () => ipcRenderer.removeListener('window:maximized-change', listener);
    },
  },
});
