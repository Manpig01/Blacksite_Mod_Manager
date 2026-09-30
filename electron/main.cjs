const { app, BrowserWindow, shell, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#121418',
    title: 'Blacksite Mod Manager',
    frame: false, // Frameless window - removes duplicate OS titlebar
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Enable dark mode background
  mainWindow.setBackgroundColor('#121418');

  // Remove default menu bar for clean tactical appearance
  mainWindow.removeMenu();

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // In production, load the built Vite bundle
    const indexPath = path.join(__dirname, '../dist/index.html');
    mainWindow.loadFile(indexPath).catch((err) => {
      console.error('Failed to load application entry point:', err);
    });
  }

  // Handle external links safely via default OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized-change', true);
    }
  });

  mainWindow.on('unmaximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized-change', false);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Ensure Forge images loaded by <img> elements in the renderer bypass hotlink protection
  if (session && session.defaultSession) {
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: ['*://*.sp-mod.com/*', '*://sp-mod.com/*'] },
      (details, callback) => {
        details.requestHeaders['Referer'] = 'https://sp-mod.com/';
        details.requestHeaders['User-Agent'] =
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        details.requestHeaders['Accept'] =
          'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
        callback({ requestHeaders: details.requestHeaders });
      }
    );

    session.defaultSession.webRequest.onHeadersReceived(
      { urls: ['*://*.sp-mod.com/*', '*://sp-mod.com/*'] },
      (details, callback) => {
        const responseHeaders = { ...details.responseHeaders };
        responseHeaders['Access-Control-Allow-Origin'] = ['*'];
        callback({ responseHeaders });
      }
    );
  }

  // Native Window Titlebar Controls (Minimize, Maximize/Restore, Close)
  ipcMain.handle('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
      return true;
    }
    return false;
  });

  ipcMain.handle('window:maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
        return false;
      } else {
        mainWindow.maximize();
        return true;
      }
    }
    return false;
  });

  ipcMain.handle('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
      return true;
    }
    return false;
  });

  ipcMain.handle('window:is-maximized', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      return mainWindow.isMaximized();
    }
    return false;
  });

  // Open directory in native OS File Explorer (Plugins, Server, Mod Folders)
  ipcMain.handle('shell:open-folder', async (event, targetPath) => {
    if (!targetPath || typeof targetPath !== 'string') return false;
    try {
      // Ensure the directory exists so Explorer can open it without error
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
      }
      const err = await shell.openPath(targetPath);
      if (err) {
        console.error('shell.openPath error:', err);
        return false;
      }
      return true;
    } catch (err) {
      console.error('Failed to open directory in file explorer:', err);
      return false;
    }
  });

  // Native directory picker dialog for SPT folder
  ipcMain.handle('dialog:select-directory', async (event, defaultPath) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showOpenDialog(parentWindow, {
      title: 'Select Single Player Tarkov (SPT) Root Folder',
      defaultPath: defaultPath && typeof defaultPath === 'string' ? defaultPath : undefined,
      properties: ['openDirectory', 'dontAddToRecent'],
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // Safe fallback to fetch Forge image via Node and return Base64 data URL
  ipcMain.handle('forge:fetch-image-data-url', async (event, imageUrl) => {
    if (!imageUrl || typeof imageUrl !== 'string') return null;
    try {
      const response = await fetch(imageUrl, {
        headers: {
          'Referer': 'https://sp-mod.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        return null;
      }

      const contentType = response.headers.get('content-type') || 'image/png';
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      return `data:${contentType};base64,${base64}`;
    } catch (err) {
      console.error('IPC fetch image error:', err);
      return null;
    }
  });

  // Safe external URL opener
  ipcMain.handle('shell:open-external', async (event, url) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      await shell.openExternal(url);
      return true;
    }
    return false;
  });

  // Real SPT Mod Installation & File Management Engine
  const modInstaller = require('./modInstaller.cjs');

  ipcMain.handle('mod:install', async (event, params) => {
    try {
      const result = await modInstaller.installMod(params);
      return { success: true, ...result };
    } catch (err) {
      console.error('mod:install error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('mod:uninstall', async (event, params) => {
    try {
      return await modInstaller.uninstallMod(params);
    } catch (err) {
      console.error('mod:uninstall error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('mod:toggle-disable', async (event, params) => {
    try {
      return await modInstaller.toggleModDisable(params);
    } catch (err) {
      console.error('mod:toggle-disable error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('mod:scan-installed', async (event, params) => {
    try {
      return await modInstaller.scanInstalledMods(params);
    } catch (err) {
      console.error('mod:scan-installed error:', err);
      return [];
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
