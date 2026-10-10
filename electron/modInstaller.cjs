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
 * Resolves 7za binary path safely across dev, unpacked ASAR, and portable execution
 */
function resolve7zaBinary() {
  const candidates = [];
  if (sevenZip && sevenZip.path7za) {
    candidates.push(sevenZip.path7za);
    if (sevenZip.path7za.includes('app.asar')) {
      candidates.push(sevenZip.path7za.replace('app.asar', 'app.asar.unpacked'));
    }
  }

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'));
    candidates.push(path.join(process.resourcesPath, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'));
    candidates.push(path.join(process.resourcesPath, '7za.exe'));
  }

  candidates.push(path.join(__dirname, '../node_modules/7zip-bin/win/x64/7za.exe'));
  candidates.push(path.join(__dirname, 'node_modules/7zip-bin/win/x64/7za.exe'));

  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      if (process.platform !== 'win32') {
        try { fs.chmodSync(c, 0o755); } catch {}
      }
      return c;
    }
  }
  return null;
}

/**
 * Resolves Windows native tar.exe (built into all Windows 10 & 11 installations)
 */
function resolveWindowsTar() {
  if (process.platform !== 'win32') return null;
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const cand = path.join(sysRoot, 'System32', 'tar.exe');
  if (fs.existsSync(cand)) return cand;
  return 'tar.exe';
}

/**
 * Robust non-blocking archive extraction with live percentage progress streaming.
 * Uses Windows 10/11 native multi-threaded tar.exe or 7za child processes,
 * ensuring the Electron main thread event loop never locks or freezes the UI.
 */
async function extractArchive(archivePath, destinationDir, performanceMode = 'balanced', onProgress = null) {
  fs.mkdirSync(destinationDir, { recursive: true });

  let extractionProgress = 5;
  let heartbeatTimer = null;
  const startTime = Date.now();

  const reportProgress = (pct, customMsg) => {
    extractionProgress = Math.min(99, Math.max(extractionProgress, Math.round(pct)));
    if (onProgress) {
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
      onProgress({
        stage: 'extracting',
        percent: extractionProgress,
        downloadSpeed: customMsg || `Extracting (Multi-threaded) ${extractionProgress}% (${elapsedSec}s)...`,
      });
    }
  };

  // Start active heartbeat timer to guarantee continuous UI updates during multi-second decompression
  heartbeatTimer = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    // Smoothly curve progress towards 95% based on elapsed decompression time
    const targetPct = Math.min(95, 10 + Math.floor(85 * (1 - Math.exp(-elapsed / 8))));
    if (targetPct > extractionProgress) {
      reportProgress(targetPct);
    }
  }, 300);

  const cleanupTimer = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  try {
    // 1. Try Windows Native System32\tar.exe (Fastest & natively available on Windows 10 & 11)
    const winTar = resolveWindowsTar();
    if (winTar) {
      try {
        await new Promise((resolve, reject) => {
          execFile(
            winTar,
            ['-xf', archivePath, '-C', destinationDir],
            { maxBuffer: 100 * 1024 * 1024, windowsHide: true },
            (error) => {
              if (error) reject(error);
              else resolve();
            }
          );
        });
        cleanupTimer();
        reportProgress(100, 'Extraction complete');
        return true;
      } catch (tarErr) {
        console.warn('[Blacksite Installer] Windows tar.exe failed, falling back to 7za...', tarErr.message);
      }
    }

    // 2. Try precompiled 7za binary with multi-threading
    const bin7za = resolve7zaBinary();
    if (bin7za) {
      try {
        const threadCount = getExtractionThreadCount(performanceMode);
        await new Promise((resolve, reject) => {
          const child = execFile(
            bin7za,
            ['x', '-y', `-mmt=${threadCount}`, `-o${destinationDir}`, archivePath],
            { maxBuffer: 100 * 1024 * 1024, windowsHide: true },
            (error) => {
              if (error) reject(error);
              else resolve();
            }
          );

          if (child.stdout) {
            child.stdout.on('data', (chunk) => {
              const str = chunk.toString();
              const match = str.match(/(\d+)%/);
              if (match) {
                const parsed = parseInt(match[1], 10);
                if (!isNaN(parsed) && parsed > extractionProgress) {
                  reportProgress(parsed);
                }
              }
            });
          }
        });
        cleanupTimer();
        reportProgress(100, 'Extraction complete');
        return true;
      } catch (err) {
        console.warn('[Blacksite Installer] 7za extraction failed, attempting system tar...', err.message);
      }
    }

    // 3. Try standard system tar (macOS / Linux)
    try {
      await new Promise((resolve, reject) => {
        execFile('tar', ['-xf', archivePath, '-C', destinationDir], { maxBuffer: 100 * 1024 * 1024 }, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      cleanupTimer();
      reportProgress(100, 'Extraction complete');
      return true;
    } catch (tarErr) {
      console.warn('[Blacksite Installer] System tar failed...', tarErr.message);
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

      try {
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
        cleanupTimer();
        reportProgress(100, 'Extraction complete');
        return true;
      } catch (psErr) {
        console.warn('[Blacksite Installer] PowerShell Expand-Archive failed...', psErr.message);
      }
    }

    // 5. Non-blocking chunked AdmZip fallback (Yields on entries so UI event loop never freezes)
    const stat = fs.statSync(archivePath);
    if (stat.size < 1024 * 1024 * 1024) {
      const zip = new AdmZip(archivePath);
      const entries = zip.getEntries();
      const totalEntries = entries.length;
      for (let i = 0; i < totalEntries; i++) {
        const entry = entries[i];
        zip.extractEntryTo(entry, destinationDir, true, true);
        if (i % 20 === 0) {
          reportProgress(Math.floor((i / totalEntries) * 95));
          // Crucial: yield to event loop so IPC and window messages stay responsive
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
      cleanupTimer();
      reportProgress(100, 'Extraction complete');
      return true;
    }

    throw new Error('Unable to extract archive with any available decompression engine.');
  } finally {
    cleanupTimer();
  }
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

  // Atomic same-drive move helper: tries instant O(1) fs.promises.rename (1-2ms pointer reassignment)
  // Gracefully falls back to parallel copy if cross-device or locked
  async function moveOrCopyDirectory(srcDir, destDir) {
    if (!fs.existsSync(srcDir)) return;
    try {
      if (fs.existsSync(destDir)) {
        await fs.promises.rm(destDir, { recursive: true, force: true });
      }
      await fs.promises.mkdir(path.dirname(destDir), { recursive: true });
      await fs.promises.rename(srcDir, destDir);
      return;
    } catch (renameErr) {
      // If cross-device (EXDEV) or rename blocked, fallback to parallel copy
      await copyDirectoryContents(srcDir, destDir);
    }
  }

  async function moveOrCopyFile(srcFile, destFile) {
    if (!fs.existsSync(srcFile)) return;
    try {
      await fs.promises.mkdir(path.dirname(destFile), { recursive: true });
      if (fs.existsSync(destFile)) {
        await fs.promises.unlink(destFile);
      }
      await fs.promises.rename(srcFile, destFile);
      return;
    } catch (renameErr) {
      await fs.promises.copyFile(srcFile, destFile);
    }
  }

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
              await moveOrCopyDirectory(srcPath, destPath);
            } else {
              await moveOrCopyFile(srcPath, destPath);
            }
          })
        );
      }
    } else {
      for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
          await moveOrCopyDirectory(srcPath, destPath);
        } else {
          await moveOrCopyFile(srcPath, destPath);
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
          await moveOrCopyDirectory(srcModDir, destModDir);
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
        await moveOrCopyDirectory(pDir, destModDir);
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

  let tempWorkDir;
  let isSameDriveStaging = false;
  try {
    const stagingRoot = path.join(sptDirectory, '.blacksite_staging');
    fs.mkdirSync(stagingRoot, { recursive: true });
    tempWorkDir = fs.mkdtempSync(path.join(stagingRoot, 'inst-'));
    isSameDriveStaging = true;
  } catch (stagingErr) {
    console.warn('[Blacksite Installer] Could not create staging in SPT directory, falling back to os.tmpdir():', stagingErr.message);
    const osTemp = os.tmpdir();
    tempWorkDir = fs.mkdtempSync(path.join(osTemp, 'blacksite-inst-'));
  }
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
        percent: 5,
        downloadSpeed: `Starting decompression (${performanceMode} mode)...`,
      });
    }
    await extractArchive(tempArchiveFile, tempExtractDir, performanceMode, onProgress);

    // Routing stage
    console.log(`[Blacksite Installer] Routing files into SPT: ${sptDirectory}...`);
    if (onProgress) {
      onProgress({
        stage: 'routing',
        percent: 98,
        downloadSpeed: isSameDriveStaging ? 'Atomic same-drive moving...' : 'Routing to SPT_Runtime...',
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
      if (isSameDriveStaging) {
        const stagingRoot = path.join(sptDirectory, '.blacksite_staging');
        if (fs.existsSync(stagingRoot)) {
          const remaining = fs.readdirSync(stagingRoot);
          if (remaining.length === 0) {
            fs.rmdirSync(stagingRoot);
          }
        }
      }
    } catch (cleanupErr) {
      console.warn('Failed cleaning temp directory:', cleanupErr);
    }
  }
}

const PROTECTED_CORE_ITEMS = new Set([
  'spt',
  'spt-core',
  'bepinex',
  'core',
  'configurationmanager',
]);

function isProtectedCoreItem(name) {
  if (!name) return true;
  const clean = name.toLowerCase().replace(/\.disabled$/, '').trim();
  if (PROTECTED_CORE_ITEMS.has(clean)) return true;
  if (clean.startsWith('spt.') || clean.startsWith('spt-')) return true;
  return false;
}

/**
 * Permanently removes mod files from SPT_Runtime/user/mods, user/mods, or BepInEx/plugins
 */
async function uninstallMod({ sptDirectory, serverPath, clientPath, modName, clientPaths }) {
  if (!sptDirectory) return { success: false, error: 'SPT Directory not set' };

  const deletePath = (relOrAbs) => {
    if (!relOrAbs) return;
    const full = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(sptDirectory, relOrAbs);
    const basename = path.basename(full);
    if (isProtectedCoreItem(basename)) return; // Never delete protected core files

    if (fs.existsSync(full)) {
      try {
        fs.rmSync(full, { recursive: true, force: true });
      } catch (err) {
        console.warn(`Failed removing ${full}:`, err.message);
      }
    }
    const disabledFull = full.endsWith('.disabled') ? full : full + '.disabled';
    if (fs.existsSync(disabledFull)) {
      try {
        fs.rmSync(disabledFull, { recursive: true, force: true });
      } catch (err) {
        console.warn(`Failed removing ${disabledFull}:`, err.message);
      }
    }
  };

  if (serverPath) deletePath(serverPath);
  if (clientPath) deletePath(clientPath);

  if (Array.isArray(clientPaths)) {
    for (const p of clientPaths) {
      deletePath(p);
    }
  }

  // Fallback cleanup by modName if folder exists in plugins or user/mods
  if (modName && typeof modName === 'string') {
    const cleanModName = modName.trim();
    if (!isProtectedCoreItem(cleanModName)) {
      const candidatePaths = [
        path.join(sptDirectory, 'BepInEx', 'plugins', cleanModName),
        path.join(sptDirectory, 'BepInEx', 'plugins', cleanModName + '.dll'),
        path.join(sptDirectory, 'user', 'mods', cleanModName),
        path.join(sptDirectory, 'SPT_Runtime', 'user', 'mods', cleanModName),
      ];
      for (const cand of candidatePaths) {
        deletePath(cand);
      }
    }
  }

  return { success: true };
}

/**
 * Deep purges all user mods from user/mods, SPT_Runtime/user/mods, and BepInEx/plugins
 * Strictly safeguards SPT core system files (e.g. BepInEx/plugins/spt/).
 */
async function uninstallAllMods({ sptDirectory }) {
  if (!sptDirectory || !fs.existsSync(sptDirectory)) {
    return { success: false, error: 'SPT Directory not set or does not exist' };
  }

  let deletedCount = 0;

  // 1. Clear server mods in both SPT_Runtime and legacy user/mods
  const candidateUserDirs = [
    path.join(sptDirectory, 'SPT_Runtime', 'user', 'mods'),
    path.join(sptDirectory, 'user', 'mods'),
  ];

  for (const userModsDir of candidateUserDirs) {
    if (fs.existsSync(userModsDir)) {
      try {
        const entries = fs.readdirSync(userModsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const targetPath = path.join(userModsDir, entry.name);
            fs.rmSync(targetPath, { recursive: true, force: true });
            deletedCount++;
          }
        }
      } catch (err) {
        console.warn('Error reading user mods dir:', err.message);
      }
    }
  }

  // 2. Clear client plugins (excluding protected SPT core files like 'spt' folder)
  const pluginsDir = path.join(sptDirectory, 'BepInEx', 'plugins');
  if (fs.existsSync(pluginsDir)) {
    try {
      const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        const name = entry.name;
        if (isProtectedCoreItem(name)) {
          console.log(`[Blacksite Purge] Safeguarding core SPT item: ${name}`);
          continue;
        }
        const targetPath = path.join(pluginsDir, name);
        fs.rmSync(targetPath, { recursive: true, force: true });
        deletedCount++;
      }
    } catch (err) {
      console.warn('Error clearing plugins dir:', err.message);
    }
  }

  // 3. Clear non-core client patchers if any
  const patchersDir = path.join(sptDirectory, 'BepInEx', 'patchers');
  if (fs.existsSync(patchersDir)) {
    try {
      const entries = fs.readdirSync(patchersDir, { withFileTypes: true });
      for (const entry of entries) {
        const name = entry.name;
        if (isProtectedCoreItem(name)) continue;
        const targetPath = path.join(patchersDir, name);
        fs.rmSync(targetPath, { recursive: true, force: true });
        deletedCount++;
      }
    } catch (err) {
      console.warn('Error clearing patchers dir:', err.message);
    }
  }

  console.log(`[Blacksite Purge] Successfully uninstalled all mods (${deletedCount} items removed).`);
  return { success: true, deletedCount };
}

/**
 * Toggles mod between enabled and disabled by appending or removing .disabled extension
 */
async function toggleModDisable({ sptDirectory, serverPath, clientPath, disable }) {
  if (!sptDirectory) return { success: false, error: 'SPT Directory not set' };

  function handlePath(targetPath) {
    if (!targetPath) return null;
    const full = path.isAbsolute(targetPath) ? targetPath : path.join(sptDirectory, targetPath);
    const basename = path.basename(full);
    if (isProtectedCoreItem(basename)) return null;

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
 * Scans disk in SPT_Runtime/user/mods, user/mods, and BepInEx/plugins for real mods.
 * Correctly detects BOTH standalone DLLs and subdirectory client plugins,
 * while safeguarding core SPT system folders.
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
            configFiles: [],
          });
        }
      }
    }
  }

  // 2. Scan client plugins (both directories and standalone DLLs)
  if (fs.existsSync(pluginsDir)) {
    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      const name = entry.name;
      const isDisabled = name.endsWith('.disabled');
      const cleanName = isDisabled ? name.slice(0, -9) : name;

      // Exclude core SPT items
      if (isProtectedCoreItem(cleanName)) {
        continue;
      }

      if (entry.isDirectory()) {
        // Folder-based client plugin (e.g. DrakiaXYZ-Waypoints, mpstark-dynamicmaps, UnityToolkit)
        const folderDir = path.join(pluginsDir, name);
        let detectedVersion = '1.0.0';

        // Check if there is an inner package.json or version file if any
        const pkgJson = path.join(folderDir, 'package.json');
        if (fs.existsSync(pkgJson)) {
          try {
            const data = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
            if (data.version) detectedVersion = data.version;
          } catch {
            // ignore
          }
        }

        results.push({
          id: `disk.client.${cleanName.toLowerCase()}`,
          name: cleanName,
          author: 'Client Plugin',
          version: detectedVersion,
          kind: 'Client',
          sptVersion: '4.x',
          fikaCompatibility: true,
          installDate: new Date().toISOString().split('T')[0],
          clientPath: `BepInEx/plugins/${name}`,
          isDisabled,
          hasUpdate: false,
          latestVersion: detectedVersion,
          configFiles: [],
        });
      } else if (cleanName.toLowerCase().endsWith('.dll')) {
        // Standalone .dll plugin (e.g. Liquidwarp.ArmorExpert.dll)
        const baseName = cleanName.replace(/\.dll$/i, '');
        results.push({
          id: `disk.client.${baseName.toLowerCase()}`,
          name: baseName,
          author: 'Client Plugin',
          version: '1.0.0',
          kind: 'Client',
          sptVersion: '4.x',
          fikaCompatibility: true,
          installDate: new Date().toISOString().split('T')[0],
          clientPath: `BepInEx/plugins/${name}`,
          isDisabled,
          hasUpdate: false,
          latestVersion: '1.0.0',
          configFiles: [],
        });
      }
    }
  }

  return results;
}

module.exports = {
  installMod,
  uninstallMod,
  uninstallAllMods,
  toggleModDisable,
  scanInstalledMods,
};
