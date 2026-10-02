const { contextBridge, ipcRenderer } = require('electron');

// Expose safe desktop environment flags and helper APIs to renderer process
contextBridge.exposeInMainWorld('desktopBridge', {
  isElectron: true,
  platform: process.platform,
  version: process.env.npm_package_version || '1.8.0',
  selectDirectory: (defaultPath) => ipcRenderer.invoke('dialog:select-directory', defaultPath),
  fetchImageDataUrl: (url) => ipcRenderer.invoke('forge:fetch-image-data-url', url),
  openFolder: (targetPath) => ipcRenderer.invoke('shell:open-folder', targetPath),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  installMod: (params) => ipcRenderer.invoke('mod:install', params),
  uninstallMod: (params) => ipcRenderer.invoke('mod:uninstall', params),
  toggleDisableMod: (params) => ipcRenderer.invoke('mod:toggle-disable', params),
  scanInstalledMods: (params) => ipcRenderer.invoke('mod:scan-installed', params),
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
