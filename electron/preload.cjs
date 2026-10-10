const { contextBridge, ipcRenderer } = require('electron');

// Expose safe desktop environment flags and helper APIs to renderer process
contextBridge.exposeInMainWorld('desktopBridge', {
  isElectron: true,
  platform: process.platform,
  version: process.env.npm_package_version || '2.0.0',
  cpuCount: require('os').cpus()?.length || 4,
  selectDirectory: (defaultPath) => ipcRenderer.invoke('dialog:select-directory', defaultPath),
  fetchImageDataUrl: (url) => ipcRenderer.invoke('forge:fetch-image-data-url', url),
  openFolder: (targetPath) => ipcRenderer.invoke('shell:open-folder', targetPath),
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
