const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { Readable } = require('stream');
const sevenZip = require('7zip-bin');
const AdmZip = require('adm-zip');

/**
 * Resolves optimal 7-Zip decompression thread count based on performance mode
 * - 'balanced' (default): os.cpus().length - 2 (reserves 2 cores for Windows OS/compositor/mouse)
 * - 'turbo': os.cpus().length (all available cores)
 * - 'smooth': os.cpus().length / 2 (low-spec / battery preservation)
 */
function getExtractionThreadCount(performanceMode = 'balanced') {
  const totalCores = os.cpus()?.length || 4;
  if (performanceMode === 'turbo') {
    return Math.max(4, totalCores);
  }
  if (performanceMode === 'smooth') {
    return Math.max(2, Math.floor(totalCores / 2));
  }
  // 'balanced'
  return Math.max(2, totalCores - 2);
}

/**
 * Resolves 7za binary path safely inside or outside Electron ASAR and ensures execution permissions
 */
function get7zaPath() {
  let bin = sevenZip.path7za;
  if (bin && bin.includes('app.asar')) {
    bin = bin.replace('app.asar', 'app.asar.unpacked');
  }
  if (bin && fs.existsSync(bin) && process.platform !== 'win32') {
    try {
      fs.chmodSync(bin, 0o755);
    } catch {}
  }
  return bin;
}

/**
 * Robust archive extraction using 7za-first with CPU priority tuning and multithreading
 */
async function extractArchive(archivePath, destinationDir, performanceMode = 'balanced') {
  fs.mkdirSync(destinationDir, { recursive: true });

  // 1. Try precompiled 7za binary with large buffer, quiet stdout flags, and CPU priority tuning
  const bin7za = get7zaPath();
  if (bin7za && fs.existsSync(bin7za)) {
    try {
      const threadCount = getExtractionThreadCount(performanceMode);
      await new Promise((resolve, reject) => {
        // -bso0 -bsp0 suppresses file-by-file output, avoiding Node.js child_process maxBuffer overflows
        // -mmt={threadCount} uses multithreading; in Turbo mode all CPU cores are utilized
        const child = execFile(
          bin7za,
          ['x', '-y', `-mmt=${threadCount}`, '-bso0', '-bsp0', `-o${destinationDir}`, archivePath],
          { maxBuffer: 100 * 1024 * 1024, windowsHide: true },
          (error) => {
            if (error) reject(error);
            else resolve();
          }
        );

        // Adjust process priority on OS scheduler: High priority for Turbo Max, BelowNormal for Balanced, Low for Smooth
        if (child.pid && typeof os.setPriority === 'function') {
          try {
            let prio;
            if (performanceMode === 'turbo') {
              prio = os.constants?.priority?.PRIORITY_HIGH || -10;
            } else if (performanceMode === 'smooth') {
              prio = os.constants?.priority?.PRIORITY_LOW || 19;
            } else {
              prio = os.constants?.priority?.PRIORITY_BELOW_NORMAL || 10;
            }
            os.setPriority(child.pid, prio);
          } catch {
            // Ignore if OS does not allow adjusting priority
          }
        }
      });
      return true;
    } catch (err) {
      console.warn('7za extraction failed, attempting fallback...', err.message);
    }
  }

  // 2. Try AdmZip for standard zip files (skip if file is huge > 1GB to prevent V8 memory crashes)
  try {
    const stat = fs.statSync(archivePath);
    if (stat.size < 1024 * 1024 * 1024) {
      const zip = new AdmZip(archivePath);
      zip.extractAllTo(destinationDir, true);
      return true;
    }
  } catch (zipErr) {
    console.warn('AdmZip extraction failed, trying system tools...', zipErr.message);
  }

  // 3. Try Windows built-in tar.exe or system tar
  try {
    await new Promise((resolve, reject) => {
      execFile('tar', ['-xf', archivePath, '-C', destinationDir], { maxBuffer: 100 * 1024 * 1024 }, (error) => {
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
    let psZipPath = archivePath;
    if (!archivePath.toLowerCase().endsWith('.zip')) {
      const renamedZip = `${archivePath}.zip`;
      try {
        fs.copyFileSync(archivePath, renamedZip);
        psZipPath = renamedZip;
      } catch {
        try {
          fs.renameSync(archivePath, renamedZip);
          psZipPath = renamedZip;
        } catch {}
      }
    }

    await new Promise((resolve, reject) => {
      const psCmd = `Expand-Archive -LiteralPath '${psZipPath.replace(/'/g, "''")}' -DestinationPath '${destinationDir.replace(/'/g, "''")}' -Force`;
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd], { maxBuffer: 100 * 1024 * 1024 }, (error) => {
        if (psZipPath !== archivePath) {
          try { fs.rmSync(psZipPath, { force: true }); } catch {}
        }
        if (error) reject(error);
        else resolve();
      });
    });
    return true;
  }

  throw new Error('Unable to extract archive with any available decompression engine.');
}

/**
 * Resolves proper SPT directory targets:
 * - Server mods: SPT_Runtime/user/mods (if SPT_Runtime exists or SPT 4.x), otherwise user/mods
 * - Client plugins: BepInEx/plugins (ALWAYS at root SPT)
 * - Client patchers: BepInEx/patchers (ALWAYS at root SPT)
 * - Guarantees SPT_Runtime/BepInEx is NEVER created
 */
function resolveSptPaths(sptDirectory, sptVersion = '4.1.6') {
  const hasSptRuntime =
    fs.existsSync(path.join(sptDirectory, 'SPT_Runtime')) ||
    fs.existsSync(path.join(sptDirectory, 'SPT_Runtime', 'user')) ||
    fs.existsSync(path.join(sptDirectory, 'SPT_Runtime', 'user', 'mods'));

  const isV4 = String(sptVersion).startsWith('4') || hasSptRuntime;

  let serverModsDir;
  let serverModsRelDir;

  if (hasSptRuntime || isV4) {
    serverModsDir = path.join(sptDirectory, 'SPT_Runtime', 'user', 'mods');
    serverModsRelDir = 'SPT_Runtime/user/mods';
  } else {
    serverModsDir = path.join(sptDirectory, 'user', 'mods');
    serverModsRelDir = 'user/mods';
  }

  fs.mkdirSync(serverModsDir, { recursive: true });
  fs.mkdirSync(path.join(sptDirectory, 'BepInEx', 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(sptDirectory, 'BepInEx', 'patchers'), { recursive: true });

  // Clean up any accidental SPT_Runtime/BepInEx directory
  const accidentalSptRuntimeBepInEx = path.join(sptDirectory, 'SPT_Runtime', 'BepInEx');
  if (fs.existsSync(accidentalSptRuntimeBepInEx)) {
    try {
      // Migrate any nested files to root BepInEx before removing
      fs.cpSync(accidentalSptRuntimeBepInEx, path.join(sptDirectory, 'BepInEx'), { recursive: true, force: true });
      fs.rmSync(accidentalSptRuntimeBepInEx, { recursive: true, force: true });
    } catch (e) {
      console.warn('Notice: Could not clean accidental SPT_Runtime/BepInEx:', e);
    }
  }

  return { serverModsDir, serverModsRelDir, hasSptRuntime, isV4 };
}

/**
 * Intelligent SPT Routing Engine (Asynchronous & Non-Blocking):
 * Analyzes extracted archive directories and places server mods into SPT_Runtime/user/mods (or user/mods)
 * and client files strictly into root BepInEx/plugins and BepInEx/patchers without locking Electron event loop.
 */
async function routeExtractedModToSpt(extractedDir, sptDirectory, fallbackModName, sptVersion = '4.1.6', performanceMode = 'balanced') {
  const { serverModsDir, serverModsRelDir } = resolveSptPaths(sptDirectory, sptVersion);
  const targetClientPluginsDir = path.join(sptDirectory, 'BepInEx', 'plugins');
  const targetClientPatchersDir = path.join(sptDirectory, 'BepInEx', 'patchers');

  const cleanFallback = (fallbackModName || 'Mod').replace(/[^\w.-]/g, '');
  let detectedServerPath = null;
  let detectedClientPath = null;

  // Helper to copy directory contents asynchronously: parallel chunks for Turbo Max, non-blocking yielding for Balanced/Smooth
  async function copyDirectoryContents(srcDir, destDir) {
    if (!fs.existsSync(srcDir)) return;
    await fs.promises.mkdir(destDir, { recursive: true });
    const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });

    if (performanceMode === 'turbo') {
      // Parallel batch routing for maximum NVMe throughput with zero delay
      const batchSize = 16;
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (entry) => {
            const srcPath = path.join(srcDir, entry.name);
            const destPath = path.join(destDir, entry.name);
            if (entry.isDirectory()) {
              await fs.promises.cp(srcPath, destPath, { recursive: true, force: true });
            } else {
              await fs.promises.copyFile(srcPath, destPath);
            }
          })
        );
      }
    } else {
      for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
          await fs.promises.cp(srcPath, destPath, { recursive: true, force: true });
        } else {
          await fs.promises.copyFile(srcPath, destPath);
        }
        // Yield to Node event loop so UI / IPC doesn't freeze during large file moves
        await new Promise((r) => setImmediate(r));
      }
    }
  }

  // Find all directory occurrences recursively
  function findDirectoriesByName(dir, targetName, maxDepth = 6, depth = 0) {
    const matches = [];
    if (depth > maxDepth || !fs.existsSync(dir)) return matches;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(dir, entry.name);
        if (entry.name.toLowerCase() === targetName.toLowerCase()) {
          matches.push(fullPath);
        }
        matches.push(...findDirectoriesByName(fullPath, targetName, maxDepth, depth + 1));
      }
    }
    return matches;
  }

  // 1. Locate and route SERVER MODS
  // Check for SPT_Runtime/user/mods/* or user/mods/*
  const userModsDirs = [
    ...findDirectoriesByName(extractedDir, 'mods').filter((d) => {
      const parent = path.basename(path.dirname(d)).toLowerCase();
      return parent === 'user';
    }),
  ];

  if (userModsDirs.length > 0) {
    for (const uModsDir of userModsDirs) {
      const entries = fs.readdirSync(uModsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const modFolderName = entry.name;
          const srcModDir = path.join(uModsDir, modFolderName);
          const destModDir = path.join(serverModsDir, modFolderName);
          await fs.promises.cp(srcModDir, destModDir, { recursive: true, force: true });
          await new Promise((r) => setImmediate(r));
          if (!detectedServerPath) {
            detectedServerPath = `${serverModsRelDir}/${modFolderName}`;
          }
        }
      }
    }
  }

  // 1b. Check for standalone server mod with package.json anywhere in the tree
  if (!detectedServerPath) {
    function findPackageJsonDirs(dir, depth = 0) {
      const dirs = [];
      if (depth > 6 || !fs.existsSync(dir)) return dirs;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() && entry.name.toLowerCase() === 'package.json') {
          dirs.push(dir);
        } else if (entry.isDirectory()) {
          dirs.push(...findPackageJsonDirs(path.join(dir, entry.name), depth + 1));
        }
      }
      return dirs;
    }

    const pkgDirs = findPackageJsonDirs(extractedDir);
    for (const pDir of pkgDirs) {
      try {
        const pkgData = JSON.parse(fs.readFileSync(path.join(pDir, 'package.json'), 'utf8'));
        const modFolderName = pkgData.name || path.basename(pDir) || cleanFallback;
        const destModDir = path.join(serverModsDir, modFolderName);
        await fs.promises.cp(pDir, destModDir, { recursive: true, force: true });
        await new Promise((r) => setImmediate(r));
        if (!detectedServerPath) {
          detectedServerPath = `${serverModsRelDir}/${modFolderName}`;
        }
      } catch (err) {
        console.warn('Error reading package.json in mod:', err);
      }
    }
  }

  // 2. Locate and route CLIENT PLUGINS (BepInEx/plugins)
  const pluginsDirs = findDirectoriesByName(extractedDir, 'plugins').filter((d) => {
    const parent = path.basename(path.dirname(d)).toLowerCase();
    return parent === 'bepinex';
  });

  if (pluginsDirs.length > 0) {
    for (const pDir of pluginsDirs) {
      await copyDirectoryContents(pDir, targetClientPluginsDir);
      const entries = fs.readdirSync(pDir);
      if (entries.length > 0 && !detectedClientPath) {
        detectedClientPath = `BepInEx/plugins/${entries[0]}`;
      }
    }
  }

  // 3. Locate and route CLIENT PATCHERS (BepInEx/patchers)
  const patchersDirs = findDirectoriesByName(extractedDir, 'patchers').filter((d) => {
    const parent = path.basename(path.dirname(d)).toLowerCase();
    return parent === 'bepinex';
  });

  if (patchersDirs.length > 0) {
    for (const pDir of patchersDirs) {
      await copyDirectoryContents(pDir, targetClientPatchersDir);
      const entries = fs.readdirSync(pDir);
      if (entries.length > 0 && !detectedClientPath) {
        detectedClientPath = `BepInEx/patchers/${entries[0]}`;
      }
    }
  }

  // 4. Locate standalone client .dll plugins not wrapped in BepInEx
  if (!detectedClientPath && !detectedServerPath) {
    function findDlls(dir, depth = 0) {
      const dlls = [];
      if (depth > 6 || !fs.existsSync(dir)) return dlls;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() && entry.name.toLowerCase().endsWith('.dll')) {
          dlls.push(path.join(dir, entry.name));
        } else if (entry.isDirectory()) {
          dlls.push(...findDlls(path.join(dir, entry.name), depth + 1));
        }
      }
      return dlls;
    }

    const foundDlls = findDlls(extractedDir);
    if (foundDlls.length > 0) {
      for (const dllPath of foundDlls) {
        const fileName = path.basename(dllPath);
        await fs.promises.copyFile(dllPath, path.join(targetClientPluginsDir, fileName));
        await new Promise((r) => setImmediate(r));
        if (!detectedClientPath) {
          detectedClientPath = `BepInEx/plugins/${fileName}`;
        }
      }
    }
  }

  // 5. Clean up any empty dummy folders in user/mods (e.g. earlier empty WTT-CommonLib folder)
  try {
    const legacyUserMods = path.join(sptDirectory, 'user', 'mods');
    if (fs.existsSync(legacyUserMods)) {
      const entries = fs.readdirSync(legacyUserMods);
      for (const ent of entries) {
        const full = path.join(legacyUserMods, ent);
        if (fs.statSync(full).isDirectory()) {
          const contents = fs.readdirSync(full);
          if (contents.length === 0) {
            fs.rmdirSync(full);
          }
        }
      }
    }
  } catch (cleanErr) {
    // Ignore cleanup error
  }

  const kind =
    detectedServerPath && detectedClientPath ? 'Both' : detectedServerPath ? 'Server' : 'Client';

  return {
    success: true,
    serverPath: detectedServerPath,
    clientPath: detectedClientPath,
    kind,
  };
}

/**
 * Streams a remote file directly to disk in 64KB chunks with throttled progress events
 */
async function streamDownloadToFile(url, destFilePath, onProgress, maxRetries = 2) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const response = await fetch(url, {
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

      const fileStream = fs.createWriteStream(destFilePath);
      const readable = Readable.fromWeb(response.body);

      let receivedBytes = 0;
      let lastProgressTime = Date.now();
      let lastBytesInWindow = 0;
      let downloadSpeed = 'Calculating...';

      await new Promise((resolve, reject) => {
        readable.on('data', (chunk) => {
          receivedBytes += chunk.length;
          fileStream.write(chunk);

          const now = Date.now();
          if (now - lastProgressTime >= 120) {
            const elapsedSec = (now - lastProgressTime) / 1000;
            const bytesInInterval = receivedBytes - lastBytesInWindow;
            if (elapsedSec > 0) {
              const speedBytesPerSec = bytesInInterval / elapsedSec;
              const speedMBps = (speedBytesPerSec / (1024 * 1024)).toFixed(1);
              const remainingBytes = totalBytes > receivedBytes ? totalBytes - receivedBytes : 0;
              const etaSec = speedBytesPerSec > 0 && remainingBytes > 0 ? Math.ceil(remainingBytes / speedBytesPerSec) : 0;
              const etaStr = etaSec > 60 ? `${Math.floor(etaSec / 60)}m ${etaSec % 60}s` : `${etaSec}s`;
              downloadSpeed = remainingBytes > 0 && etaSec > 0 ? `${speedMBps} MB/s · ETA: ${etaStr}` : `${speedMBps} MB/s`;
            }

            const percent = totalBytes > 0 ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : 0;

            if (onProgress) {
              onProgress({
                stage: 'downloading',
                percent,
                bytesReceived: receivedBytes,
                totalBytes,
                downloadSpeed,
              });
            }

            lastProgressTime = now;
            lastBytesInWindow = receivedBytes;
          }
        });

        readable.on('end', () => {
          fileStream.end();
          if (onProgress) {
            onProgress({
              stage: 'downloading',
              percent: 100,
              bytesReceived: receivedBytes,
              totalBytes: totalBytes || receivedBytes,
              downloadSpeed: 'Complete',
            });
          }
          resolve();
        });

        readable.on('error', (err) => {
          fileStream.destroy();
          reject(err);
        });

        fileStream.on('error', (err) => {
          reject(err);
        });
      });

      return { totalBytes: totalBytes || receivedBytes };
    } catch (err) {
      attempt++;
      if (attempt > maxRetries || err.statusCode === 404) {
        throw err;
      }
      console.warn(`[Blacksite Installer] Download attempt ${attempt} failed, retrying in 1.2s...`, err.message);
      if (onProgress) {
        onProgress({
          stage: 'downloading',
          percent: 0,
          downloadSpeed: `Retrying download (attempt ${attempt + 1}/${maxRetries + 1})...`,
        });
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
}

/**
 * Downloads and installs a mod with zero-lag direct-to-disk streaming and SPT 4.x routing
 */
async function installMod({
  queueId,
  sptDirectory,
  sptVersion = '4.1.6',
  modName,
  author,
  version,
  downloadUrl,
  archiveBase64,
  archiveFileName,
  performanceMode = 'balanced',
  onProgress,
}) {
  if (!sptDirectory || typeof sptDirectory !== 'string') {
    throw new Error('Valid SPT root directory is required.');
  }

  const osTemp = require('os').tmpdir();
  const tempWorkDir = fs.mkdtempSync(path.join(osTemp, 'blacksite-inst-'));
  const tempArchiveFile = path.join(tempWorkDir, archiveFileName || 'mod-download.archive');
  const tempExtractDir = path.join(tempWorkDir, 'extracted');

  try {
    if (downloadUrl) {
      console.log(`[Blacksite Installer] Streaming download from ${downloadUrl}...`);
      if (onProgress) {
        onProgress({
          stage: 'downloading',
          percent: 0,
          bytesReceived: 0,
          totalBytes: 0,
          downloadSpeed: 'Initiating connection...',
        });
      }

      await streamDownloadToFile(downloadUrl, tempArchiveFile, onProgress);
    } else if (archiveBase64) {
      console.log(`[Blacksite Installer] Writing local archive buffer to disk...`);
      fs.writeFileSync(tempArchiveFile, Buffer.from(archiveBase64, 'base64'));
    } else {
      throw new Error('Neither downloadUrl nor archiveBase64 was provided.');
    }

    // Extraction stage
    console.log(`[Blacksite Installer] Extracting archive (Performance mode: ${performanceMode})...`);
    if (onProgress) {
      onProgress({
        stage: 'extracting',
        percent: 100,
        downloadSpeed: `Extracting (${performanceMode} mode)...`,
      });
    }
    await extractArchive(tempArchiveFile, tempExtractDir, performanceMode);

    // Routing stage
    console.log(`[Blacksite Installer] Routing files into SPT: ${sptDirectory}...`);
    if (onProgress) {
      onProgress({
        stage: 'routing',
        percent: 100,
        downloadSpeed: 'Routing to SPT_Runtime...',
      });
    }
    const routeResult = await routeExtractedModToSpt(tempExtractDir, sptDirectory, modName, sptVersion, performanceMode);

    if (onProgress) {
      onProgress({
        stage: 'installed',
        percent: 100,
        downloadSpeed: 'Complete',
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
 * Permanently removes mod files from SPT_Runtime/user/mods, user/mods, or BepInEx/plugins
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
 * Scans disk in SPT_Runtime/user/mods, user/mods, and BepInEx/plugins for real mods
 */
async function scanInstalledMods({ sptDirectory }) {
  if (!sptDirectory || !fs.existsSync(sptDirectory)) {
    return [];
  }

  const results = [];
  const candidateUserDirs = [
    path.join(sptDirectory, 'SPT_Runtime', 'user', 'mods'),
    path.join(sptDirectory, 'user', 'mods'),
  ];
  const pluginsDir = path.join(sptDirectory, 'BepInEx', 'plugins');

  // 1. Scan server mods in both SPT_Runtime and root user/mods
  const scannedFolderNames = new Set();
  for (const userModsDir of candidateUserDirs) {
    if (fs.existsSync(userModsDir)) {
      const isRuntime = userModsDir.includes('SPT_Runtime');
      const relPrefix = isRuntime ? 'SPT_Runtime/user/mods' : 'user/mods';
      const entries = fs.readdirSync(userModsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const folderName = entry.name;
          const isDisabled = folderName.endsWith('.disabled');
          const cleanFolderName = isDisabled ? folderName.slice(0, -9) : folderName;

          if (scannedFolderNames.has(cleanFolderName.toLowerCase())) continue;
          scannedFolderNames.add(cleanFolderName.toLowerCase());

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
            sptVersion: isRuntime ? '4.x' : '3.x',
            fikaCompatibility: true,
            installDate: new Date().toISOString().split('T')[0],
            serverPath: `${relPrefix}/${folderName}`,
            isDisabled,
            hasUpdate: false,
            latestVersion: version,
          });
        }
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
