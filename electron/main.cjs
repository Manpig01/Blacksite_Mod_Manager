const { app, BrowserWindow, shell, ipcMain, dialog, session } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#121418',
    title: 'Blacksite Mod Manager',
    titleBarStyle: 'default',
    frame: true,
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
