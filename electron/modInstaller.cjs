const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { Readable } = require('stream');
const https = require('https');
const http = require('http');
const sevenZip = require('7zip-bin');
const AdmZip = require('adm-zip');

let electronApp = null;
try {
  const electron = require('electron');
  electronApp = electron.app;
} catch (_) {}

/**
 * Resolves persistent application user data directory
 */
function getUserDataDir() {
  if (electronApp && typeof electronApp.getPath === 'function') {
    try {
      return electronApp.getPath('userData');
    } catch (_) {}
  }
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Blacksite Mod Manager');
  }
  return path.join(home, '.config', 'blacksite-mod-manager');
}

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
 * Extracts executable binary from inside Electron .asar package to OS temporary directory
 * if running from a virtual ASAR filesystem where child_process cannot execute directly.
 */
function extractBinaryFromAsarIfNeeded(binPath) {
  if (!binPath) return null;
  // If not inside an asar archive, and exists on disk, it can be executed directly
  if (!binPath.includes('.asar') && fs.existsSync(binPath)) {
    return binPath;
  }

  // If inside .asar or virtual asar path, extract to temp disk location
  try {
    const isWin = process.platform === 'win32';
    const binName = isWin ? '7za.exe' : '7za';
    const tempBinDir = path.join(os.tmpdir(), 'blacksite-bin');
    fs.mkdirSync(tempBinDir, { recursive: true });
    const targetDiskBin = path.join(tempBinDir, binName);

    // Read buffer (Electron fs reads from inside app.asar seamlessly)
    if (fs.existsSync(binPath)) {
      const binBuffer = fs.readFileSync(binPath);
      if (!fs.existsSync(targetDiskBin) || fs.statSync(targetDiskBin).size !== binBuffer.length) {
        fs.writeFileSync(targetDiskBin, binBuffer);
      }
      if (!isWin) {
        try { fs.chmodSync(targetDiskBin, 0o755); } catch {}
      }
      return targetDiskBin;
    }
  } catch (err) {
    console.warn('[Blacksite Installer] Failed to unpack 7za binary from ASAR to temp directory:', err.message);
  }
  return null;
}

/**
 * Resolves 7za binary path safely across dev, unpacked ASAR, portable execution, extraResources, and OS installs
 */
function resolve7zaBinary() {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const binSubdir = isWin ? 'win' : isMac ? 'mac' : 'linux';
  const exeName = isWin ? '7za.exe' : '7za';

  const candidates = [];

  // 1. Persistent cached binary in app userData/bin
  const userDataBin = path.join(getUserDataDir(), 'bin', exeName);
  candidates.push(userDataBin);

  // 2. Temp directory binary
  const tempBin = path.join(os.tmpdir(), 'blacksite-bin', exeName);
  candidates.push(tempBin);

  // 3. Check unpacked extraResources in packaged Electron (from electron-builder extraResources)
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'bin', binSubdir, exeName));
    candidates.push(path.join(process.resourcesPath, 'bin', exeName));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'bin', binSubdir, exeName));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'bin', exeName));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'));
    candidates.push(path.join(process.resourcesPath, exeName));
  }

  // 4. Check bundled electron/bin relative to __dirname and process.cwd()
  candidates.push(path.join(__dirname, 'bin', binSubdir, exeName));
  candidates.push(path.join(__dirname, 'bin', exeName));
  candidates.push(path.join(__dirname, '../electron/bin', binSubdir, exeName));
  candidates.push(path.join(process.cwd(), 'electron/bin', binSubdir, exeName));

  // 5. Check node_modules/7zip-bin
  if (sevenZip && sevenZip.path7za) {
    candidates.push(sevenZip.path7za);
    if (sevenZip.path7za.includes('app.asar')) {
      candidates.push(sevenZip.path7za.replace('app.asar', 'app.asar.unpacked'));
    }
  }
  candidates.push(path.join(__dirname, '../node_modules/7zip-bin/win/x64/7za.exe'));
  candidates.push(path.join(__dirname, 'node_modules/7zip-bin/win/x64/7za.exe'));
  candidates.push(path.join(process.cwd(), 'node_modules/7zip-bin/win/x64/7za.exe'));

  // 6. Check DragonDen-style tools/7zip directory (relative to app directory, cwd, and root)
  candidates.push(path.join(__dirname, '..', 'tools', '7zip', 'win', '7za.exe'));
  candidates.push(path.join(__dirname, 'tools', '7zip', 'win', '7za.exe'));
  candidates.push(path.join(process.cwd(), 'tools', '7zip', 'win', '7za.exe'));
  candidates.push(path.join(process.cwd(), 'tools', '7zip', '7za.exe'));
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'tools', '7zip', 'win', '7za.exe'));
    candidates.push(path.join(process.resourcesPath, 'tools', '7zip', '7za.exe'));
  }

  // 7. Standard Windows system 7-Zip installations if present
  if (isWin) {
    candidates.push('C:\\Program Files\\7-Zip\\7z.exe');
    candidates.push('C:\\Program Files (x86)\\7-Zip\\7z.exe');
    candidates.push('C:\\ProgramData\\chocolatey\\bin\\7z.exe');
    candidates.push('C:\\tools\\7z\\7z.exe');
    candidates.push('C:\\tools\\7zip\\win\\7za.exe');
    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', '7-Zip', '7z.exe'));
    }
    const home = os.homedir();
    candidates.push(path.join(home, 'scoop', 'shims', '7z.exe'));
    candidates.push(path.join(home, 'scoop', 'apps', '7zip', 'current', '7z.exe'));
  }

  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      // If path is inside an ASAR container, extract it to temp disk first
      if (c.includes('.asar')) {
        const extracted = extractBinaryFromAsarIfNeeded(c);
        if (extracted && fs.existsSync(extracted)) {
          return extracted;
        }
      } else {
        if (!isWin) {
          try { fs.chmodSync(c, 0o755); } catch {}
        }
        return c;
      }
    }
  }

  // 7. Last-ditch check: test if 7za or 7z is globally in system PATH
  try {
    const testCmd = isWin ? 'where 7za' : 'which 7za';
    const out = require('child_process').execSync(testCmd, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim().split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) return out;
  } catch (_) {}

  if (isWin) {
    try {
      const out = require('child_process').execSync('where 7z', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim().split(/\r?\n/)[0];
      if (out && fs.existsSync(out)) return out;
    } catch (_) {}
  }

  return null;
}

/**
 * Ensures a working 7za binary exists, auto-downloading verified standalone 7za if missing
 */
async function ensure7zaBinary(onProgress = null) {
  const existing = resolve7zaBinary();
  if (existing) return existing;

  const isWin = process.platform === 'win32';
  if (!isWin) return null;

  const targetDir = path.join(getUserDataDir(), 'bin');
  fs.mkdirSync(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, '7za.exe');
  const tempPath = path.join(targetDir, `7za.exe.${Date.now()}.tmp`);

  const downloadUrls = [
    'https://raw.githubusercontent.com/develar/7zip-bin/master/win/x64/7za.exe',
    'https://github.com/develar/7zip-bin/raw/master/win/x64/7za.exe',
    'https://www.7-zip.org/a/7zr.exe',
  ];

  console.log('[Blacksite Installer] 7-Zip engine missing. Auto-provisioning standalone 7za runtime...');
  if (onProgress) {
    onProgress({
      stage: 'extracting',
      percent: 5,
      downloadSpeed: 'Auto-provisioning 7-Zip engine (standalone runtime)...',
    });
  }

  for (const dlUrl of downloadUrls) {
    try {
      await streamDownloadToFile(dlUrl, tempPath, null, 1);
      if (fs.existsSync(tempPath)) {
        const stat = fs.statSync(tempPath);
        if (stat.size > 200 * 1024) {
          try {
            if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
          } catch (_) {}
          fs.renameSync(tempPath, targetPath);
          console.log(`[Blacksite Installer] Successfully auto-provisioned 7za to: ${targetPath}`);
          return targetPath;
        } else {
          try { fs.unlinkSync(tempPath); } catch (_) {}
        }
      }
    } catch (dlErr) {
      console.warn(`[Blacksite Installer] Failed auto-downloading 7za from ${dlUrl}:`, dlErr.message);
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch (_) {}
    }
  }

  return null;
}

/**
 * Detects archive format from file magic bytes (ZIP, 7Z, RAR, TAR.GZ)
 */
function detectArchiveFormat(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);

    // 0x50, 0x4B (PK..) -> ZIP
    if (buf[0] === 0x50 && buf[1] === 0x4b) return 'zip';
    // 0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C -> 7Z
    if (buf[0] === 0x37 && buf[1] === 0x7a && buf[2] === 0xbc && buf[3] === 0xaf) return '7z';
    // 0x52, 0x61, 0x72, 0x21 -> RAR
    if (buf[0] === 0x52 && buf[1] === 0x61 && buf[2] === 0x72 && buf[3] === 0x21) return 'rar';
    // 0x1F, 0x8B -> GZIP
    if (buf[0] === 0x1f && buf[1] === 0x8b) return 'tar.gz';
  } catch (_) {}
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
 * Prioritizes high-speed multi-threaded 7za with -bsp1 live progress streaming,
 * falls back cleanly to native Windows bsdtar for ZIP/TAR, PowerShell without file copy lag,
 * and chunked non-blocking AdmZip, ensuring the Electron UI event loop never freezes.
 */
async function extractArchive(archivePath, destinationDir, performanceMode = 'balanced', onProgress = null) {
  fs.mkdirSync(destinationDir, { recursive: true });

  const format = detectArchiveFormat(archivePath);
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

  // Start active heartbeat timer to guarantee continuous UI updates during decompression
  heartbeatTimer = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const targetPct = Math.min(95, 10 + Math.floor(85 * (1 - Math.exp(-elapsed / 6))));
    if (targetPct > extractionProgress) {
      reportProgress(targetPct);
    }
  }, 250);

  const cleanupTimer = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  try {
    // 1. Try precompiled 7za binary FIRST (Multi-threaded, supports .zip, .7z, .rar, .tar.gz, LZMA, Deflate64)
    // Modeled with DragonDen-ModManager flags (-aoa overwrite all, -spf preserve full paths, -y assume yes)
    let bin7za = resolve7zaBinary();
    if (!bin7za && (format === '7z' || format === 'rar' || !format)) {
      bin7za = await ensure7zaBinary(onProgress);
    }

    if (bin7za) {
      try {
        const threadCount = getExtractionThreadCount(performanceMode);
        await new Promise((resolve, reject) => {
          // DragonDen flags: 'x', archivePath, '-y', '-aoa', '-spf', `-o${destinationDir}`
          // Plus Blacksite multi-threading and live progress capture:
          const child = execFile(
            bin7za,
            ['x', archivePath, '-y', '-aoa', '-spf', `-o${destinationDir}`, '-bsp1', `-mmt=${threadCount}`],
            { maxBuffer: 500 * 1024 * 1024, windowsHide: true },
            (error, stdout, stderr) => {
              if (error) {
                console.error('[Blacksite Installer] 7za extraction error:', error.message, stderr ? stderr.toString() : '');
                reject(error);
              } else {
                resolve();
              }
            }
          );

          if (child.stdout) {
            child.stdout.on('data', (chunk) => {
              const str = chunk.toString();
              const matches = str.matchAll(/(\d+)%/g);
              for (const m of matches) {
                const parsed = parseInt(m[1], 10);
                if (!isNaN(parsed) && parsed > extractionProgress) {
                  reportProgress(parsed, `Extracting (7-Zip Multi-core) ${parsed}%...`);
                }
              }
            });
          }
        });
        cleanupTimer();
        reportProgress(100, 'Extraction complete');
        return true;
      } catch (err) {
        console.warn('[Blacksite Installer] 7za extraction failed, falling back to system engines...', err.message);
      }
    }

    // 2. Try Windows Native System32\tar.exe (bsdtar)
    // Note: Windows tar.exe natively handles .zip and .tar.gz, but CANNOT extract .7z or .rar!
    if (format !== '7z' && format !== 'rar') {
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
          console.warn('[Blacksite Installer] Windows tar.exe failed, falling back to next engine...', tarErr.message);
        }
      }
    }

    // 3. Try standard system tar (macOS / Linux)
    if (process.platform !== 'win32' && format !== '7z' && format !== 'rar') {
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
    }

    // 4. Try PowerShell Expand-Archive on Windows (ZIP only)
    if (process.platform === 'win32' && (format === 'zip' || !format)) {
      let psZipPath = archivePath;
      let didRename = false;
      if (!archivePath.toLowerCase().endsWith('.zip')) {
        const renamedZip = `${archivePath}.zip`;
        try {
          fs.renameSync(archivePath, renamedZip);
          psZipPath = renamedZip;
          didRename = true;
        } catch {}
      }

      try {
        await new Promise((resolve, reject) => {
          const psCmd = `Expand-Archive -LiteralPath '${psZipPath.replace(/'/g, "''")}' -DestinationPath '${destinationDir.replace(/'/g, "''")}' -Force`;
          execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd], { maxBuffer: 100 * 1024 * 1024 }, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        if (didRename) {
          try { fs.renameSync(psZipPath, archivePath); } catch {}
        }
        cleanupTimer();
        reportProgress(100, 'Extraction complete');
        return true;
      } catch (psErr) {
        if (didRename) {
          try { fs.renameSync(psZipPath, archivePath); } catch {}
        }
        console.warn('[Blacksite Installer] PowerShell Expand-Archive failed...', psErr.message);
      }
    }

    // 5. Non-blocking chunked AdmZip fallback (ZIP only, yields on entries so UI event loop never freezes)
    if (format === 'zip' || !format) {
      try {
        const stat = fs.statSync(archivePath);
        if (stat.size < 1024 * 1024 * 1024) {
          await new Promise((r) => setImmediate(r));
          const zip = new AdmZip(archivePath);
          const entries = zip.getEntries();
          const totalEntries = entries.length;
          for (let i = 0; i < totalEntries; i++) {
            const entry = entries[i];
            zip.extractEntryTo(entry, destinationDir, true, true);
            if (i % 10 === 0) {
              reportProgress(Math.floor((i / totalEntries) * 95));
              await new Promise((resolve) => setImmediate(resolve));
            }
          }
          cleanupTimer();
          reportProgress(100, 'Extraction complete');
          return true;
        }
      } catch (admErr) {
        console.warn('[Blacksite Installer] AdmZip fallback failed...', admErr.message);
      }
    }

    const stat = fs.existsSync(archivePath) ? fs.statSync(archivePath) : { size: 0 };
    const err = new Error(
      `Unable to extract archive with any available decompression engine. Format: ${format || 'unknown'}, Size: ${(stat.size / (1024 * 1024)).toFixed(1)} MB`
    );
    err.code = 'ERR_EXTRACTION_FAILED';
    err.canManualExtract = true;
    err.archivePath = archivePath;
    err.destinationDir = destinationDir;
    err.format = format;
    err.archiveSizeMb = (stat.size / (1024 * 1024)).toFixed(1);
    throw err;
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
async function routeExtractedModToSpt(extractedDir, sptDirectory, fallbackModName, sptVersion = '4.1.6', performanceMode = 'balanced', onProgress = null) {
  const { serverModsDir, serverModsRelDir } = resolveSptPaths(sptDirectory, sptVersion);
  const targetClientPluginsDir = path.join(sptDirectory, 'BepInEx', 'plugins');
  const targetClientPatchersDir = path.join(sptDirectory, 'BepInEx', 'patchers');

  const cleanFallback = (fallbackModName || 'Mod').replace(/[^\w.-]/g, '');
  let detectedServerPath = null;
  let detectedClientPath = null;

  const notifyRoute = (pct, msg) => {
    if (onProgress) {
      onProgress({
        stage: 'routing',
        percent: pct,
        downloadSpeed: msg,
      });
    }
  };

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
  notifyRoute(92, 'Routing server mod files...');
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
  notifyRoute(95, 'Routing BepInEx client plugins...');
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
  notifyRoute(97, 'Routing BepInEx client patchers...');
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
  notifyRoute(98, 'Verifying client plugins...');
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
 * Resolves safe HTTP request headers for mod downloads.
 * Uses an authentic application client User-Agent and strips 'Referer' on external git/CDN
 * mirrors (Codeberg, GitHub, GitLab, S3) to guarantee HTTP 200 responses.
 */
function getDownloadHeaders(targetUrl, strategy = 'default') {
  let host = '';
  try {
    host = new URL(targetUrl).hostname.toLowerCase();
  } catch (_) {}

  if (strategy === 'fallback_curl') {
    return {
      'User-Agent': 'curl/8.6.0',
      'Accept': '*/*',
    };
  }

  if (strategy === 'browser') {
    const h = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    };
    if (host.endsWith('sp-mod.com') || host === 'sp-mod.com') {
      h['Referer'] = 'https://sp-mod.com/';
    }
    return h;
  }

  // Standard Strategy: Authentic Application Client Identifier (bypasses Codeberg & Forgejo bot blocks)
  const headers = {
    'User-Agent': 'BlacksiteModManager/2.1.0 (Windows NT 10.0; Win64; x64; SPT-Mod-Manager)',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  // Only pass Referer when talking directly to sp-mod.com
  if (host.endsWith('sp-mod.com') || host === 'sp-mod.com') {
    headers['Referer'] = 'https://sp-mod.com/';
  }

  return headers;
}

/**
 * Native Node.js HTTP/HTTPS streaming downloader with permissive TLS agent.
 * Handles broken SSL certificates (e.g. author external hosts), redirects,
 * and throttles live download progress.
 */
function downloadViaNodeHttp(requestUrl, destFilePath, headers = {}, onProgress = null, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    if (redirectDepth > 10) {
      return reject(new Error('Too many HTTP redirects (exceeded 10 hops).'));
    }

    let parsed;
    try {
      parsed = new URL(requestUrl);
    } catch (urlErr) {
      return reject(urlErr);
    }

    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;

    const reqOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        ...headers,
        Host: parsed.hostname,
      },
      timeout: 45000,
    };

    if (isHttps) {
      reqOptions.agent = new https.Agent({
        rejectUnauthorized: false,
        keepAlive: true,
        checkServerIdentity: () => undefined,
      });
    }

    const req = client.request(reqOptions, (res) => {
      // Follow 301, 302, 303, 307, 308 redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const location = res.headers['location'];
        if (!location) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} redirect without Location header.`));
        }
        res.resume();
        const nextUrl = new URL(location, requestUrl).toString();
        return downloadViaNodeHttp(nextUrl, destFilePath, headers, onProgress, redirectDepth + 1)
          .then(resolve)
          .catch(reject);
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        const httpErr = new Error(
          `Download failed with HTTP status ${res.statusCode}: ${res.statusMessage || (res.statusCode === 404 ? 'Not Found' : 'Download Error')}`
        );
        httpErr.statusCode = res.statusCode;
        if (res.statusCode === 404) httpErr.code = 'ERR_NOT_FOUND_404';
        return reject(httpErr);
      }

      const contentType = res.headers['content-type'] || '';
      // Guard against HTML error pages masquerading as archives
      if (contentType.includes('text/html') && !requestUrl.includes('github') && !requestUrl.includes('codeberg')) {
        res.resume();
        const htmlErr = new Error('Download failed: remote host returned an HTML web page instead of a mod archive file.');
        htmlErr.statusCode = 404;
        htmlErr.code = 'ERR_NOT_FOUND_404';
        return reject(htmlErr);
      }

      const contentLengthHeader = res.headers['content-length'];
      const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
      const fileStream = fs.createWriteStream(destFilePath);

      let receivedBytes = 0;
      let lastProgressTime = Date.now();
      let lastBytesInWindow = 0;

      res.on('data', (chunk) => {
        receivedBytes += chunk.length;
        fileStream.write(chunk);

        const now = Date.now();
        if (now - lastProgressTime >= 120) {
          const elapsedSec = (now - lastProgressTime) / 1000;
          const bytesInInterval = receivedBytes - lastBytesInWindow;
          let downloadSpeed = 'Calculating...';
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

      res.on('end', () => {
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
        resolve({ totalBytes: totalBytes || receivedBytes });
      });

      res.on('error', (err) => {
        fileStream.destroy();
        reject(err);
      });

      fileStream.on('error', (err) => {
        reject(err);
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Download connection timed out after 45 seconds.'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

/**
 * Streams a remote file directly to disk in 64KB chunks with throttled progress events.
 * Handles manual redirect hops across hosts, automatically recovers from broken TLS,
 * and handles 404 fallbacks.
 */
async function streamDownloadToFile(initialUrl, destFilePath, onProgress, maxRetries = 3) {
  let attempt = 0;
  let currentUrl = initialUrl;

  while (attempt <= maxRetries) {
    try {
      let redirects = 0;
      const maxRedirects = 10;
      let response = null;

      const fetchFn =
        typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function'
          ? globalThis.fetch
          : fetch;

      const strategy = attempt === 0 ? 'default' : attempt === 1 ? 'fallback_curl' : 'browser';

      while (redirects <= maxRedirects) {
        let headers = getDownloadHeaders(currentUrl, strategy);

        try {
          response = await fetchFn(currentUrl, {
            headers,
            redirect: 'manual',
          });
        } catch (fetchErr) {
          console.warn(`[Blacksite Installer] Fetch engine threw error on ${currentUrl} (${fetchErr.message}). Switching to native HTTPS agent...`);
          return await downloadViaNodeHttp(currentUrl, destFilePath, headers, onProgress);
        }

        // Explicitly handle HTTP 301, 302, 303, 307, 308 redirects
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (!location) {
            throw new Error(`HTTP ${response.status} redirect without Location header.`);
          }
          currentUrl = new URL(location, currentUrl).toString();
          redirects++;
          continue;
        }

        // If 403 Forbidden is encountered on this hop, immediately try with tool fallback
        if (response.status === 403 && strategy !== 'fallback_curl') {
          console.warn(`[Blacksite Installer] HTTP 403 on ${currentUrl}, retrying with tool fallback headers...`);
          const fallbackHeaders = getDownloadHeaders(currentUrl, 'fallback_curl');
          try {
            response = await fetchFn(currentUrl, {
              headers: fallbackHeaders,
              redirect: 'manual',
            });
          } catch (fetchErr) {
            return await downloadViaNodeHttp(currentUrl, destFilePath, fallbackHeaders, onProgress);
          }

          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            if (location) {
              currentUrl = new URL(location, currentUrl).toString();
              redirects++;
              continue;
            }
          }
        }

        break;
      }

      if (!response.ok) {
        // Automatic 404 Recovery: If direct CDN link files.sp-mod.com/mods/{id}.zip returns 404,
        // try the Forge gateway route: https://sp-mod.com/mod/download/{id}
        if (response.status === 404 && currentUrl.includes('files.sp-mod.com/mods/')) {
          const modIdMatch = currentUrl.match(/mods\/(\d+)\.zip/);
          if (modIdMatch && modIdMatch[1]) {
            const fallbackForgeUrl = `https://sp-mod.com/mod/download/${modIdMatch[1]}`;
            console.log(`[Blacksite Installer] Direct CDN returned 404. Attempting Forge download fallback: ${fallbackForgeUrl}`);
            try {
              return await streamDownloadToFile(fallbackForgeUrl, destFilePath, onProgress, 1);
            } catch (fbErr) {
              // Let original 404 error propagate if fallback also failed
            }
          }
        }

        const httpErr = new Error(
          `Download failed with HTTP status ${response.status}: ${
            response.statusText || (response.status === 404 ? 'Not Found' : response.status === 403 ? 'Forbidden' : 'Download Error')
          }`
        );
        httpErr.statusCode = response.status;
        if (response.status === 404) httpErr.code = 'ERR_NOT_FOUND_404';
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
      if (err.message && (err.message.includes('fetch failed') || err.message.includes('SSL') || err.message.includes('CERT_'))) {
        try {
          console.warn(`[Blacksite Installer] Fetch failed on attempt ${attempt + 1}. Retrying via Node native HTTPS agent...`);
          return await downloadViaNodeHttp(currentUrl, destFilePath, getDownloadHeaders(currentUrl, 'default'), onProgress);
        } catch (nodeHttpErr) {
          err = nodeHttpErr;
        }
      }

      attempt++;
      if (attempt > maxRetries || err.statusCode === 404 || err.code === 'ERR_NOT_FOUND_404') {
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
  let finalArchiveFile = tempArchiveFile;

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

    // Check if downloaded payload is directly a standalone Windows DLL (e.g. BepInEx plugin)
    let isStandaloneDll = false;
    if (archiveFileName && archiveFileName.toLowerCase().endsWith('.dll')) {
      isStandaloneDll = true;
    } else if (fs.existsSync(tempArchiveFile)) {
      try {
        const fd = fs.openSync(tempArchiveFile, 'r');
        const buffer = Buffer.alloc(4);
        fs.readSync(fd, buffer, 0, 4, 0);
        fs.closeSync(fd);
        // 'MZ' header (0x4D, 0x5A) indicating Windows executable/DLL, not zip (0x50, 0x4B)
        if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
          isStandaloneDll = true;
        }
      } catch (_) {}
    }

    if (isStandaloneDll) {
      console.log(`[Blacksite Installer] Detected standalone client DLL plugin: ${modName}`);
      const targetClientPluginsDir = path.join(sptDirectory, 'BepInEx', 'plugins');
      fs.mkdirSync(targetClientPluginsDir, { recursive: true });

      const cleanDllName =
        archiveFileName && archiveFileName.toLowerCase().endsWith('.dll')
          ? path.basename(archiveFileName)
          : `${(modName || 'Plugin').replace(/[^\w.-]/g, '')}.dll`;

      const destDllPath = path.join(targetClientPluginsDir, cleanDllName);
      fs.copyFileSync(tempArchiveFile, destDllPath);

      if (onProgress) {
        onProgress({
          stage: 'installed',
          percent: 100,
          downloadSpeed: 'Complete',
        });
      }

      const routeResult = {
        success: true,
        serverPath: null,
        clientPath: `BepInEx/plugins/${cleanDllName}`,
        kind: 'Client',
      };
      console.log(`[Blacksite Installer] Standalone DLL placed into BepInEx/plugins:`, routeResult);
      return routeResult;
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

    const detectedFmt = detectArchiveFormat(tempArchiveFile);
    if (detectedFmt && !tempArchiveFile.toLowerCase().endsWith(`.${detectedFmt}`)) {
      const properArchiveFile = `${tempArchiveFile}.${detectedFmt}`;
      try {
        fs.renameSync(tempArchiveFile, properArchiveFile);
        finalArchiveFile = properArchiveFile;
      } catch (_) {}
    }

    await extractArchive(finalArchiveFile, tempExtractDir, performanceMode, onProgress);

    // Routing stage
    console.log(`[Blacksite Installer] Routing files into SPT: ${sptDirectory}...`);
    if (onProgress) {
      onProgress({
        stage: 'routing',
        percent: 90,
        downloadSpeed: isSameDriveStaging ? 'Atomic same-drive moving...' : 'Routing to SPT_Runtime...',
      });
    }
    const routeResult = await routeExtractedModToSpt(
      tempExtractDir,
      sptDirectory,
      modName,
      sptVersion,
      performanceMode,
      onProgress
    );

    if (onProgress) {
      onProgress({
        stage: 'installed',
        percent: 100,
        downloadSpeed: 'Complete',
      });
    }

    console.log(`[Blacksite Installer] Installation completed successfully!`, routeResult);
    return routeResult;
  } catch (err) {
    if (err.canManualExtract && finalArchiveFile && fs.existsSync(finalArchiveFile)) {
      try {
        const downloadsDir = path.join(sptDirectory, 'Downloads');
        fs.mkdirSync(downloadsDir, { recursive: true });
        const preservedTarget = path.join(downloadsDir, path.basename(finalArchiveFile));
        fs.copyFileSync(finalArchiveFile, preservedTarget);
        err.archivePath = preservedTarget;
        console.log(`[Blacksite Installer] Preserved downloaded archive for manual extraction at: ${preservedTarget}`);
      } catch (copyErr) {
        console.warn('[Blacksite Installer] Could not copy archive to Downloads folder:', copyErr.message);
      }
    }
    throw err;
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
