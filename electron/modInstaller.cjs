const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { Readable } = require('stream');
const sevenZip = require('7zip-bin');
const AdmZip = require('adm-zip');

/**
 * Resolves 7za binary path safely inside or outside Electron ASAR
 */
function get7zaPath() {
  let bin = sevenZip.path7za;
  if (bin && bin.includes('app.asar')) {
    bin = bin.replace('app.asar', 'app.asar.unpacked');
  }
  return bin;
}

/**
 * Robust archive extraction using 7za-first, falling back to AdmZip, tar, and PowerShell
 */
async function extractArchive(archivePath, destinationDir, onProgress, queueId) {
  fs.mkdirSync(destinationDir, { recursive: true });

  if (onProgress) {
    onProgress({
      queueId,
      stage: 'extracting',
      percent: 75,
      speed: 'Decompressing...',
      detail: 'Decompressing archive with high-speed engine...',
    });
  }

  // 1. Try precompiled 7za binary
  const bin7za = get7zaPath();
  if (bin7za && fs.existsSync(bin7za)) {
    try {
      await new Promise((resolve, reject) => {
        execFile(bin7za, ['x', '-y', `-o${destinationDir}`, archivePath], (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      return true;
    } catch (err) {
      console.warn('7za extraction failed, attempting fallback...', err.message);
    }
  }

  // 2. Try AdmZip for standard zip files
  try {
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(destinationDir, true);
    return true;
  } catch (zipErr) {
    console.warn('AdmZip extraction failed, trying system tools...', zipErr.message);
  }

  // 3. Try Windows built-in tar.exe or system tar
  try {
    await new Promise((resolve, reject) => {
      execFile('tar', ['-xf', archivePath, '-C', destinationDir], (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    return true;
  } catch (tarErr) {
    console.warn('System tar failed...', tarErr.message);
  }

  // 4. Try PowerShell Expand-Archive on Windows
  if (process.platform === 'win32') {
    await new Promise((resolve, reject) => {
      const psCmd = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destinationDir.replace(/'/g, "''")}' -Force`;
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd], (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    return true;
  }

  throw new Error('Unable to extract archive with any available decompression engine.');
}

/**
 * Recursively find directories matching specific names (e.g. 'user', 'BepInEx')
 */
function findMatchingDirs(root, targetNames, maxDepth = 4, currentDepth = 0) {
  const matches = [];
  if (currentDepth > maxDepth || !fs.existsSync(root)) return matches;
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const full = path.join(root, entry.name);
        if (targetNames.map((n) => n.toLowerCase()).includes(entry.name.toLowerCase())) {
          matches.push(full);
        } else {
          matches.push(...findMatchingDirs(full, targetNames, maxDepth, currentDepth + 1));
        }
      }
    }
  } catch (err) {
    // ignore permission or access errors
  }
  return matches;
}

/**
 * Recursively find package.json or dll files inside extracted directory
 */
function findFileRecursive(dir, targetName, maxDepth = 4, currentDepth = 0) {
  if (currentDepth > maxDepth || !fs.existsSync(dir)) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (!entry.isDirectory() && entry.name.toLowerCase() === targetName.toLowerCase()) {
        return fullPath;
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = findFileRecursive(path.join(dir, entry.name), targetName, maxDepth, currentDepth + 1);
        if (found) return found;
      }
    }
  } catch (err) {
    // ignore
  }

  return null;
}

/**
 * Intelligent SPT Routing Engine:
 * Analyzes extracted directory tree (including SPT_Runtime, SPT containers, and nested folders)
 * and places user/mods and BepInEx/plugins/patchers into the target SPT installation.
 */
function routeExtractedModToSpt(extractedDir, sptDirectory, fallbackModName) {
  fs.mkdirSync(path.join(sptDirectory, 'user', 'mods'), { recursive: true });
  fs.mkdirSync(path.join(sptDirectory, 'BepInEx', 'plugins'), { recursive: true });

  const cleanName = (fallbackModName || 'Mod').replace(/[^\w.-]/g, '');
  let detectedServerPath = null;
  let detectedClientPath = null;

  // 1. Discover all 'user' directories (handles SPT_Runtime/user, SPT/user, user/, etc.)
  const userDirs = findMatchingDirs(extractedDir, ['user']);
  for (const userDir of userDirs) {
    try {
      fs.cpSync(userDir, path.join(sptDirectory, 'user'), { recursive: true, force: true });
      const modsSub = path.join(userDir, 'mods');
      if (fs.existsSync(modsSub)) {
        const modEntries = fs.readdirSync(modsSub, { withFileTypes: true });
        for (const entry of modEntries) {
          if (entry.isDirectory()) {
            detectedServerPath = `user/mods/${entry.name}`;
            break;
          }
        }
      }
    } catch (err) {
      console.warn('Error copying user directory:', err);
    }
  }

  // 2. Discover all 'BepInEx' directories (handles SPT_Runtime/BepInEx, BepInEx/, etc.)
  const bepDirs = findMatchingDirs(extractedDir, ['BepInEx']);
  for (const bepDir of bepDirs) {
    try {
      fs.cpSync(bepDir, path.join(sptDirectory, 'BepInEx'), { recursive: true, force: true });
      const pluginsSub = path.join(bepDir, 'plugins');
      if (fs.existsSync(pluginsSub)) {
        const pluginEntries = fs.readdirSync(pluginsSub, { withFileTypes: true });
        for (const entry of pluginEntries) {
          if (entry.isDirectory()) {
            detectedClientPath = `BepInEx/plugins/${entry.name}`;
            break;
          } else if (entry.name.toLowerCase().endsWith('.dll')) {
            detectedClientPath = `BepInEx/plugins/${entry.name}`;
            break;
          }
        }
      }
      // Also check patchers if plugins had none
      if (!detectedClientPath) {
        const patchersSub = path.join(bepDir, 'patchers');
        if (fs.existsSync(patchersSub)) {
          const patcherEntries = fs.readdirSync(patchersSub, { withFileTypes: true });
          if (patcherEntries.length > 0) {
            detectedClientPath = `BepInEx/patchers/${patcherEntries[0].name}`;
          }
        }
      }
    } catch (err) {
      console.warn('Error copying BepInEx directory:', err);
    }
  }

  // 3. Case 2: Standalone Server Mod (contains package.json outside user/mods)
  if (!detectedServerPath) {
    const pkgJsonPath = findFileRecursive(extractedDir, 'package.json');
    if (pkgJsonPath) {
      try {
        const pkgFolder = path.dirname(pkgJsonPath);
        const pkgData = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        const modFolderName = pkgData.name || cleanName;
        const targetServerDir = path.join(sptDirectory, 'user', 'mods', modFolderName);
        fs.cpSync(pkgFolder, targetServerDir, { recursive: true, force: true });
        detectedServerPath = `user/mods/${modFolderName}`;
      } catch (e) {
        console.error('Failed reading mod package.json:', e);
      }
    }
  }

  // 4. Case 3: Standalone Client Plugin (contains .dll files outside BepInEx)
  if (!detectedClientPath) {
    function findAnyDll(dir, maxDepth = 4, depth = 0) {
      if (depth > maxDepth || !fs.existsSync(dir)) return null;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() && entry.name.toLowerCase().endsWith('.dll')) {
            return path.join(dir, entry.name);
          }
        }
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const found = findAnyDll(path.join(dir, entry.name), maxDepth, depth + 1);
            if (found) return found;
          }
        }
      } catch {}
      return null;
    }

    const anyDll = findAnyDll(extractedDir);
    if (anyDll) {
      const dllDir = path.dirname(anyDll);
      const dllName = path.basename(anyDll);
      const targetPluginDir = path.join(sptDirectory, 'BepInEx', 'plugins');

      const siblingFiles = fs.readdirSync(dllDir);
      if (siblingFiles.length > 2) {
        const targetFolder = path.join(targetPluginDir, cleanName);
        fs.cpSync(dllDir, targetFolder, { recursive: true, force: true });
        detectedClientPath = `BepInEx/plugins/${cleanName}/${dllName}`;
      } else {
        fs.copyFileSync(anyDll, path.join(targetPluginDir, dllName));
        detectedClientPath = `BepInEx/plugins/${dllName}`;
      }
    }
  }

  // Determine actual mod installation classification
  const kind =
    detectedServerPath && detectedClientPath
      ? 'Both'
      : detectedServerPath
      ? 'Server'
      : 'Client';

  return {
    success: true,
    serverPath: detectedServerPath || undefined,
    clientPath: detectedClientPath || undefined,
    kind,
  };
}

/**
 * Downloads directly to disk with chunked stream pipeline to prevent memory lag on large mods.
 */
async function streamDownloadToFile(downloadUrl, targetFilePath, onProgress, queueId) {
  const response = await fetch(downloadUrl, {
    headers: {
      'Referer': 'https://sp-mod.com/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
    },
  });

  if (!response.ok) {
    const httpErr = new Error(
      `Download failed with HTTP status ${response.status}: ${
        response.statusText || (response.status === 404 ? 'Not Found' : 'Download Error')
      }`
    );
    httpErr.statusCode = response.status;
    throw httpErr;
  }

  const contentLengthHeader = response.headers.get('content-length');
  const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
  let receivedBytes = 0;
  let lastProgressTime = 0;
  let lastBytes = 0;
  let currentSpeed = 'Connecting...';

  const fileStream = fs.createWriteStream(targetFilePath);

  if (onProgress) {
    onProgress({
      queueId,
      stage: 'downloading',
      percent: 0,
      bytesReceived: 0,
      totalBytes,
      speed: 'Initiating stream...',
      detail: 'Connecting to download server...',
    });
  }

  if (!response.body) {
    throw new Error('Response body stream is empty or unavailable.');
  }

  const nodeReadable = Readable.fromWeb(response.body);

  nodeReadable.on('data', (chunk) => {
    receivedBytes += chunk.length;
    const now = Date.now();

    // Throttle progress updates to every 150ms to keep UI snappy without IPC flooding
    if (now - lastProgressTime >= 150) {
      const elapsedSec = (now - lastProgressTime) / 1000;
      const bytesDiff = receivedBytes - lastBytes;
      if (elapsedSec > 0 && bytesDiff > 0) {
        const mbps = bytesDiff / (1024 * 1024) / elapsedSec;
        currentSpeed = `${mbps.toFixed(1)} MB/s`;
      }

      lastProgressTime = now;
      lastBytes = receivedBytes;

      const percent =
        totalBytes > 0
          ? Math.min(98, Math.round((receivedBytes / totalBytes) * 100))
          : Math.min(95, Math.round(receivedBytes / (10 * 1024 * 1024)));

      if (onProgress) {
        onProgress({
          queueId,
          stage: 'downloading',
          percent,
          bytesReceived,
          totalBytes: totalBytes || receivedBytes,
          speed: currentSpeed,
          detail: `Downloading (${percent}%)...`,
        });
      }
    }
  });

  await new Promise((resolve, reject) => {
    nodeReadable.pipe(fileStream);
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
    nodeReadable.on('error', reject);
  });

  if (onProgress) {
    onProgress({
      queueId,
      stage: 'downloading',
      percent: 100,
      bytesReceived: receivedBytes,
      totalBytes: totalBytes || receivedBytes,
      speed: 'Complete',
      detail: 'Download complete. Preparing extraction...',
    });
  }

  return receivedBytes;
}

/**
 * Main Install Mod Execution Pipeline:
 * Direct disk streaming, 7za decompression, and SPT tree placement
 */
async function installMod({
  sptDirectory,
  modName,
  author,
  version,
  downloadUrl,
  archiveBase64,
  archiveFileName,
  queueId,
  onProgress,
}) {
  if (!sptDirectory) {
    throw new Error('SPT Directory is not specified. Please configure your SPT path in Settings.');
  }

  const osTemp = require('os').tmpdir();
  const tempWorkDir = fs.mkdtempSync(path.join(osTemp, 'blacksite-inst-'));
  const tempArchiveFile = path.join(tempWorkDir, archiveFileName || 'mod-download.archive');
  const tempExtractDir = path.join(tempWorkDir, 'extracted');

  try {
    if (downloadUrl) {
      console.log(`[Blacksite Installer] Streaming download from ${downloadUrl}...`);
      await streamDownloadToFile(downloadUrl, tempArchiveFile, onProgress, queueId);
    } else if (archiveBase64) {
      console.log(`[Blacksite Installer] Writing local archive buffer to disk...`);
      fs.writeFileSync(tempArchiveFile, Buffer.from(archiveBase64, 'base64'));
    } else {
      throw new Error('Neither downloadUrl nor archiveBase64 was provided.');
    }

    console.log(`[Blacksite Installer] Extracting archive...`);
    await extractArchive(tempArchiveFile, tempExtractDir, onProgress, queueId);

    if (onProgress) {
      onProgress({
        queueId,
        stage: 'routing',
        percent: 92,
        speed: 'Placing files...',
        detail: 'Routing mod folders into SPT directory...',
      });
    }

    console.log(`[Blacksite Installer] Routing files into SPT: ${sptDirectory}...`);
    const routeResult = routeExtractedModToSpt(tempExtractDir, sptDirectory, modName);

    if (onProgress) {
      onProgress({
        queueId,
        stage: 'installed',
        percent: 100,
        speed: 'Finished',
        detail: 'Installation complete!',
      });
    }

    console.log(`[Blacksite Installer] Installation completed successfully!`, routeResult);
    return routeResult;
  } finally {
    // Cleanup temporary workspace
    try {
      if (fs.existsSync(tempWorkDir)) {
        fs.rmSync(tempWorkDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.warn('Failed cleaning temp directory:', cleanupErr);
    }
  }
}

/**
 * Permanently removes mod files from user/mods and BepInEx/plugins
 */
async function uninstallMod({ sptDirectory, serverPath, clientPath }) {
  if (!sptDirectory) return { success: false, error: 'SPT Directory not set' };

  if (serverPath) {
    const fullServer = path.isAbsolute(serverPath) ? serverPath : path.join(sptDirectory, serverPath);
    if (fs.existsSync(fullServer)) fs.rmSync(fullServer, { recursive: true, force: true });
    if (fs.existsSync(fullServer + '.disabled')) fs.rmSync(fullServer + '.disabled', { recursive: true, force: true });
  }

  if (clientPath) {
    const fullClient = path.isAbsolute(clientPath) ? clientPath : path.join(sptDirectory, clientPath);
    if (fs.existsSync(fullClient)) fs.rmSync(fullClient, { recursive: true, force: true });
    if (fs.existsSync(fullClient + '.disabled')) fs.rmSync(fullClient + '.disabled', { recursive: true, force: true });
  }

  return { success: true };
}

/**
 * Toggles mod between enabled and disabled by appending or removing .disabled extension
 */
async function toggleModDisable({ sptDirectory, serverPath, clientPath, disable }) {
  if (!sptDirectory) return { success: false, error: 'SPT Directory not set' };

  function handlePath(targetPath) {
    if (!targetPath) return null;
    const full = path.isAbsolute(targetPath) ? targetPath : path.join(sptDirectory, targetPath);
    const disabledFull = full.endsWith('.disabled') ? full : `${full}.disabled`;
    const enabledFull = full.endsWith('.disabled') ? full.slice(0, -9) : full;

    if (disable) {
      if (fs.existsSync(enabledFull) && !fs.existsSync(disabledFull)) {
        fs.renameSync(enabledFull, disabledFull);
      }
    } else {
      if (fs.existsSync(disabledFull) && !fs.existsSync(enabledFull)) {
        fs.renameSync(disabledFull, enabledFull);
      }
    }
    return true;
  }

  handlePath(serverPath);
  handlePath(clientPath);

  return { success: true };
}

/**
 * Scans disk in sptDirectory/user/mods and BepInEx/plugins for real mods
 */
async function scanInstalledMods({ sptDirectory }) {
  if (!sptDirectory || !fs.existsSync(sptDirectory)) {
    return [];
  }

  const results = [];
  const userModsDir = path.join(sptDirectory, 'user', 'mods');
  const pluginsDir = path.join(sptDirectory, 'BepInEx', 'plugins');

  // 1. Scan server mods
  if (fs.existsSync(userModsDir)) {
    const entries = fs.readdirSync(userModsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const folderName = entry.name;
        const isDisabled = folderName.endsWith('.disabled');
        const cleanFolderName = isDisabled ? folderName.slice(0, -9) : folderName;
        const fullDir = path.join(userModsDir, folderName);
        const pkgJson = path.join(fullDir, 'package.json');

        let modName = cleanFolderName;
        let author = 'Unknown';
        let version = '1.0.0';

        if (fs.existsSync(pkgJson)) {
          try {
            const data = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
            modName = data.name || modName;
            author = data.author || author;
            version = data.version || version;
          } catch {
            // ignore
          }
        }

        results.push({
          id: `disk.server.${cleanFolderName.toLowerCase()}`,
          name: modName,
          author,
          version,
          kind: 'Server',
          sptVersion: '4.x',
          fikaCompatibility: true,
          installDate: new Date().toISOString().split('T')[0],
          serverPath: `user/mods/${folderName}`,
          isDisabled,
          hasUpdate: false,
          latestVersion: version,
        });
      }
    }
  }

  // 2. Scan client plugins
  if (fs.existsSync(pluginsDir)) {
    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      const name = entry.name;
      const isDisabled = name.endsWith('.disabled');
      const cleanName = isDisabled ? name.slice(0, -9) : name;

      if (!entry.isDirectory() && cleanName.toLowerCase().endsWith('.dll')) {
        results.push({
          id: `disk.client.${cleanName.replace(/\.dll$/i, '').toLowerCase()}`,
          name: cleanName.replace(/\.dll$/i, ''),
          author: 'Plugin',
          version: '1.0.0',
          kind: 'Client',
          sptVersion: '4.x',
          fikaCompatibility: true,
          installDate: new Date().toISOString().split('T')[0],
          clientPath: `BepInEx/plugins/${name}`,
          isDisabled,
          hasUpdate: false,
          latestVersion: '1.0.0',
        });
      }
    }
  }

  return results;
}

module.exports = {
  installMod,
  uninstallMod,
  toggleModDisable,
  scanInstalledMods,
};
