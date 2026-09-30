const { contextBridge, ipcRenderer } = require('electron');

// Expose safe desktop environment flags and helper APIs to renderer process
contextBridge.exposeInMainWorld('desktopBridge', {
  isElectron: true,
  platform: process.platform,
  version: process.env.npm_package_version || '1.8.0',
  selectDirectory: (defaultPath) => ipcRenderer.invoke('dialog:select-directory', defaultPath),
  fetchImageDataUrl: (url) => ipcRenderer.invoke('forge:fetch-image-data-url', url),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
});
