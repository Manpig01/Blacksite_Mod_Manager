const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
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
async function extractArchive(archivePath, destinationDir) {
  fs.mkdirSync(destinationDir, { recursive: true });

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
 * Recursively find package.json or dll files inside extracted directory
 */
function findFileRecursive(dir, targetName, maxDepth = 4, currentDepth = 0) {
  if (currentDepth > maxDepth || !fs.existsSync(dir)) return null;
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

  return null;
}

/**
 * Intelligent SPT Routing Engine:
 * Analyzes extracted directory tree and copies user/mods and BepInEx/plugins to proper locations.
 */
function routeExtractedModToSpt(extractedDir, sptDirectory, fallbackModName) {
  fs.mkdirSync(path.join(sptDirectory, 'user', 'mods'), { recursive: true });
  fs.mkdirSync(path.join(sptDirectory, 'BepInEx', 'plugins'), { recursive: true });

  const cleanName = (fallbackModName || 'Mod').replace(/[^\w.-]/g, '');
  let detectedServerPath = null;
  let detectedClientPath = null;

  // Case 1: Archive has an SPT container root folder (e.g. SPT/user and SPT/BepInEx)
  const sptContainer = path.join(extractedDir, 'SPT');
  const sourceRoot = fs.existsSync(sptContainer) ? sptContainer : extractedDir;

  let hasDirectUser = fs.existsSync(path.join(sourceRoot, 'user'));
  let hasDirectBepInEx = fs.existsSync(path.join(sourceRoot, 'BepInEx'));

  // If not at root, check if wrapped in a single top-level folder
  if (!hasDirectUser && !hasDirectBepInEx) {
    const topEntries = fs.readdirSync(sourceRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (topEntries.length === 1) {
      const candidateDir = path.join(sourceRoot, topEntries[0].name);
      if (fs.existsSync(path.join(candidateDir, 'user')) || fs.existsSync(path.join(candidateDir, 'BepInEx'))) {
        hasDirectUser = fs.existsSync(path.join(candidateDir, 'user'));
        hasDirectBepInEx = fs.existsSync(path.join(candidateDir, 'BepInEx'));
        if (hasDirectUser) {
          fs.cpSync(path.join(candidateDir, 'user'), path.join(sptDirectory, 'user'), { recursive: true, force: true });
        }
        if (hasDirectBepInEx) {
          fs.cpSync(path.join(candidateDir, 'BepInEx'), path.join(sptDirectory, 'BepInEx'), { recursive: true, force: true });
        }
      }
    }
  } else {
    if (hasDirectUser) {
      fs.cpSync(path.join(sourceRoot, 'user'), path.join(sptDirectory, 'user'), { recursive: true, force: true });
    }
    if (hasDirectBepInEx) {
      fs.cpSync(path.join(sourceRoot, 'BepInEx'), path.join(sptDirectory, 'BepInEx'), { recursive: true, force: true });
    }
  }

  // Case 2: Standalone Server Mod (contains package.json)
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

  // Case 3: Standalone Client Plugin (contains .dll files)
  const dllPath = findFileRecursive(extractedDir, '.dll');
  // Or check any .dll
  function findAnyDll(dir, maxDepth = 4, depth = 0) {
    if (depth > maxDepth || !fs.existsSync(dir)) return null;
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
    return null;
  }

  const anyDll = findAnyDll(extractedDir);
  if (anyDll && !hasDirectBepInEx) {
    const dllDir = path.dirname(anyDll);
    const dllName = path.basename(anyDll);
    const targetPluginDir = path.join(sptDirectory, 'BepInEx', 'plugins');

    // If folder has multiple assets, copy folder; otherwise copy dll directly
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

  // If direct folders were copied, identify the installed paths
  if (!detectedServerPath && (hasDirectUser || fs.existsSync(path.join(sptDirectory, 'user', 'mods')))) {
    const userMods = fs.readdirSync(path.join(sptDirectory, 'user', 'mods'));
    const matched = userMods.find((m) => m.toLowerCase().includes(cleanName.toLowerCase()));
    if (matched) detectedServerPath = `user/mods/${matched}`;
    else if (userMods.length > 0) detectedServerPath = `user/mods/${userMods[userMods.length - 1]}`;
  }

  if (!detectedClientPath && (hasDirectBepInEx || fs.existsSync(path.join(sptDirectory, 'BepInEx', 'plugins')))) {
    const plugins = fs.readdirSync(path.join(sptDirectory, 'BepInEx', 'plugins'));
    const matched = plugins.find((p) => p.toLowerCase().includes(cleanName.toLowerCase()));
    if (matched) detectedClientPath = `BepInEx/plugins/${matched}`;
    else if (plugins.length > 0) detectedClientPath = `BepInEx/plugins/${plugins[plugins.length - 1]}`;
  }

  const kind = detectedServerPath && detectedClientPath ? 'Both' : detectedServerPath ? 'Server' : 'Client';

  return {
    success: true,
    serverPath: detectedServerPath || `user/mods/${cleanName}`,
    clientPath: detectedClientPath || `BepInEx/plugins/${cleanName}.dll`,
    kind,
  };
}

/**
 * Downloads and installs a mod from URL or local archive Buffer
 */
async function installMod({ sptDirectory, modName, author, version, downloadUrl, archiveBase64, archiveFileName }) {
  if (!sptDirectory || typeof sptDirectory !== 'string') {
    throw new Error('Valid SPT root directory is required.');
  }

  const osTemp = require('os').tmpdir();
  const tempWorkDir = fs.mkdtempSync(path.join(osTemp, 'blacksite-inst-'));
  const tempArchiveFile = path.join(tempWorkDir, archiveFileName || 'mod-download.archive');
  const tempExtractDir = path.join(tempWorkDir, 'extracted');

  try {
    if (downloadUrl) {
      console.log(`[Blacksite Installer] Downloading from ${downloadUrl}...`);
      const response = await fetch(downloadUrl, {
        headers: {
          'Referer': 'https://sp-mod.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
        },
      });

      if (!response.ok) {
        const httpErr = new Error(`Download failed with HTTP status ${response.status}: ${response.statusText || (response.status === 404 ? 'Not Found' : 'Download Error')}`);
        httpErr.statusCode = response.status;
        throw httpErr;
      }

      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(tempArchiveFile, Buffer.from(arrayBuffer));
      console.log(`[Blacksite Installer] Downloaded archive size: ${arrayBuffer.byteLength} bytes`);
    } else if (archiveBase64) {
      console.log(`[Blacksite Installer] Processing local archive buffer...`);
      fs.writeFileSync(tempArchiveFile, Buffer.from(archiveBase64, 'base64'));
    } else {
      throw new Error('Neither downloadUrl nor archiveBase64 was provided.');
    }

    console.log(`[Blacksite Installer] Extracting archive...`);
    await extractArchive(tempArchiveFile, tempExtractDir);

    console.log(`[Blacksite Installer] Routing files into SPT: ${sptDirectory}...`);
    const routeResult = routeExtractedModToSpt(tempExtractDir, sptDirectory, modName);

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
