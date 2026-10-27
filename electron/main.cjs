const { app, BrowserWindow, shell, ipcMain, dialog, session, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// 1. Targeted Windows 11 (24H2/25H2) Stability Flags (Fixes exit code -2147483645)
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity,CalculateNativeWinOcclusion,WidgetLayering');
app.setAppUserModelId('com.blacksite.modmanager'); // Required for Win11 Taskbar icon grouping

// 2. Bounded Crash Logger with 2MB Automatic Rotation
const crashDir = path.join(
  process.env.LOCALAPPDATA ||
    (process.platform === 'win32'
      ? path.join(process.env.USERPROFILE || 'C:\\', 'AppData', 'Local')
      : path.join(require('os').homedir(), '.config')),
  'blacksite-mod-manager'
);
const crashLogPath = path.join(crashDir, 'crash.log');
const MAX_CRASH_LOG_BYTES = 2 * 1024 * 1024; // 2 MB cap

function logFatalError(context, err) {
  try {
    fs.mkdirSync(crashDir, { recursive: true });
    if (fs.existsSync(crashLogPath)) {
      const { size } = fs.statSync(crashLogPath);
      if (size > MAX_CRASH_LOG_BYTES) {
        const backup = `${crashLogPath}.old`;
        if (fs.existsSync(backup)) fs.unlinkSync(backup);
        fs.renameSync(crashLogPath, backup);
      }
    }
    const entry = `[${new Date().toISOString()}] [${context}] ${err?.stack || err?.message || String(err)}\n${'-'.repeat(72)}\n`;
    fs.appendFileSync(crashLogPath, entry, 'utf8');
  } catch (_) {}
}

process.on('uncaughtException', (err) => {
  logFatalError('UNCAUGHT_EXCEPTION', err);
});

process.on('unhandledRejection', (reason) => {
  logFatalError('UNHANDLED_REJECTION', reason);
});

let mainWindow = null;

function resolveDefaultAppIcon() {
  const candidates = [
    path.join(__dirname, '../public/app.ico'),
    path.join(__dirname, '../public/emblem.png'),
    path.join(__dirname, '../dist/emblem.png'),
    path.join(__dirname, 'emblem.png'),
  ];
  if (process.platform === 'win32') {
    const ico = candidates.find((c) => c.endsWith('.ico') && fs.existsSync(c));
    if (ico) return ico;
  }
  return candidates.find((c) => fs.existsSync(c)) || null;
}

function isAllowedExternalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && Boolean(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function isTrustedIpcSender(event) {
  if (!event || !event.sender) return false;
  if (mainWindow && !mainWindow.isDestroyed() && event.sender !== mainWindow.webContents) {
    return false;
  }
  const frame = event.senderFrame;
  if (frame) {
    // Require top-level frame (reject subframes/iframes)
    if (frame.parent !== null && frame.parent !== undefined) {
      return false;
    }
    const frameUrl = frame.url || '';
    if (frameUrl) {
      const isDevServer =
        process.env.VITE_DEV_SERVER_URL && frameUrl.startsWith(process.env.VITE_DEV_SERVER_URL);
      const isLocalFile = frameUrl.startsWith('file://');
      const isLocalhost =
        (!app.isPackaged || process.env.NODE_ENV === 'development') &&
        (frameUrl.startsWith('http://localhost:') || frameUrl.startsWith('http://127.0.0.1:'));
      if (!isDevServer && !isLocalFile && !isLocalhost) {
        return false;
      }
    }
  }
  return true;
}

function registerSafeIpcHandler(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedIpcSender(event)) {
      console.warn(`[Security] Blocked untrusted IPC call on channel "${channel}"`);
      throw new Error(`Unauthorized IPC sender for channel "${channel}"`);
    }
    return handler(event, ...args);
  });
}

function assertPlainObject(val, label = 'params') {
  if (!val || typeof val !== 'object' || Array.isArray(val)) {
    throw new Error(`Invalid IPC ${label}: expected object`);
  }
}

function assertNonEmptyString(val, label = 'value', maxLen = 4096) {
  if (typeof val !== 'string' || !val.trim() || val.length > maxLen) {
    throw new Error(`Invalid IPC ${label}: expected non-empty string`);
  }
  if (val.includes('\0')) {
    throw new Error(`Invalid IPC ${label}: null byte rejected`);
  }
  return val.trim();
}

function createWindow() {
  const windowIcon = resolveDefaultAppIcon();

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#121418',
    title: 'Blacksite Mod Manager - v2.1.0',
    icon: windowIcon,
    frame: false, // Frameless window - removes duplicate OS titlebar
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (windowIcon && fs.existsSync(windowIcon)) {
    try {
      mainWindow.setIcon(windowIcon);
    } catch (_) {}
  }

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

  // Security Guard: Prevent untrusted mod markdown/links from navigating the Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const appOrigin = mainWindow ? mainWindow.webContents.getURL() : '';
    if (appOrigin && !url.startsWith(appOrigin)) {
      event.preventDefault();
      if (isAllowedExternalUrl(url)) {
        shell.openExternal(url);
      }
    }
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

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    logFatalError('preload-error', error || new Error(`Preload error in ${preloadPath}`));
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logFatalError('render-process-gone', new Error(`Renderer gone: reason=${details.reason}, exitCode=${details.exitCode}`));
  });

  mainWindow.webContents.on('unresponsive', () => {
    logFatalError('unresponsive', new Error('MainWindow became unresponsive'));
  });
}

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  console.warn('Another instance is already running. Quitting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
  // Ensure Forge images loaded by <img> elements in the renderer bypass hotlink protection
  // and enforce a restrictive Content Security Policy (CSP) for both dev and packaged modes
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

    const isDevMode = process.env.NODE_ENV === 'development' || !app.isPackaged;
    const cspPolicy = [
      "default-src 'self'",
      isDevMode
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://*.sp-mod.com https://sp-mod.com https://*.sp-tarkov.com https://*.githubusercontent.com https://*.github.com https:",
      isDevMode
        ? "connect-src 'self' https://*.sp-mod.com https://sp-mod.com https://*.sp-tarkov.com https://*.github.com https://*.githubusercontent.com http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*"
        : "connect-src 'self' https://*.sp-mod.com https://sp-mod.com https://*.sp-tarkov.com https://*.github.com https://*.githubusercontent.com",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; ');

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      if (details.url.includes('sp-mod.com')) {
        responseHeaders['Access-Control-Allow-Origin'] = ['*'];
      }
      if (details.resourceType === 'mainFrame' || details.url.startsWith('file://') || details.url.startsWith('http://localhost')) {
        responseHeaders['Content-Security-Policy'] = [cspPolicy];
      }
      callback({ responseHeaders });
    });
  }

  const modInstaller = require('./modInstaller.cjs');
  const sptLauncher = require('./sptLauncher.cjs');

  let isShuttingDown = false;
  async function gracefulShutdownAndExit() {
    if (isShuttingDown) return;
    isShuttingDown = true;

    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }
    } catch (_) {}

    // Hard failsafe timer so the process can never hang in Task Manager
    const hardExitTimer = setTimeout(() => {
      process.exit(0);
    }, 2800);
    if (typeof hardExitTimer.unref === 'function') {
      hardExitTimer.unref();
    }

    try {
      const status = sptLauncher.getSptStatus();
      if (status && status.isRunning) {
        await Promise.race([
          sptLauncher.stopSptServer(null, 2000),
          new Promise((r) => setTimeout(r, 2200)),
        ]);
      }
    } catch (_) {}

    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.destroy();
      }
    } catch (_) {}

    try {
      app.quit();
    } catch (_) {}

    setTimeout(() => {
      process.exit(0);
    }, 300).unref?.();
  }

  // Native Window Titlebar Controls (Minimize, Maximize/Restore, Close)
  registerSafeIpcHandler('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (win && !win.isDestroyed()) {
      win.minimize();
      return true;
    }
    return false;
  });

  registerSafeIpcHandler('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (win && !win.isDestroyed()) {
      if (win.isMaximized()) {
        win.unmaximize();
        return false;
      } else {
        win.maximize();
        return true;
      }
    }
    return false;
  });

  registerSafeIpcHandler('window:close', async () => {
    await gracefulShutdownAndExit();
    return true;
  });

  registerSafeIpcHandler('window:is-maximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (win && !win.isDestroyed()) {
      return win.isMaximized();
    }
    return false;
  });

  // 4. Live Custom Emblem & Windows 11 Taskbar Icon Updater (Normalized to 256x256)
  registerSafeIpcHandler('branding:update-icon', async (_event, imageBuffer) => {
    if (!mainWindow || !imageBuffer) return false;
    try {
      const buf = Buffer.from(imageBuffer);
      if (buf.length === 0 || buf.length > 10 * 1024 * 1024) return false;
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) return false;
      const resized = img.resize({ width: 256, height: 256, quality: 'best' });
      mainWindow.setIcon(resized);
      return true;
    } catch {
      return false;
    }
  });

  // Dynamic native window and taskbar icon update
  registerSafeIpcHandler('app:set-custom-emblem', async (_event, dataUrl) => {
    try {
      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        typeof dataUrl === 'string' &&
        dataUrl.startsWith('data:image/') &&
        dataUrl.length <= 10 * 1024 * 1024
      ) {
        const icon = nativeImage.createFromDataURL(dataUrl);
        if (!icon.isEmpty()) {
          const resized = icon.resize({ width: 256, height: 256, quality: 'best' });
          mainWindow.setIcon(resized);
          return true;
        }
      }
    } catch (e) {
      console.warn('Could not set custom window icon:', e);
    }
    return false;
  });

  registerSafeIpcHandler('app:reset-custom-emblem', async () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const iconPath = resolveDefaultAppIcon();
        if (iconPath && fs.existsSync(iconPath)) {
          mainWindow.setIcon(iconPath);
          return true;
        }
      }
    } catch (e) {
      console.warn('Could not reset window icon:', e);
    }
    return false;
  });

  // Open directory in native OS File Explorer (Plugins, Server, Mod Folders)
  registerSafeIpcHandler('shell:open-folder', async (_event, targetPath) => {
    if (!targetPath || typeof targetPath !== 'string' || targetPath.includes('\0') || targetPath.length > 4096) {
      return false;
    }
    try {
      const normalizedInput = path.resolve(targetPath.trim().replace(/[\\/]+/g, path.sep));
      const candidatePaths = [normalizedInput];

      // Also check .disabled variant and SPT 3.x / 4.x server mod layout variants
      candidatePaths.push(`${normalizedInput}.disabled`);
      if (normalizedInput.toLowerCase().endsWith('.disabled')) {
        candidatePaths.push(normalizedInput.slice(0, -'.disabled'.length));
      }

      const layoutVariants = [
        [`SPT_Runtime${path.sep}user${path.sep}mods`, `SPT${path.sep}user${path.sep}mods`],
        [`SPT_Runtime${path.sep}user${path.sep}mods`, `user${path.sep}mods`],
        [`SPT${path.sep}user${path.sep}mods`, `SPT_Runtime${path.sep}user${path.sep}mods`],
        [`SPT${path.sep}user${path.sep}mods`, `user${path.sep}mods`],
        [`user${path.sep}mods`, `SPT${path.sep}user${path.sep}mods`],
        [`user${path.sep}mods`, `SPT_Runtime${path.sep}user${path.sep}mods`],
      ];
      for (const [fromSeg, toSeg] of layoutVariants) {
        if (normalizedInput.includes(fromSeg)) {
          const alt = normalizedInput.replace(fromSeg, toSeg);
          candidatePaths.push(alt, `${alt}.disabled`);
        }
      }

      let pathToOpen = candidatePaths.find((p) => fs.existsSync(p)) || null;

      // Walk up parent directories (up to 4 levels, stopping before bare drive root like C:\)
      if (!pathToOpen) {
        for (const baseCandidate of candidatePaths) {
          let current = baseCandidate;
          for (let depth = 0; depth < 4; depth++) {
            const parentDir = path.dirname(current);
            if (!parentDir || parentDir === current) break;
            if (/^[a-zA-Z]:\\?$/.test(parentDir)) break;
            if (fs.existsSync(parentDir)) {
              pathToOpen = parentDir;
              break;
            }
            current = parentDir;
          }
          if (pathToOpen) break;
        }
      }

      if (!pathToOpen || !fs.existsSync(pathToOpen)) {
        console.warn(`Target path does not exist: ${normalizedInput}`);
        return false;
      }

      const resolvedOpenPath = path.resolve(pathToOpen);
      const stat = fs.statSync(resolvedOpenPath);
      if (stat.isFile()) {
        shell.showItemInFolder(resolvedOpenPath);
        return true;
      }

      const err = await shell.openPath(resolvedOpenPath);
      if (err) {
        console.warn('shell.openPath warning, trying explorer.exe fallback:', err);
        if (process.platform === 'win32') {
          const { spawn } = require('child_process');
          const child = spawn('explorer.exe', [resolvedOpenPath], {
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
          });
          child.unref();
          return true;
        }
        return false;
      }
      return true;
    } catch (err) {
      console.error('Failed to open directory in file explorer:', err);
      return false;
    }
  });

  // Highlight specific file in native OS File Explorer
  registerSafeIpcHandler('shell:show-item-in-folder', async (_event, fullPath) => {
    if (!fullPath || typeof fullPath !== 'string' || fullPath.includes('\0') || fullPath.length > 4096) {
      return false;
    }
    try {
      const resolved = path.resolve(fullPath.trim().replace(/[\\/]+/g, path.sep));
      if (fs.existsSync(resolved)) {
        shell.showItemInFolder(resolved);
        return true;
      }
      return false;
    } catch (err) {
      console.error('shell.showItemInFolder error:', err);
      return false;
    }
  });

  // Native directory picker dialog for SPT folder
  registerSafeIpcHandler('dialog:select-directory', async (event, defaultPath) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    let validDefaultPath = undefined;
    if (defaultPath && typeof defaultPath === 'string' && !defaultPath.includes('\0') && defaultPath.length <= 4096) {
      try {
        if (fs.existsSync(defaultPath)) {
          validDefaultPath = defaultPath;
        } else if (fs.existsSync(path.dirname(defaultPath))) {
          validDefaultPath = path.dirname(defaultPath);
        }
      } catch (_) {}
    }

    const result = await dialog.showOpenDialog(parentWindow, {
      title: 'Select Single Player Tarkov (SPT) Root Folder',
      defaultPath: validDefaultPath,
      properties: ['openDirectory', 'dontAddToRecent'],
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }

    return modInstaller.normalizeSptRoot(result.filePaths[0]);
  });

  // Inspect SPT root directory on disk (normalizes path, detects SPT version, server binary, and layout)
  registerSafeIpcHandler('spt:inspect-directory', async (_event, targetPath) => {
    try {
      if (typeof targetPath === 'object' && targetPath !== null) {
        const cleanDir = assertNonEmptyString(targetPath.sptDirectory || targetPath.targetPath, 'sptDirectory');
        return modInstaller.inspectSptDirectory(cleanDir, targetPath);
      }
      const cleanPath = assertNonEmptyString(targetPath, 'targetPath');
      return modInstaller.inspectSptDirectory(cleanPath);
    } catch (err) {
      console.error('spt:inspect-directory error:', err);
      return {
        normalizedPath: typeof targetPath === 'string' ? targetPath : '',
        exists: false,
        isValidSptRoot: false,
        sptVersion: null,
        detectedServerBinary: null,
        serverModPath: 'SPT/user/mods',
        clientModPath: 'BepInEx/plugins',
        isSpt4xLayout: true,
      };
    }
  });

  // Safe fallback to fetch Forge image via Node and return Base64 data URL
  registerSafeIpcHandler('forge:fetch-image-data-url', async (_event, imageUrl) => {
    if (!isAllowedExternalUrl(imageUrl)) return null;
    try {
      const parsed = new URL(imageUrl.trim());
      if (parsed.protocol !== 'https:') return null;

      const response = await fetch(parsed.toString(), {
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
      if (!contentType.startsWith('image/')) {
        return null;
      }
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > 15 * 1024 * 1024) {
        return null;
      }
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      return `data:${contentType};base64,${base64}`;
    } catch (err) {
      console.error('IPC fetch image error:', err);
      return null;
    }
  });

  // Safe external URL opener (strict URL parsing + scheme allowlist)
  registerSafeIpcHandler('shell:open-external', async (_event, url) => {
    if (!isAllowedExternalUrl(url)) {
      console.warn(`[Security] Blocked invalid or disallowed external URL: ${String(url)}`);
      return false;
    }
    const parsed = new URL(url.trim());
    await shell.openExternal(parsed.toString());
    return true;
  });

  registerSafeIpcHandler('mod:install', async (event, params) => {
    try {
      assertPlainObject(params, 'mod:install params');
      const sptDirectory = assertNonEmptyString(params.sptDirectory, 'sptDirectory');
      const modName = assertNonEmptyString(params.modName || 'Mod', 'modName', 512);
      if (params.downloadUrl !== undefined && params.downloadUrl !== null && params.downloadUrl !== '') {
        assertNonEmptyString(params.downloadUrl, 'downloadUrl', 4096);
      }

      const sender = event.sender;
      const onProgress = (progressData) => {
        if (sender && !sender.isDestroyed()) {
          sender.send('mod:install-progress', {
            queueId: params.queueId,
            modName,
            ...progressData,
          });
        }
      };

      const result = await modInstaller.installMod({
        ...params,
        sptDirectory,
        modName,
        onProgress,
      });
      return { success: true, ...result };
    } catch (err) {
      console.error('mod:install error:', err);
      return {
        success: false,
        error: err.message,
        errorCode:
          err.code ||
          (err.statusCode === 404
            ? 'ERR_NOT_FOUND_404'
            : err.canManualExtract
            ? 'ERR_EXTRACTION_FAILED'
            : 'ERR_INSTALL_FAILED'),
        stack: err.stack,
        statusCode: err.statusCode || (err.code === 'ERR_NOT_FOUND_404' ? 404 : 500),
        canManualExtract: Boolean(err.canManualExtract && err.code !== 'ERR_UNSAFE_ARCHIVE'),
        archivePath: err.archivePath || null,
        destinationDir: err.destinationDir || null,
        format: err.format || null,
        archiveSizeMb: err.archiveSizeMb || null,
      };
    }
  });

  registerSafeIpcHandler('mod:uninstall', async (_event, params) => {
    try {
      assertPlainObject(params, 'mod:uninstall params');
      assertNonEmptyString(params.sptDirectory, 'sptDirectory');
      return await modInstaller.uninstallMod(params);
    } catch (err) {
      console.error('mod:uninstall error:', err);
      return { success: false, error: err.message };
    }
  });

  registerSafeIpcHandler('mod:uninstall-all', async (_event, params) => {
    try {
      assertPlainObject(params, 'mod:uninstall-all params');
      assertNonEmptyString(params.sptDirectory, 'sptDirectory');
      return await modInstaller.uninstallAllMods(params);
    } catch (err) {
      console.error('mod:uninstall-all error:', err);
      return { success: false, error: err.message };
    }
  });

  registerSafeIpcHandler('mod:toggle-disable', async (_event, params) => {
    try {
      assertPlainObject(params, 'mod:toggle-disable params');
      assertNonEmptyString(params.sptDirectory, 'sptDirectory');
      return await modInstaller.toggleModDisable(params);
    } catch (err) {
      console.error('mod:toggle-disable error:', err);
      return { success: false, error: err.message };
    }
  });

  registerSafeIpcHandler('mod:scan-installed', async (_event, params) => {
    try {
      assertPlainObject(params, 'mod:scan-installed params');
      assertNonEmptyString(params.sptDirectory, 'sptDirectory');
      return await modInstaller.scanInstalledMods(params);
    } catch (err) {
      console.error('mod:scan-installed error:', err);
      return [];
    }
  });

  registerSafeIpcHandler('mod:save-config', async (_event, params) => {
    try {
      assertPlainObject(params, 'mod:save-config params');
      assertNonEmptyString(params.sptDirectory, 'sptDirectory');
      assertNonEmptyString(params.relativePath, 'relativePath');
      if (typeof params.content !== 'string') {
        throw new Error('Invalid config content: expected string');
      }
      return await modInstaller.saveModConfigFile(params);
    } catch (err) {
      console.error('mod:save-config error:', err);
      return { success: false, error: err.message };
    }
  });

  registerSafeIpcHandler('mod:clear-temp', async (_event, params) => {
    try {
      if (params !== undefined && params !== null) {
        assertPlainObject(params, 'mod:clear-temp params');
      }
      return await modInstaller.clearTempDirectories(params || {});
    } catch (err) {
      console.error('mod:clear-temp error:', err);
      return { success: false, error: err.message, reclaimedBytes: 0, deletedCount: 0 };
    }
  });

  registerSafeIpcHandler('profile:relink-vfs', async (_event, params) => {
    try {
      assertPlainObject(params, 'profile:relink-vfs params');
      assertNonEmptyString(params.sptDirectory, 'sptDirectory');
      return await modInstaller.relinkVfsProfile(params);
    } catch (err) {
      console.error('profile:relink-vfs error:', err);
      return { success: false, error: err.message };
    }
  });

  registerSafeIpcHandler('profile:scan-player-saves', async (_event, params) => {
    try {
      assertPlainObject(params, 'profile:scan-player-saves params');
      assertNonEmptyString(params.sptDirectory, 'sptDirectory');
      return await modInstaller.scanSptPlayerProfiles(params);
    } catch (err) {
      console.error('profile:scan-player-saves error:', err);
      return [];
    }
  });

  registerSafeIpcHandler('spt:launch', async (event, params) => {
    try {
      assertPlainObject(params, 'spt:launch params');
      assertNonEmptyString(params.sptDirectory, 'sptDirectory');
      const sender = event.sender;
      const onLog = (logData) => {
        if (sender && !sender.isDestroyed()) {
          sender.send('spt:server-log', logData);
        }
      };
      const onClientLaunched = (clientData) => {
        if (sender && !sender.isDestroyed()) {
          sender.send('spt:client-launched', clientData);
        }
      };
      const onServerExit = (exitData) => {
        if (sender && !sender.isDestroyed()) {
          sender.send('spt:server-exit', exitData);
        }
      };

      const result = await sptLauncher.launchSptSequence({
        ...params,
        onLog,
        onClientLaunched,
        onServerExit,
      });
      return { success: true, ...result };
    } catch (err) {
      console.error('spt:launch error:', err);
      return { success: false, error: err.message };
    }
  });

  registerSafeIpcHandler('spt:stop', async (event) => {
    try {
      const sender = event.sender;
      const onLog = (logData) => {
        if (sender && !sender.isDestroyed()) {
          sender.send('spt:server-log', logData);
        }
      };
      return await sptLauncher.stopSptServer(onLog);
    } catch (err) {
      console.error('spt:stop error:', err);
      return { success: false, error: err.message };
    }
  });

  registerSafeIpcHandler('spt:status', async () => {
    try {
      return sptLauncher.getSptStatus();
    } catch (err) {
      return { isRunning: false, error: err.message };
    }
  });

  app.on('before-quit', () => {
    try {
      sptLauncher.stopSptServer();
    } catch {}
  });

  createWindow();
  if (mainWindow) {
    mainWindow.on('close', (e) => {
      if (!isShuttingDown) {
        e.preventDefault();
        gracefulShutdownAndExit();
      }
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    setTimeout(() => {
      process.exit(0);
    }, 300).unref?.();
  }
});
