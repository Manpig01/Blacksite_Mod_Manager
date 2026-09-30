const { contextBridge } = require('electron');

// Expose safe desktop environment flags and helper APIs to renderer process
contextBridge.exposeInMainWorld('desktopBridge', {
  isElectron: true,
  platform: process.platform,
  version: process.env.npm_package_version || '1.8.0',
});
