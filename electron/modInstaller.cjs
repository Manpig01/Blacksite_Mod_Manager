const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
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

  // First check if sibling unpacked path exists (Electron electron-builder standard)
  const unpackedPath = binPath.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
  if (unpackedPath !== binPath && fs.existsSync(unpackedPath)) {
    return unpackedPath;
  }

  // If inside .asar or virtual asar path, extract to user-data or temp disk location
  try {
    const isWin = process.platform === 'win32';
    const binName = isWin ? '7za.exe' : '7za';
    const diskDirs = [
      path.join(getUserDataDir(), 'bin'),
      path.join(os.tmpdir(), 'blacksite-bin'),
    ];

    for (const tempBinDir of diskDirs) {
      try {
        fs.mkdirSync(tempBinDir, { recursive: true });
        const targetDiskBin = path.join(tempBinDir, binName);

        // Read buffer (Electron fs reads from inside app.asar seamlessly)
        if (fs.existsSync(binPath)) {
          const binBuffer = fs.readFileSync(binPath);
          if (binBuffer && binBuffer.length > 50000) {
            if (!fs.existsSync(targetDiskBin) || fs.statSync(targetDiskBin).size !== binBuffer.length) {
              const tempWritePath = `${targetDiskBin}.${Date.now()}.tmp`;
              fs.writeFileSync(tempWritePath, binBuffer);
              try { if (fs.existsSync(targetDiskBin)) fs.unlinkSync(targetDiskBin); } catch (_) {}
              fs.renameSync(tempWritePath, targetDiskBin);
            }
            if (!isWin) {
              try { fs.chmodSync(targetDiskBin, 0o755); } catch {}
            }
            return targetDiskBin;
          }
        }
      } catch (dirErr) {
        console.warn(`[Blacksite Installer] Failed writing unpacked binary to ${tempBinDir}:`, dirErr.message);
      }
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

  // 3. Check extraResources & app.asar.unpacked in packaged Electron (from electron-builder extraResources)
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'bin', binSubdir, exeName));
    candidates.push(path.join(process.resourcesPath, 'bin', exeName));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'bin', binSubdir, exeName));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'bin', exeName));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '7zip-bin', binSubdir, 'x64', exeName));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '7zip-bin', binSubdir, exeName));
    candidates.push(path.join(process.resourcesPath, exeName));
  }

  // 4. Check app.asar.unpacked derived from current __dirname
  const unpackedDir = __dirname.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
  if (unpackedDir !== __dirname) {
    candidates.push(path.join(unpackedDir, 'bin', binSubdir, exeName));
    candidates.push(path.join(unpackedDir, 'bin', exeName));
    candidates.push(path.join(unpackedDir, '../electron/bin', binSubdir, exeName));
    candidates.push(path.join(unpackedDir, '../bin', binSubdir, exeName));
  }

  // 5. Check bundled electron/bin relative to __dirname and process.cwd()
  candidates.push(path.join(__dirname, 'bin', binSubdir, exeName));
  candidates.push(path.join(__dirname, 'bin', exeName));
  candidates.push(path.join(__dirname, '../electron/bin', binSubdir, exeName));
  candidates.push(path.join(process.cwd(), 'electron/bin', binSubdir, exeName));

  // 6. Check node_modules/7zip-bin
  if (sevenZip && sevenZip.path7za) {
    candidates.push(sevenZip.path7za.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2'));
    candidates.push(sevenZip.path7za);
  }
  candidates.push(path.join(__dirname, '../node_modules/7zip-bin', binSubdir, 'x64', exeName));
  candidates.push(path.join(__dirname, 'node_modules/7zip-bin', binSubdir, 'x64', exeName));
  candidates.push(path.join(process.cwd(), 'node_modules/7zip-bin', binSubdir, 'x64', exeName));

  // 7. Check DragonDen-style tools/7zip directory
  candidates.push(path.join(__dirname, '..', 'tools', '7zip', 'win', '7za.exe'));
  candidates.push(path.join(__dirname, 'tools', '7zip', 'win', '7za.exe'));
  candidates.push(path.join(process.cwd(), 'tools', '7zip', 'win', '7za.exe'));
  candidates.push(path.join(process.cwd(), 'tools', '7zip', '7za.exe'));
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'tools', '7zip', 'win', '7za.exe'));
    candidates.push(path.join(process.resourcesPath, 'tools', '7zip', '7za.exe'));
  }

  // 8. Standard Windows system 7-Zip installations if present
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
      // If path is inside an ASAR container, extract it to disk first
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

  // 9. Last-ditch check: test if 7za or 7z is globally in system PATH
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
 * Constant-memory ring buffer for process diagnostic logs.
 * Prevents memory exhaustion on 50,000+ file extractions by storing a bounded window of lines.
 */
class DiagnosticRingBuffer {
  constructor(maxEntries = 40) {
    this.maxEntries = maxEntries;
    this.entries = [];
  }

  push(text) {
    if (!text) return;
    const lines = String(text)
      .split(/[\r\n]+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !/^[\b\s]+$/.test(l));

    for (const line of lines) {
      this.entries.push(line);
      if (this.entries.length > this.maxEntries) {
        this.entries.shift();
      }
    }
  }

  toString() {
    return this.entries.join('\n');
  }

  get length() {
    return this.entries.length;
  }
}

const PROTECTED_CORE_ITEMS = new Set([
  'spt',
  'spt-core',
  'spt_core',
  'spt-common',
  'spt-custom',
  'spt-debugging',
  'spt-reflection',
  'spt-singleplayer',
  'spt.prepatch',
  'spt-prepatch',
  'aki',
  'aki-core',
  'aki-common',
  'aki-custom',
  'aki-debugging',
  'aki-reflection',
  'aki-singleplayer',
  'aki.prepatch',
  'bepinex',
  'bepinex.preloader',
  'bepinex.harmony',
  '0harmony',
  'mono.cecil',
  'core',
  'configurationmanager',
  'spt_data',
  'aki_data',
  'spt.server.exe',
  'spt.launcher.exe',
  'aki.server.exe',
  'aki.launcher.exe',
  'escapefromtarkov.exe',
  'escapefromtarkov_data',
]);

const FORBIDDEN_SPT_CORE_PATHS = [
  'bepinex/core',
  'bepinex/plugins/spt',
  'bepinex/plugins/aki',
  'bepinex/plugins/configurationmanager',
  'spt_data',
  'aki_data',
  'spt_runtime/spt.server.exe',
  'spt_runtime/spt.server',
  'spt/spt.server.exe',
  'escapefromtarkov.exe',
  'escapefromtarkov_data',
  'spt.server.exe',
  'spt.launcher.exe',
  'aki.server.exe',
  'aki.launcher.exe',
  'spt.server',
  'spt.launcher',
];

/**
 * Asserts that a target file or directory path is safely contained within the SPT root
 * and does not target or clobber protected core SPT system files or execute path traversal.
 */
function assertSafeSptTarget(targetPath, sptDirectory) {
  if (!targetPath || !sptDirectory) {
    throw new Error('assertSafeSptTarget: targetPath and sptDirectory are required');
  }

  const resolvedTarget = path.resolve(targetPath);
  const resolvedSpt = path.resolve(sptDirectory);

  // 1. Path traversal & Zip-Slip validation (must be strictly inside sptDirectory)
  const rel = path.relative(resolvedSpt, resolvedTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Security Violation: Target path "${targetPath}" escapes SPT root directory "${sptDirectory}"`);
  }

  // 2. Canonical case-folded SPT invariant protection
  const normalizedRel = rel.replace(/\\/g, '/').toLowerCase();

  for (const forbidden of FORBIDDEN_SPT_CORE_PATHS) {
    if (normalizedRel === forbidden || normalizedRel.startsWith(forbidden + '/')) {
      throw new Error(`Integrity Protection: Target path "${rel}" targets protected core SPT system path "${forbidden}". Operation blocked.`);
    }
  }

  return resolvedTarget;
}

function isProtectedCoreItem(nameOrRelPath) {
  if (!nameOrRelPath) return true;
  const normalized = nameOrRelPath.replace(/\\/g, '/').toLowerCase().trim();
  const basenameNoDisabled = path.basename(normalized).replace(/\.disabled$/, '');
  const basenameNoDll = basenameNoDisabled.replace(/\.(dll|exe)$/, '');
  if (PROTECTED_CORE_ITEMS.has(basenameNoDisabled) || PROTECTED_CORE_ITEMS.has(basenameNoDll)) {
    return true;
  }
  for (const forbidden of FORBIDDEN_SPT_CORE_PATHS) {
    if (normalized === forbidden || normalized.startsWith(forbidden + '/') || normalized.endsWith('/' + forbidden)) {
      return true;
    }
  }
  return false;
}

const DEFAULT_RESOURCE_LIMITS = {
  maxDownloadBytes: 8 * 1024 * 1024 * 1024, // 8 GB
  maxExtractedBytes: 20 * 1024 * 1024 * 1024, // 20 GB
  maxFiles: 100000, // 100,000 files
  maxCompressionRatio: 200, // 200:1 ratio ceiling (when uncompressed > 10 MB)
  ratioThresholdBytes: 10 * 1024 * 1024, // 10 MB
};

function resolveResourceLimits(custom = {}) {
  return {
    maxDownloadBytes:
      Number(custom?.maxDownloadBytes || process.env.BLACKSITE_MAX_DOWNLOAD_BYTES) ||
      DEFAULT_RESOURCE_LIMITS.maxDownloadBytes,
    maxExtractedBytes:
      Number(custom?.maxExtractedBytes || process.env.BLACKSITE_MAX_EXTRACTED_BYTES) ||
      DEFAULT_RESOURCE_LIMITS.maxExtractedBytes,
    maxFiles:
      Number(custom?.maxFiles || process.env.BLACKSITE_MAX_ARCHIVE_FILES) ||
      DEFAULT_RESOURCE_LIMITS.maxFiles,
    maxCompressionRatio:
      Number(custom?.maxCompressionRatio || process.env.BLACKSITE_MAX_COMPRESSION_RATIO) ||
      DEFAULT_RESOURCE_LIMITS.maxCompressionRatio,
    ratioThresholdBytes:
      Number(custom?.ratioThresholdBytes) || DEFAULT_RESOURCE_LIMITS.ratioThresholdBytes,
  };
}

/**
 * Validates a single archive entry path and metadata before extraction (fail-closed).
 * Rejects absolute paths, drive letters, UNC paths, parent traversal (..),
 * Windows Alternate Data Streams (:), null bytes, and symbolic/hard/reparse links.
 */
function validateArchiveEntryPath(rawEntryPath, options = {}) {
  if (typeof rawEntryPath !== 'string' || !rawEntryPath.trim()) {
    const err = new Error('Unsafe archive entry: empty or non-string entry path');
    err.code = 'ERR_UNSAFE_ARCHIVE';
    err.canManualExtract = false;
    throw err;
  }

  if (rawEntryPath.includes('\0')) {
    const err = new Error(`Unsafe archive entry (null byte rejected): "${rawEntryPath}"`);
    err.code = 'ERR_UNSAFE_ARCHIVE';
    err.canManualExtract = false;
    throw err;
  }

  // Reject symlink / hardlink / reparse point entries
  if (
    options.isSymlink ||
    options.isHardlink ||
    options.isReparsePoint ||
    (typeof options.attributes === 'string' &&
      /\b(symbol|reparse|junction|symlink)\b/i.test(options.attributes)) ||
    (typeof options.typeFlag === 'string' && ['l', 'h', '2', '1'].includes(options.typeFlag))
  ) {
    const err = new Error(`Unsafe archive entry (symbolic link or reparse point rejected): "${rawEntryPath}"`);
    err.code = 'ERR_UNSAFE_ARCHIVE';
    err.canManualExtract = false;
    throw err;
  }

  // Check POSIX mode bits for symlink (S_IFLNK = 0o120000)
  if (typeof options.posixMode === 'number' && (options.posixMode & 0o170000) === 0o120000) {
    const err = new Error(`Unsafe archive entry (POSIX symlink rejected): "${rawEntryPath}"`);
    err.code = 'ERR_UNSAFE_ARCHIVE';
    err.canManualExtract = false;
    throw err;
  }

  // Reject UNC paths (\\server\share or //server/share) and leading slashes (absolute paths)
  if (/^(\\\\|\/\/)/.test(rawEntryPath) || /^[/\\]/.test(rawEntryPath)) {
    const err = new Error(`Unsafe archive entry (absolute or UNC path rejected): "${rawEntryPath}"`);
    err.code = 'ERR_UNSAFE_ARCHIVE';
    err.canManualExtract = false;
    throw err;
  }

  // Reject Windows drive letters (C:...) and Windows Alternate Data Streams (file.txt:stream)
  if (rawEntryPath.includes(':')) {
    const err = new Error(
      `Unsafe archive entry (drive path or Windows Alternate Data Stream rejected): "${rawEntryPath}"`
    );
    err.code = 'ERR_UNSAFE_ARCHIVE';
    err.canManualExtract = false;
    throw err;
  }

  const normalized = rawEntryPath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  for (const seg of segments) {
    if (seg === '..') {
      const err = new Error(`Unsafe archive entry (path traversal ".." rejected): "${rawEntryPath}"`);
      err.code = 'ERR_UNSAFE_ARCHIVE';
      err.canManualExtract = false;
      throw err;
    }
  }

  if (options.destinationDir) {
    const resolvedDest = path.resolve(options.destinationDir);
    const resolvedTarget = path.resolve(resolvedDest, normalized);
    const rel = path.relative(resolvedDest, resolvedTarget);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      const err = new Error(`Unsafe archive entry (escapes staging directory): "${rawEntryPath}"`);
      err.code = 'ERR_UNSAFE_ARCHIVE';
      err.canManualExtract = false;
      throw err;
    }
  }

  return normalized;
}

/**
 * Enforces resource limits across an archive's entry manifest.
 */
function assertArchiveManifestWithinLimits(stats, compressedBytes, limits) {
  if (stats.fileCount > limits.maxFiles) {
    const err = new Error(
      `Archive exceeds maximum file count limit (${stats.fileCount.toLocaleString()} files > ${limits.maxFiles.toLocaleString()} allowed).`
    );
    err.code = 'ERR_ARCHIVE_LIMIT_EXCEEDED';
    err.canManualExtract = false;
    throw err;
  }

  if (stats.totalUncompressedBytes > limits.maxExtractedBytes) {
    const err = new Error(
      `Archive exceeds maximum uncompressed size limit (${(stats.totalUncompressedBytes / (1024 * 1024 * 1024)).toFixed(2)} GB > ${(limits.maxExtractedBytes / (1024 * 1024 * 1024)).toFixed(2)} GB allowed).`
    );
    err.code = 'ERR_ARCHIVE_LIMIT_EXCEEDED';
    err.canManualExtract = false;
    throw err;
  }

  if (
    stats.totalUncompressedBytes > limits.ratioThresholdBytes &&
    compressedBytes > 0
  ) {
    const ratio = stats.totalUncompressedBytes / compressedBytes;
    if (ratio > limits.maxCompressionRatio) {
      const err = new Error(
        `Archive rejected due to extreme compression ratio (${ratio.toFixed(1)}:1 exceeds ${limits.maxCompressionRatio}:1 safety limit).`
      );
      err.code = 'ERR_ARCHIVE_LIMIT_EXCEEDED';
      err.canManualExtract = false;
      throw err;
    }
  }
}

/**
 * Inspects and validates all entries of an archive before extraction.
 * Supports 7za (-slt), AdmZip, tar (-tvf), and PowerShell ZipFile inspection.
 */
async function inspectAndValidateArchive(archivePath, format, destinationDir, limits) {
  const archiveStat = fs.statSync(archivePath);
  const compressedBytes = archiveStat.size;

  if (compressedBytes > limits.maxDownloadBytes) {
    const err = new Error(
      `Archive size (${(compressedBytes / (1024 * 1024 * 1024)).toFixed(2)} GB) exceeds maximum download limit (${(limits.maxDownloadBytes / (1024 * 1024 * 1024)).toFixed(2)} GB).`
    );
    err.code = 'ERR_ARCHIVE_LIMIT_EXCEEDED';
    err.canManualExtract = false;
    throw err;
  }

  // 1. For ZIP archives under 1 GB, AdmZip central directory inspection is fast and synchronous in memory
  if ((format === 'zip' || (!format && archivePath.toLowerCase().endsWith('.zip'))) && compressedBytes < 1024 * 1024 * 1024) {
    let zip;
    try {
      zip = new AdmZip(archivePath);
    } catch (zipOpenErr) {
      // Fall through to 7za/tar if AdmZip cannot parse header (e.g. ZIP64 or non-standard zip)
      zip = null;
    }
    if (zip) {
      const entries = zip.getEntries();
      let fileCount = 0;
      let totalUncompressedBytes = 0;

      for (const entry of entries) {
        const attr = entry.header ? entry.header.attr : 0;
        const posixMode = (attr >>> 16) & 0xffff;
        const isSymlink = (posixMode & 0o170000) === 0o120000;

        validateArchiveEntryPath(entry.entryName, {
          destinationDir,
          posixMode,
          isSymlink,
        });

        if (!entry.isDirectory) {
          fileCount++;
          const entrySize = Math.max(0, Number(entry.header?.size || 0));
          totalUncompressedBytes += entrySize;
        }
        assertArchiveManifestWithinLimits({ fileCount, totalUncompressedBytes }, compressedBytes, limits);
      }

      return { fileCount, totalUncompressedBytes };
    }
  }

  // 2. Inspect via 7za `l -slt` if 7za binary is available
  const bin7za = resolve7zaBinary();
  if (bin7za) {
    const listResult = await new Promise((resolve, reject) => {
      const child = spawn(bin7za, ['l', '-slt', '-ba', archivePath], { windowsHide: true });
      let fileCount = 0;
      let totalUncompressedBytes = 0;
      let remainder = '';
      let currentEntry = {};
      let abortedErr = null;

      const processBlockLine = (line) => {
        if (abortedErr) return;
        const trimmed = line.replace(/\r$/, '');
        if (!trimmed) {
          if (currentEntry.path !== undefined) {
            try {
              const isDir = currentEntry.folder === '+' || (currentEntry.attributes || '').startsWith('D');
              const isSymlink =
                Boolean(currentEntry.symbolicLink) ||
                Boolean(currentEntry.posixLink) ||
                /\b(l|symlink|reparse)\b/i.test(currentEntry.attributes || '');
              validateArchiveEntryPath(currentEntry.path, {
                destinationDir,
                isSymlink,
                attributes: currentEntry.attributes,
              });
              if (!isDir) {
                fileCount++;
                totalUncompressedBytes += Math.max(0, Number(currentEntry.size || 0));
              }
              assertArchiveManifestWithinLimits({ fileCount, totalUncompressedBytes }, compressedBytes, limits);
            } catch (vErr) {
              abortedErr = vErr;
              try { child.kill(); } catch (_) {}
            }
          }
          currentEntry = {};
          return;
        }

        const eqIdx = trimmed.indexOf(' = ');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim().toLowerCase();
          const val = trimmed.slice(eqIdx + 3);
          if (key === 'path') currentEntry.path = val;
          else if (key === 'size') currentEntry.size = parseInt(val, 10) || 0;
          else if (key === 'folder') currentEntry.folder = val.trim();
          else if (key === 'attributes') currentEntry.attributes = val.trim();
          else if (key === 'symbolic link') currentEntry.symbolicLink = val.trim();
          else if (key === 'mode' && val.trim().startsWith('l')) currentEntry.posixLink = true;
        }
      };

      if (child.stdout) {
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
          remainder += chunk;
          const lines = remainder.split('\n');
          remainder = lines.pop() || '';
          for (const l of lines) {
            processBlockLine(l);
          }
        });
      }

      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (remainder) {
          processBlockLine(remainder);
          processBlockLine('');
        } else if (currentEntry.path !== undefined) {
          processBlockLine('');
        }
        if (abortedErr) return reject(abortedErr);
        if (code === 0 || code === 1) {
          return resolve({ fileCount, totalUncompressedBytes });
        }
        reject(new Error(`7za manifest inspection exited with code ${code}`));
      });
    }).catch((err) => {
      if (err.code === 'ERR_UNSAFE_ARCHIVE' || err.code === 'ERR_ARCHIVE_LIMIT_EXCEEDED') {
        throw err;
      }
      return null;
    });

    if (listResult) return listResult;
  }

  // 3. Inspect via tar -tvf if tar is available and format is zip or tar.gz
  if (format !== '7z' && format !== 'rar') {
    const tarBin = process.platform === 'win32' ? resolveWindowsTar() : 'tar';
    if (tarBin) {
      const tarResult = await new Promise((resolve, reject) => {
        execFile(
          tarBin,
          ['-tvf', archivePath],
          { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
          (err, stdout) => {
            if (err) return reject(err);
            let fileCount = 0;
            let totalUncompressedBytes = 0;
            const lines = String(stdout || '').split(/\r?\n/).filter(Boolean);
            for (const line of lines) {
              const firstChar = line[0];
              const isLink = firstChar === 'l' || firstChar === 'h' || line.includes(' -> ');
              const isDir = firstChar === 'd';
              // Parse tar -tvf line: permissions links owner group size date time pathname
              const parts = line.trim().split(/\s+/);
              const sizeVal = parts.length >= 5 ? parseInt(parts[4], 10) || 0 : 0;
              const entryPath = parts.slice(parts.length >= 8 ? 7 : parts.length - 1).join(' ');

              validateArchiveEntryPath(entryPath, {
                destinationDir,
                isSymlink: isLink,
                typeFlag: firstChar,
              });

              if (!isDir) {
                fileCount++;
                totalUncompressedBytes += Math.max(0, sizeVal);
              }
              assertArchiveManifestWithinLimits({ fileCount, totalUncompressedBytes }, compressedBytes, limits);
            }
            resolve({ fileCount, totalUncompressedBytes });
          }
        );
      }).catch((err) => {
        if (err.code === 'ERR_UNSAFE_ARCHIVE' || err.code === 'ERR_ARCHIVE_LIMIT_EXCEEDED') {
          throw err;
        }
        return null;
      });

      if (tarResult) return tarResult;
    }
  }

  return null;
}

/**
 * Post-extraction staging tree verification:
 * Walks the extracted staging directory using lstatSync to reject any symbolic link,
 * special device file, path escaping staging, or resource limit violation.
 */
function verifyExtractedStagingTree(destinationDir, limits) {
  const resolvedDest = path.resolve(destinationDir);
  if (!fs.existsSync(resolvedDest)) return { fileCount: 0, totalBytes: 0 };

  let fileCount = 0;
  let totalBytes = 0;

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir);
    for (const name of entries) {
      if (name.includes(':')) {
        const err = new Error(`Unsafe extracted entry (Alternate Data Stream rejected): "${name}"`);
        err.code = 'ERR_UNSAFE_ARCHIVE';
        err.canManualExtract = false;
        throw err;
      }

      const fullPath = path.join(currentDir, name);
      const rel = path.relative(resolvedDest, fullPath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        const err = new Error(`Unsafe extracted entry (escaped staging root): "${rel}"`);
        err.code = 'ERR_UNSAFE_ARCHIVE';
        err.canManualExtract = false;
        throw err;
      }

      const lstat = fs.lstatSync(fullPath);
      if (lstat.isSymbolicLink()) {
        const err = new Error(`Unsafe extracted entry (symbolic link rejected in staging): "${rel}"`);
        err.code = 'ERR_UNSAFE_ARCHIVE';
        err.canManualExtract = false;
        throw err;
      }

      if (lstat.isDirectory()) {
        walk(fullPath);
      } else if (lstat.isFile()) {
        fileCount++;
        totalBytes += lstat.size;
        if (fileCount > limits.maxFiles) {
          const err = new Error(
            `Extracted file count (${fileCount.toLocaleString()}) exceeds limit (${limits.maxFiles.toLocaleString()}).`
          );
          err.code = 'ERR_ARCHIVE_LIMIT_EXCEEDED';
          err.canManualExtract = false;
          throw err;
        }
        if (totalBytes > limits.maxExtractedBytes) {
          const err = new Error(
            `Extracted total size (${(totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB) exceeds limit (${(limits.maxExtractedBytes / (1024 * 1024 * 1024)).toFixed(2)} GB).`
          );
          err.code = 'ERR_ARCHIVE_LIMIT_EXCEEDED';
          err.canManualExtract = false;
          throw err;
        }
      } else {
        const err = new Error(`Unsafe extracted entry (unsupported special file type): "${rel}"`);
        err.code = 'ERR_UNSAFE_ARCHIVE';
        err.canManualExtract = false;
        throw err;
      }
    }
  }

  walk(resolvedDest);
  return { fileCount, totalBytes };
}

/**
 * Robust non-blocking archive extraction with pre-extraction manifest validation,
 * resource limits enforcement, and live percentage progress streaming.
 * Never uses the unsafe 7za -spf switch. Fails closed and wipes partial output on error.
 */
async function extractArchive(
  archivePath,
  destinationDir,
  performanceMode = 'balanced',
  onProgress = null,
  customLimits = {}
) {
  const limits = resolveResourceLimits(customLimits);
  fs.mkdirSync(destinationDir, { recursive: true });

  const wipeDestinationDir = () => {
    try {
      if (destinationDir && fs.existsSync(destinationDir)) {
        fs.rmSync(destinationDir, { recursive: true, force: true });
      }
    } catch (_) {}
  };

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
    let bin7za = resolve7zaBinary();
    if (!bin7za && (format === '7z' || format === 'rar' || !format)) {
      bin7za = await ensure7zaBinary(onProgress);
    }

    // Pre-validate archive manifest before extracting a single byte (fail-closed)
    await inspectAndValidateArchive(archivePath, format, destinationDir, limits);

    // 1. Try precompiled 7za binary FIRST (strictly without -spf)
    if (bin7za) {
      fs.mkdirSync(destinationDir, { recursive: true });
      const threadCount = getExtractionThreadCount(performanceMode);
      const cleanDest = destinationDir.replace(/[\\/]+$/, '');

      const runSafe7zaExtraction = () => {
        return new Promise((resolve, reject) => {
          // Security invariant: NEVER pass -spf to 7za
          const args = ['x', archivePath, '-y', '-aoa', '-bb0', '-bso0', '-bsp1', `-o${cleanDest}`, `-mmt=${threadCount}`];

          const stderrRing = new DiagnosticRingBuffer(40);
          const stdoutRing = new DiagnosticRingBuffer(40);

          const child = spawn(bin7za, args, { windowsHide: true });

          if (child.stderr) {
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (chunk) => {
              stderrRing.push(chunk);
            });
          }

          if (child.stdout) {
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', (chunk) => {
              const matches = chunk.matchAll(/(\d+)%/g);
              for (const m of matches) {
                const parsed = parseInt(m[1], 10);
                if (!isNaN(parsed) && parsed > extractionProgress) {
                  reportProgress(parsed, `Extracting (7-Zip Multi-core) ${parsed}%...`);
                }
              }
              if (chunk.includes('Error') || chunk.includes('WARNING') || chunk.includes('Can not open')) {
                stdoutRing.push(chunk);
              }
            });
          }

          child.on('error', (err) => {
            reject(err);
          });

          child.on('close', (code) => {
            if (code === 0 || code === 1) {
              return resolve();
            }
            const diagnostic =
              stderrRing.toString() || stdoutRing.toString() || `Decompression process exited with code ${code}`;
            const err = new Error(diagnostic);
            err.exitCode = code;
            reject(err);
          });
        });
      };

      try {
        await runSafe7zaExtraction();
        verifyExtractedStagingTree(destinationDir, limits);
        cleanupTimer();
        reportProgress(100, 'Extraction complete');
        return true;
      } catch (firstErr) {
        wipeDestinationDir();
        if (firstErr.code === 'ERR_UNSAFE_ARCHIVE' || firstErr.code === 'ERR_ARCHIVE_LIMIT_EXCEEDED') {
          throw firstErr;
        }
        console.warn('[Blacksite Installer] 7za extraction failed, cleaning staging:', firstErr.message);
      }
    }

    // 2. Try Windows Native System32\tar.exe (bsdtar)
    if (format !== '7z' && format !== 'rar') {
      const winTar = resolveWindowsTar();
      if (winTar) {
        try {
          fs.mkdirSync(destinationDir, { recursive: true });
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
          verifyExtractedStagingTree(destinationDir, limits);
          cleanupTimer();
          reportProgress(100, 'Extraction complete');
          return true;
        } catch (tarErr) {
          wipeDestinationDir();
          if (tarErr.code === 'ERR_UNSAFE_ARCHIVE' || tarErr.code === 'ERR_ARCHIVE_LIMIT_EXCEEDED') {
            throw tarErr;
          }
          console.warn('[Blacksite Installer] Windows tar.exe failed, falling back to next engine...', tarErr.message);
        }
      }
    }

    // 3. Try standard system tar (macOS / Linux)
    if (process.platform !== 'win32' && format !== '7z' && format !== 'rar') {
      try {
        fs.mkdirSync(destinationDir, { recursive: true });
        await new Promise((resolve, reject) => {
          execFile('tar', ['-xf', archivePath, '-C', destinationDir], { maxBuffer: 100 * 1024 * 1024 }, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        verifyExtractedStagingTree(destinationDir, limits);
        cleanupTimer();
        reportProgress(100, 'Extraction complete');
        return true;
      } catch (tarErr) {
        wipeDestinationDir();
        if (tarErr.code === 'ERR_UNSAFE_ARCHIVE' || tarErr.code === 'ERR_ARCHIVE_LIMIT_EXCEEDED') {
          throw tarErr;
        }
        console.warn('[Blacksite Installer] System tar failed...', tarErr.message);
      }
    }

    // 4. Try PowerShell Expand-Archive on Windows (ZIP only, pre-validated above)
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
        fs.mkdirSync(destinationDir, { recursive: true });
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
        verifyExtractedStagingTree(destinationDir, limits);
        cleanupTimer();
        reportProgress(100, 'Extraction complete');
        return true;
      } catch (psErr) {
        if (didRename) {
          try { fs.renameSync(psZipPath, archivePath); } catch {}
        }
        wipeDestinationDir();
        if (psErr.code === 'ERR_UNSAFE_ARCHIVE' || psErr.code === 'ERR_ARCHIVE_LIMIT_EXCEEDED') {
          throw psErr;
        }
        console.warn('[Blacksite Installer] PowerShell Expand-Archive failed...', psErr.message);
      }
    }

    // 5. Non-blocking chunked AdmZip fallback (ZIP only, fail-closed on any unsafe entry)
    if (format === 'zip' || !format) {
      try {
        const stat = fs.statSync(archivePath);
        if (stat.size < 1024 * 1024 * 1024) {
          await new Promise((r) => setImmediate(r));
          fs.mkdirSync(destinationDir, { recursive: true });
          const zip = new AdmZip(archivePath);
          const entries = zip.getEntries();
          const totalEntries = entries.length;
          let fileCount = 0;
          let totalUncompressedBytes = 0;

          for (let i = 0; i < totalEntries; i++) {
            const entry = entries[i];
            const attr = entry.header ? entry.header.attr : 0;
            const posixMode = (attr >>> 16) & 0xffff;
            const isSymlink = (posixMode & 0o170000) === 0o120000;

            // Fail closed on any unsafe entry rather than skipping
            validateArchiveEntryPath(entry.entryName, {
              destinationDir,
              posixMode,
              isSymlink,
            });

            if (!entry.isDirectory) {
              fileCount++;
              totalUncompressedBytes += Math.max(0, Number(entry.header?.size || 0));
            }
            assertArchiveManifestWithinLimits({ fileCount, totalUncompressedBytes }, stat.size, limits);

            zip.extractEntryTo(entry, destinationDir, true, true);
            if (i % 20 === 0) {
              reportProgress(Math.floor((i / totalEntries) * 95));
              await new Promise((resolve) => setImmediate(resolve));
            }
          }

          verifyExtractedStagingTree(destinationDir, limits);
          cleanupTimer();
          reportProgress(100, 'Extraction complete');
          return true;
        } else {
          console.warn(
            `[Blacksite Installer] Archive exceeds 1GB (${(stat.size / (1024 * 1024)).toFixed(1)} MB). Skipping AdmZip in-memory parser.`
          );
        }
      } catch (admErr) {
        wipeDestinationDir();
        if (admErr.code === 'ERR_UNSAFE_ARCHIVE' || admErr.code === 'ERR_ARCHIVE_LIMIT_EXCEEDED') {
          throw admErr;
        }
        console.warn('[Blacksite Installer] AdmZip fallback failed...', admErr.message);
      }
    }

    wipeDestinationDir();
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
  } catch (err) {
    wipeDestinationDir();
    throw err;
  } finally {
    cleanupTimer();
  }
}

/**
 * Smartly normalizes a user-selected directory to the true SPT root directory.
 * If the user accidentally selected <Root>/BepInEx, <Root>/BepInEx/plugins, <Root>/user/mods,
 * <Root>/SPT, or <Root>/SPT_Runtime, walks up to the actual SPT root folder.
 */
function normalizeSptRoot(rawDirectory) {
  if (!rawDirectory || typeof rawDirectory !== 'string') return rawDirectory;
  const cleaned = path.resolve(rawDirectory.trim());
  if (!fs.existsSync(cleaned)) return cleaned;

  const isSptRootCandidate = (dir) => {
    if (!dir || !fs.existsSync(dir)) return false;
    return (
      fs.existsSync(path.join(dir, 'EscapeFromTarkov.exe')) ||
      fs.existsSync(path.join(dir, 'BepInEx')) ||
      fs.existsSync(path.join(dir, 'SPT.Server.exe')) ||
      fs.existsSync(path.join(dir, 'Aki.Server.exe')) ||
      fs.existsSync(path.join(dir, 'SPT_Runtime')) ||
      fs.existsSync(path.join(dir, 'SPT', 'user')) ||
      fs.existsSync(path.join(dir, 'SPT', 'SPT_Data'))
    );
  };

  const lowerBase = path.basename(cleaned).toLowerCase();
  const parent1 = path.dirname(cleaned);
  const parent2 = path.dirname(parent1);
  const parent3 = path.dirname(parent2);

  if (['plugins', 'patchers', 'config', 'core'].includes(lowerBase) && path.basename(parent1).toLowerCase() === 'bepinex') {
    if (isSptRootCandidate(parent2)) return parent2;
  }
  if (lowerBase === 'mods' && path.basename(parent1).toLowerCase() === 'user') {
    const parent2Base = path.basename(parent2).toLowerCase();
    if (['spt', 'spt_runtime'].includes(parent2Base) && isSptRootCandidate(parent3)) {
      return parent3;
    }
    if (isSptRootCandidate(parent2)) return parent2;
  }
  if (['bepinex', 'user', 'spt_runtime', 'spt_data', 'aki_data'].includes(lowerBase)) {
    if (isSptRootCandidate(parent1)) return parent1;
  }
  if (lowerBase === 'spt' && (fs.existsSync(path.join(parent1, 'BepInEx')) || fs.existsSync(path.join(parent1, 'EscapeFromTarkov.exe')))) {
    return parent1;
  }

  return cleaned;
}

/**
 * Inspects an SPT directory on disk to auto-detect:
 * - Normalized SPT root path
 * - Server binary (SPT.Server.exe, SPT/SPT.Server.exe, SPT_Runtime/SPT.Server.exe, Aki.Server.exe)
 * - Installed SPT version (from core.json, package.json, or core DLLs/binaries)
 * - Evidence-backed active server mod path:
 *     SPT 3.x  -> user/mods
 *     SPT 4.0  -> SPT/user/mods
 *     SPT 4.1+ -> SPT_Runtime/user/mods
 * - Ambiguity & duplicate mod folder detection across layout variants
 */
function inspectSptDirectory(rawDirectory, options = {}) {
  const normalizedPath = normalizeSptRoot(rawDirectory || '');
  const exists = Boolean(normalizedPath && fs.existsSync(normalizedPath));

  const preferredServerModPath =
    typeof options?.preferredServerModPath === 'string' &&
    ['user/mods', 'SPT/user/mods', 'SPT_Runtime/user/mods'].includes(options.preferredServerModPath.replace(/\\/g, '/'))
      ? options.preferredServerModPath.replace(/\\/g, '/')
      : null;

  const defaultResult = {
    normalizedPath: normalizedPath || rawDirectory || '',
    exists,
    isValidSptRoot: false,
    sptVersion: null,
    detectedServerBinary: null,
    serverModPath: preferredServerModPath || 'SPT/user/mods',
    clientModPath: 'BepInEx/plugins',
    isSpt4xLayout: (preferredServerModPath || 'SPT/user/mods') !== 'user/mods',
    isLayoutAmbiguous: false,
    ambiguousLayouts: [],
    duplicateMods: [],
    layoutWarning: null,
  };

  if (!exists) return defaultResult;

  // 1. Detect Server Binary on disk
  const serverBinaryCandidates = [
    { rel: path.join('SPT_Runtime', 'SPT.Server.exe'), name: 'SPT_Runtime/SPT.Server.exe', layout: 'SPT_Runtime/user/mods' },
    { rel: path.join('SPT', 'SPT.Server.exe'), name: 'SPT/SPT.Server.exe', layout: 'SPT/user/mods' },
    { rel: 'SPT.Server.exe', name: 'SPT.Server.exe', layout: null },
    { rel: 'Aki.Server.exe', name: 'Aki.Server.exe', layout: 'user/mods' },
    { rel: 'Server.exe', name: 'Server.exe', layout: null },
  ];

  let detectedServerBinary = null;
  let binaryImpliedLayout = null;
  for (const cand of serverBinaryCandidates) {
    if (fs.existsSync(path.join(normalizedPath, cand.rel))) {
      detectedServerBinary = cand.name;
      binaryImpliedLayout = cand.layout;
      break;
    }
  }

  // 2. Detect SPT Version from configs/core.json, package.json, or core DLLs
  let detectedVersion = null;
  const coreJsonCandidates = [
    path.join(normalizedPath, 'SPT_Runtime', 'SPT_Data', 'Server', 'configs', 'core.json'),
    path.join(normalizedPath, 'SPT', 'SPT_Data', 'Server', 'configs', 'core.json'),
    path.join(normalizedPath, 'SPT_Data', 'Server', 'configs', 'core.json'),
    path.join(normalizedPath, 'Aki_Data', 'Server', 'configs', 'core.json'),
  ];

  for (const coreJsonPath of coreJsonCandidates) {
    if (fs.existsSync(coreJsonPath)) {
      try {
        const raw = fs.readFileSync(coreJsonPath, 'utf8').replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '$1');
        const parsed = JSON.parse(raw);
        const ver = parsed.sptVersion || parsed.akiVersion || parsed.version;
        if (ver && typeof ver === 'string' && /^\d+\.\d+/.test(ver.trim())) {
          detectedVersion = ver.trim();
          break;
        }
      } catch (_) {}
    }
  }

  if (!detectedVersion) {
    const pkgCandidates = [
      path.join(normalizedPath, 'SPT_Runtime', 'package.json'),
      path.join(normalizedPath, 'SPT', 'package.json'),
      path.join(normalizedPath, 'SPT_Data', 'Server', 'package.json'),
      path.join(normalizedPath, 'package.json'),
    ];
    for (const pkgPath of pkgCandidates) {
      if (fs.existsSync(pkgPath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          const ver = parsed.sptVersion || parsed.akiVersion || parsed.version;
          if (ver && typeof ver === 'string' && /^\d+\.\d+/.test(ver.trim())) {
            detectedVersion = ver.trim();
            break;
          }
        } catch (_) {}
      }
    }
  }

  if (!detectedVersion) {
    const coreDllCandidates = [
      path.join(normalizedPath, 'BepInEx', 'plugins', 'spt', 'spt-core.dll'),
      path.join(normalizedPath, 'BepInEx', 'plugins', 'spt', 'spt-singleplayer.dll'),
      path.join(normalizedPath, 'BepInEx', 'plugins', 'aki', 'aki-core.dll'),
    ];
    for (const dllCand of coreDllCandidates) {
      if (fs.existsSync(dllCand)) {
        try {
          const buf = fs.readFileSync(dllCand);
          const ascii = buf.toString('latin1');
          const verMatch = ascii.match(/\b([34]\.\d+\.\d+)\b/);
          if (verMatch && verMatch[1]) {
            detectedVersion = verMatch[1];
            break;
          }
        } catch (_) {}
      }
    }
  }

  // 3. Inspect layout directories and detect duplicate mod folders across layouts
  const hasSptRuntimeStructure =
    fs.existsSync(path.join(normalizedPath, 'SPT_Runtime', 'SPT.Server.exe')) ||
    fs.existsSync(path.join(normalizedPath, 'SPT_Runtime', 'SPT_Data')) ||
    fs.existsSync(path.join(normalizedPath, 'SPT_Runtime', 'user', 'mods'));
  const hasSpt40Structure =
    fs.existsSync(path.join(normalizedPath, 'SPT', 'SPT.Server.exe')) ||
    fs.existsSync(path.join(normalizedPath, 'SPT', 'SPT_Data')) ||
    fs.existsSync(path.join(normalizedPath, 'SPT', 'user', 'mods'));
  const hasSpt3Structure =
    fs.existsSync(path.join(normalizedPath, 'Aki.Server.exe')) ||
    fs.existsSync(path.join(normalizedPath, 'Aki_Data')) ||
    fs.existsSync(path.join(normalizedPath, 'user', 'mods'));

  const listModSubdirs = (dir) => {
    try {
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name.replace(/\.disabled$/i, ''))
        .filter((name) => !isProtectedCoreItem(name));
    } catch {
      return [];
    }
  };

  const layoutFolders = [
    { rel: 'SPT_Runtime/user/mods', abs: path.join(normalizedPath, 'SPT_Runtime', 'user', 'mods') },
    { rel: 'SPT/user/mods', abs: path.join(normalizedPath, 'SPT', 'user', 'mods') },
    { rel: 'user/mods', abs: path.join(normalizedPath, 'user', 'mods') },
  ];

  const populatedLayouts = [];
  const existingLayouts = [];
  const modFolderToLayouts = new Map();

  for (const lf of layoutFolders) {
    if (fs.existsSync(lf.abs)) {
      existingLayouts.push(lf.rel);
      const subdirs = listModSubdirs(lf.abs);
      if (subdirs.length > 0) {
        populatedLayouts.push(lf.rel);
        for (const modDir of subdirs) {
          const key = modDir.toLowerCase();
          if (!modFolderToLayouts.has(key)) {
            modFolderToLayouts.set(key, { name: modDir, modName: modDir, locations: [], layouts: [] });
          }
          const entry = modFolderToLayouts.get(key);
          entry.layouts.push(lf.rel);
          entry.locations.push(`${lf.rel}/${modDir}`);
        }
      }
    }
  }

  const duplicateMods = [];
  for (const [, info] of modFolderToLayouts.entries()) {
    if (info.layouts.length > 1) {
      duplicateMods.push(info);
    }
  }

  // 4. Determine active serverModPath from version and binary evidence (NOT folder counts)
  let evidenceLayout = null;
  const effectiveVersion = detectedVersion || (typeof options?.preferredSptVersion === 'string' ? options.preferredSptVersion.trim() : null);

  if (detectedVersion) {
    if (detectedVersion.startsWith('3.')) {
      evidenceLayout = 'user/mods';
    } else if (/^4\.0(\.|$)/.test(detectedVersion)) {
      evidenceLayout = 'SPT/user/mods';
    } else if (/^4\.[1-9]\d*(\.|$)/.test(detectedVersion)) {
      evidenceLayout = 'SPT_Runtime/user/mods';
    }
  }

  if (!evidenceLayout && binaryImpliedLayout) {
    evidenceLayout = binaryImpliedLayout;
  }

  if (!evidenceLayout) {
    // Structural marker evidence (SPT_Data/Aki_Data) when version file wasn't found
    const markerLayouts = [];
    if (fs.existsSync(path.join(normalizedPath, 'SPT_Runtime', 'SPT_Data'))) markerLayouts.push('SPT_Runtime/user/mods');
    if (fs.existsSync(path.join(normalizedPath, 'SPT', 'SPT_Data'))) markerLayouts.push('SPT/user/mods');
    if (fs.existsSync(path.join(normalizedPath, 'Aki_Data'))) markerLayouts.push('user/mods');
    if (markerLayouts.length === 1) {
      evidenceLayout = markerLayouts[0];
    }
  }

  const isLayoutAmbiguous =
    populatedLayouts.length > 1 ||
    (!evidenceLayout && existingLayouts.length > 1);

  let serverModPath = 'SPT/user/mods';

  if (isLayoutAmbiguous && preferredServerModPath && existingLayouts.includes(preferredServerModPath)) {
    // Preserve user's configured path when layout is ambiguous
    serverModPath = preferredServerModPath;
  } else if (evidenceLayout) {
    serverModPath = evidenceLayout;
  } else if (preferredServerModPath && existingLayouts.includes(preferredServerModPath)) {
    serverModPath = preferredServerModPath;
  } else if (existingLayouts.length === 1) {
    serverModPath = existingLayouts[0];
  } else if (effectiveVersion) {
    if (effectiveVersion.startsWith('3.')) serverModPath = 'user/mods';
    else if (/^4\.0(\.|$)/.test(effectiveVersion)) serverModPath = 'SPT/user/mods';
    else if (/^4\.[1-9]/.test(effectiveVersion)) serverModPath = 'SPT_Runtime/user/mods';
  } else if (hasSpt40Structure) {
    serverModPath = 'SPT/user/mods';
  } else if (hasSptRuntimeStructure) {
    serverModPath = 'SPT_Runtime/user/mods';
  } else if (hasSpt3Structure) {
    serverModPath = 'user/mods';
  }

  const isSpt4xLayout = serverModPath !== 'user/mods';

  let layoutWarning = null;
  if (duplicateMods.length > 0) {
    const dupNames = duplicateMods.map((d) => `${d.name} (${d.layouts.join(' & ')})`).join(', ');
    layoutWarning = `Duplicate server mod folders detected across layouts: ${dupNames}. Using active layout "${serverModPath}".`;
  } else if (isLayoutAmbiguous) {
    const dirs = (populatedLayouts.length > 1 ? populatedLayouts : existingLayouts).join(', ');
    layoutWarning = `Multiple server mod directories exist on disk (${dirs}). Active layout set to "${serverModPath}".`;
  }

  const isValidSptRoot = Boolean(
    detectedServerBinary ||
      fs.existsSync(path.join(normalizedPath, 'EscapeFromTarkov.exe')) ||
      fs.existsSync(path.join(normalizedPath, 'BepInEx')) ||
      hasSptRuntimeStructure ||
      hasSpt40Structure ||
      hasSpt3Structure
  );

  return {
    normalizedPath,
    exists: true,
    isValidSptRoot,
    sptVersion: detectedVersion,
    detectedServerBinary:
      detectedServerBinary ||
      (fs.existsSync(path.join(normalizedPath, 'EscapeFromTarkov.exe')) ? 'EscapeFromTarkov.exe' : null),
    serverModPath,
    clientModPath: 'BepInEx/plugins',
    isSpt4xLayout,
    isLayoutAmbiguous,
    ambiguousLayouts: populatedLayouts.length > 1 ? populatedLayouts : existingLayouts,
    duplicateMods,
    layoutWarning,
  };
}

/**
 * Resolves proper SPT directory targets across SPT 3.x, 4.0, and 4.1+:
 * - Server mods: user/mods (3.x), SPT/user/mods (4.0), or SPT_Runtime/user/mods (4.1+)
 * - Client plugins: BepInEx/plugins (ALWAYS at root SPT)
 * - Client patchers: BepInEx/patchers (ALWAYS at root SPT)
 */
function resolveSptPaths(sptDirectory, sptVersion = '4.1.6', preferredServerModPath = null) {
  const normalizedRoot = normalizeSptRoot(sptDirectory);
  const inspected = inspectSptDirectory(normalizedRoot, {
    preferredSptVersion: sptVersion,
    preferredServerModPath,
  });

  const serverModsRelDir = inspected.serverModPath || 'SPT/user/mods';
  const serverModsDir = path.join(normalizedRoot, ...serverModsRelDir.split('/'));
  const hasSptRuntime = serverModsRelDir.startsWith('SPT_Runtime') || serverModsRelDir.startsWith('SPT/');
  const isV4 = String(sptVersion).startsWith('4') || hasSptRuntime;

  fs.mkdirSync(serverModsDir, { recursive: true });
  fs.mkdirSync(path.join(normalizedRoot, 'BepInEx', 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(normalizedRoot, 'BepInEx', 'patchers'), { recursive: true });

  // Clean up any accidental SPT_Runtime/BepInEx directory
  const accidentalSptRuntimeBepInEx = path.join(normalizedRoot, 'SPT_Runtime', 'BepInEx');
  if (fs.existsSync(accidentalSptRuntimeBepInEx)) {
    try {
      fs.cpSync(accidentalSptRuntimeBepInEx, path.join(normalizedRoot, 'BepInEx'), { recursive: true, force: true });
      fs.rmSync(accidentalSptRuntimeBepInEx, { recursive: true, force: true });
    } catch (e) {
      console.warn('Notice: Could not clean accidental SPT_Runtime/BepInEx:', e);
    }
  }

  return {
    serverModsDir,
    serverModsRelDir,
    hasSptRuntime,
    isV4,
    normalizedRoot,
    inspected,
  };
}

/**
 * Detects whether the target SPT directory uses SPT_Runtime/user/mods, SPT/user/mods, or user/mods.
 */
async function detectSptServerModsRelativePath(sptRoot, options = {}) {
  const inspected = inspectSptDirectory(sptRoot, options);
  return inspected.serverModPath || 'SPT/user/mods';
}

const IGNORED_DOTNET_GUID_PREFIXES = [
  'system.',
  'microsoft.',
  'unityengine.',
  'unity.',
  'bepinex.',
  'harmony.',
  'harmonylib.',
  '0harmony.',
  'mono.',
  'eft.',
  'bsg.',
  'comfort.',
  'diz.',
  'newtonsoft.',
  'cysharp.',
  'tmpro.',
  'sirenix.',
  'nlog.',
  'websocketsharp.',
  'acyclic.',
];

/**
 * Ultra-fast (<0.5ms) zero-dependency PE/CIL binary inspector for .dll files.
 * Extracts [BepInPlugin("GUID", "Name", "Version")] custom attribute metadata directly from
 * the .NET metadata stream and determines whether a DLL is a BepInEx Plugin or Preloader Patcher.
 */
async function inspectManagedDll(dllPath) {
  try {
    const buf = await fs.promises.readFile(dllPath);
    const asciiContent = buf.toString('latin1');

    const isBepInPlugin = asciiContent.includes('BaseUnityPlugin') || asciiContent.includes('BepInPlugin');
    const isPreloaderPatcher =
      !isBepInPlugin &&
      (asciiContent.includes('get_TargetDLLs') || (asciiContent.includes('Patcher') && asciiContent.includes('Mono.Cecil')));

    let inferredGuid = null;
    let pluginName = null;
    let pluginVersion = null;

    // 1. Parse .NET CustomAttribute blob for [BepInPlugin(string GUID, string Name, string Version)]
    // Serialized as: 0x01 0x00 [len1][guid_utf8][len2][name_utf8][len3][version_utf8]
    for (let i = 0; i < buf.length - 16; i++) {
      if (buf[i] === 0x01 && buf[i + 1] === 0x00) {
        const len1 = buf[i + 2];
        if (len1 >= 5 && len1 <= 90 && i + 3 + len1 < buf.length) {
          const pos2 = i + 3 + len1;
          const len2 = buf[pos2];
          if (len2 >= 2 && len2 <= 80 && pos2 + 1 + len2 < buf.length) {
            const pos3 = pos2 + 1 + len2;
            const len3 = buf[pos3];
            if (len3 >= 3 && len3 <= 24 && pos3 + 1 + len3 <= buf.length) {
              const verStr = buf.subarray(pos3 + 1, pos3 + 1 + len3).toString('utf8');
              if (/^\d+\.\d+(?:\.\d+)*(?:-[a-zA-Z0-9.]+)?$/.test(verStr)) {
                const guidStr = buf.subarray(i + 3, i + 3 + len1).toString('utf8');
                const nameStr = buf.subarray(pos2 + 1, pos2 + 1 + len2).toString('utf8');
                if (
                  /^[\w.-]+$/.test(guidStr) &&
                  (guidStr.includes('.') || guidStr.includes('-') || guidStr.includes('_')) &&
                  /^[\x20-\x7E]+$/.test(nameStr)
                ) {
                  const lowerGuid = guidStr.toLowerCase();
                  if (!IGNORED_DOTNET_GUID_PREFIXES.some((p) => lowerGuid.startsWith(p))) {
                    inferredGuid = lowerGuid;
                    pluginName = nameStr.trim();
                    pluginVersion = verStr.trim();
                    break;
                  }
                }
              }
            }
          }
        }
      }
    }

    // 2. Fallback: scan filtered GUID candidates if custom attribute was not matched
    if (!inferredGuid) {
      const guidRegex = /\b([a-z0-9]{2,}(?:\.[a-z0-9_-]{2,}){2,})\b/gi;
      let match;
      while ((match = guidRegex.exec(asciiContent)) !== null) {
        const cand = match[1].toLowerCase();
        if (
          !cand.endsWith('.dll') &&
          !cand.endsWith('.exe') &&
          !cand.endsWith('.json') &&
          !cand.endsWith('.cfg') &&
          !cand.endsWith('.cs') &&
          !IGNORED_DOTNET_GUID_PREFIXES.some((prefix) => cand.startsWith(prefix))
        ) {
          inferredGuid = cand;
          break;
        }
      }
    }

    // 3. Fallback version extraction from embedded semver strings if not found in BepInPlugin attribute
    if (!pluginVersion) {
      const verMatch = asciiContent.match(/\b(\d+\.\d+\.\d+(?:\.\d+)?)\b/);
      if (verMatch && verMatch[1] && verMatch[1] !== '0.0.0.0' && verMatch[1] !== '1.0.0.0') {
        pluginVersion = verMatch[1].replace(/\.0$/, '');
      }
    }

    return {
      role: isPreloaderPatcher ? 'patcher' : isBepInPlugin ? 'plugin' : 'unknown',
      inferredGuid,
      pluginName,
      pluginVersion,
    };
  } catch (err) {
    return { role: 'unknown', inferredGuid: null, pluginName: null, pluginVersion: null };
  }
}

/**
 * Rewrites extracted archive relative paths so SPT 3.x and SPT 4.x structures
 * route seamlessly regardless of how the mod author packaged the archive.
 */
async function normalizeAndRouteModEntry(sptRoot, extractedRelPath, absStagingFilePath) {
  const targetServerModsRel = await detectSptServerModsRelativePath(sptRoot);
  let cleanRel = extractedRelPath.replace(/\\/g, '/').replace(/^\/+/, '');

  // 1. Strip redundant top-level release wrapper folder if present
  // e.g., "SAIN-v3.2.0/BepInEx/plugins/..." -> "BepInEx/plugins/..."
  const knownRoots = ['bepinex/', 'spt_runtime/', 'spt/user/mods/', 'user/mods/'];
  const lowerRel = cleanRel.toLowerCase();
  for (const rootToken of knownRoots) {
    const idx = lowerRel.indexOf(rootToken);
    if (idx > 0) {
      cleanRel = cleanRel.slice(idx);
      break;
    }
  }

  // 2. Bidirectional Server Mod Path Rewrite (user/mods <-> SPT/user/mods <-> SPT_Runtime/user/mods)
  if (cleanRel.toLowerCase().startsWith('user/mods/')) {
    const subPath = cleanRel.slice('user/mods/'.length);
    return path.join(targetServerModsRel, subPath);
  }
  if (cleanRel.toLowerCase().startsWith('spt/user/mods/')) {
    const subPath = cleanRel.slice('spt/user/mods/'.length);
    return path.join(targetServerModsRel, subPath);
  }
  if (cleanRel.toLowerCase().startsWith('spt_runtime/user/mods/')) {
    const subPath = cleanRel.slice('spt_runtime/user/mods/'.length);
    return path.join(targetServerModsRel, subPath);
  }

  // 3. Loose top-level DLL routing (Plugin vs. Preloader Patcher)
  if (!cleanRel.includes('/') && cleanRel.toLowerCase().endsWith('.dll') && absStagingFilePath) {
    const { role } = await inspectManagedDll(absStagingFilePath);
    if (role === 'patcher') {
      return path.join('BepInEx/patchers', cleanRel);
    }
    return path.join('BepInEx/plugins', cleanRel);
  }

  return cleanRel;
}

/**
 * Delta File Purge for 1-Click Batch Mod Updater:
 * Removes deprecated .dll / .bundle files from the previous version of a mod
 * that no longer exist in the newly downloaded version, while preserving user configs.
 */
async function purgeDeprecatedModFiles(sptRoot, previousFileList = [], nextFileList = []) {
  const nextSet = new Set(nextFileList.map((f) => f.replace(/\\/g, '/').toLowerCase()));
  const removedFiles = [];

  for (const oldRelPath of previousFileList) {
    const normOld = oldRelPath.replace(/\\/g, '/').toLowerCase();
    // Never auto-purge user configuration files or saved state
    if (normOld.includes('/config/') || normOld.endsWith('.cfg') || normOld.endsWith('.json')) {
      continue;
    }

    if (!nextSet.has(normOld)) {
      const fullOldPath = path.join(sptRoot, oldRelPath);
      try {
        await fs.promises.unlink(fullOldPath);
        removedFiles.push(oldRelPath);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.warn(`[DeltaPurge] Could not remove deprecated file ${oldRelPath}:`, err.message);
        }
      }
    }
  }
  return removedFiles;
}

/**
 * Phase 3 NTFS Hardlink VFS & Configuration Merge Engine
 */

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return sha256Buffer(fs.readFileSync(filePath));
    }
  } catch (_) {}
  return null;
}

function isMutableConfigFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const ext = path.extname(normalized);
  if (
    [
      '.json',
      '.jsonc',
      '.cfg',
      '.ini',
      '.yaml',
      '.yml',
      '.xml',
      '.toml',
      '.txt',
      '.log',
      '.csv',
      '.db',
      '.sqlite',
    ].includes(ext)
  ) {
    return true;
  }
  if (/(\/|^)(config|configs|cfg|settings|saves|profiles|userdata|user_data)(\/|$)/i.test(normalized)) {
    return true;
  }
  return false;
}

function shouldDeepMergeConfigOnUpdate(filePath) {
  if (!isMutableConfigFile(filePath)) return false;
  const base = path.basename(filePath).toLowerCase();
  if (['package.json', 'package-lock.json', 'manifest.json', 'deps.json', 'tsconfig.json'].includes(base)) {
    return false;
  }
  const ext = path.extname(base);
  return ['.json', '.jsonc', '.cfg', '.ini'].includes(ext);
}

/**
 * Deep merges JSON configuration:
 * Strictly preserves existing user settings and custom values, while appending newly introduced keys from the mod update.
 */
function deepMergeJsonObjects(userObj, modObj) {
  if (typeof userObj !== 'object' || userObj === null || Array.isArray(userObj)) {
    return userObj !== undefined ? userObj : modObj;
  }
  if (typeof modObj !== 'object' || modObj === null || Array.isArray(modObj)) {
    return userObj !== undefined ? userObj : modObj;
  }

  const result = { ...userObj };
  for (const [key, modVal] of Object.entries(modObj)) {
    if (!(key in result)) {
      // New key introduced in updated version -> append it
      result[key] = modVal;
    } else if (
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key]) &&
      typeof modVal === 'object' &&
      modVal !== null &&
      !Array.isArray(modVal)
    ) {
      result[key] = deepMergeJsonObjects(result[key], modVal);
    }
    // Existing keys and values chosen by user are preserved without overwrite
  }
  return result;
}

/**
 * Deep merges INI / CFG format (e.g. BepInEx configs):
 * Preserves user key values under each [Section], while appending new sections and new keys from mod update.
 */
function deepMergeIniStrings(userIniStr, modIniStr) {
  if (!userIniStr) return modIniStr;
  if (!modIniStr) return userIniStr;

  function parseIni(content) {
    const lines = content.split(/\r?\n/);
    const sections = new Map();
    let currentSection = '__DEFAULT__';
    sections.set(currentSection, new Map());

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
        continue;
      }
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        currentSection = trimmed.slice(1, -1).trim();
        if (!sections.has(currentSection)) {
          sections.set(currentSection, new Map());
        }
      } else {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const k = trimmed.slice(0, eqIdx).trim();
          const v = trimmed.slice(eqIdx + 1).trim();
          sections.get(currentSection).set(k, { line: rawLine, value: v });
        }
      }
    }
    return { sections, rawLines: lines };
  }

  try {
    const userParsed = parseIni(userIniStr);
    const modParsed = parseIni(modIniStr);
    let mergedStr = userIniStr;

    for (const [modSec, modKeys] of modParsed.sections.entries()) {
      if (!userParsed.sections.has(modSec)) {
        mergedStr += `\n\n[${modSec}]\n`;
        for (const [, item] of modKeys.entries()) {
          mergedStr += `${item.line}\n`;
        }
      } else {
        const userKeys = userParsed.sections.get(modSec);
        let missingKeysStr = '';
        for (const [k, item] of modKeys.entries()) {
          if (!userKeys.has(k)) {
            missingKeysStr += `${item.line}\n`;
          }
        }
        if (missingKeysStr) {
          const secHeader = `[${modSec}]`;
          const secPos = mergedStr.indexOf(secHeader);
          if (secPos !== -1) {
            const nextSecPos = mergedStr.indexOf('\n[', secPos + secHeader.length);
            if (nextSecPos !== -1) {
              mergedStr = mergedStr.slice(0, nextSecPos) + `\n${missingKeysStr}` + mergedStr.slice(nextSecPos);
            } else {
              mergedStr += `\n${missingKeysStr}`;
            }
          }
        }
      }
    }
    return mergedStr;
  } catch (err) {
    console.warn('[Blacksite VFS] Failed parsing INI, preserving existing user config:', err.message);
    return userIniStr;
  }
}

/**
 * Metadata management for SHA-256 base hashes in .blacksite_library/_meta/<modId>.json
 */
function getModMetaFilePath(sptDirectory, cleanModId) {
  const metaDir = path.join(sptDirectory, '.blacksite_library', '_meta');
  try {
    fs.mkdirSync(metaDir, { recursive: true });
  } catch (_) {}
  return path.join(metaDir, `${cleanModId}.json`);
}

function loadModMeta(sptDirectory, cleanModId) {
  try {
    const p = getModMetaFilePath(sptDirectory, cleanModId);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (_) {}
  return { modId: cleanModId, baseHashes: {} };
}

function saveModMeta(sptDirectory, cleanModId, metaObj) {
  try {
    const p = getModMetaFilePath(sptDirectory, cleanModId);
    fs.writeFileSync(p, JSON.stringify(metaObj, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Blacksite VFS] Failed saving mod metadata:', e.message);
  }
}

/**
 * Transactional rollback journal: records all filesystem mutations and executes atomic rollback on error/EBUSY
 */
class VfsTransactionJournal {
  constructor(sptDirectory) {
    this.sptDirectory = sptDirectory;
    this.operations = [];
    this.committed = false;
  }

  recordMkdir(dirPath) {
    this.operations.push({ type: 'mkdir', target: dirPath });
  }

  recordLink(destPath, srcPath) {
    this.operations.push({ type: 'link', target: destPath, src: srcPath });
  }

  recordCopy(destPath, srcPath) {
    this.operations.push({ type: 'copy', target: destPath, src: srcPath });
  }

  recordBackup(destPath, backupPath) {
    this.operations.push({ type: 'backup', target: destPath, backup: backupPath });
  }

  async rollback() {
    if (this.committed) return;
    console.warn(`[Blacksite VFS] Rollback triggered! Reverting ${this.operations.length} filesystem mutations...`);
    for (let i = this.operations.length - 1; i >= 0; i--) {
      const op = this.operations[i];
      try {
        if (op.type === 'link' || op.type === 'copy') {
          if (fs.existsSync(op.target)) {
            await fs.promises.unlink(op.target);
          }
        } else if (op.type === 'backup') {
          if (fs.existsSync(op.backup)) {
            if (fs.existsSync(op.target)) {
              try {
                await fs.promises.unlink(op.target);
              } catch (_) {}
            }
            await fs.promises.rename(op.backup, op.target);
          }
        } else if (op.type === 'mkdir') {
          try {
            if (fs.existsSync(op.target)) {
              const entries = await fs.promises.readdir(op.target);
              if (entries.length === 0) {
                await fs.promises.rmdir(op.target);
              }
            }
          } catch (_) {}
        }
      } catch (err) {
        console.error(`[Blacksite VFS] Failed during rollback step ${op.type} for ${op.target}:`, err.message);
      }
    }
  }

  async commit() {
    this.committed = true;
    for (const op of this.operations) {
      if (op.type === 'backup' && op.backup && fs.existsSync(op.backup)) {
        try {
          await fs.promises.unlink(op.backup);
        } catch (_) {}
      }
    }
  }
}

/**
 * Intelligent SPT Routing Engine with NTFS Hardlink VFS, Transactional Rollback, and Semantic Config Merging.
 * Mutable config/data files are ALWAYS copied rather than hardlinked so editing installed configs
 * can never corrupt the immutable `.blacksite_library` store.
 */
async function routeExtractedModToSpt(
  extractedDir,
  sptDirectory,
  fallbackModName,
  sptVersion = '4.1.6',
  performanceMode = 'balanced',
  onProgress = null,
  cleanModIdentifier = null,
  preferredServerModPath = null
) {
  const { serverModsDir, serverModsRelDir } = resolveSptPaths(sptDirectory, sptVersion, preferredServerModPath);
  const targetClientPluginsDir = path.join(sptDirectory, 'BepInEx', 'plugins');
  const targetClientPatchersDir = path.join(sptDirectory, 'BepInEx', 'patchers');

  const cleanFallback = (fallbackModName || 'Mod').replace(/[^\w.-]/g, '');
  const activeModKey = cleanModIdentifier || cleanFallback;
  const modMeta = loadModMeta(sptDirectory, activeModKey);
  const journal = new VfsTransactionJournal(sptDirectory);

  let detectedServerPath = null;
  let detectedClientPath = null;
  const newlyDeployedFiles = [];

  const notifyRoute = (pct, msg) => {
    if (onProgress) {
      onProgress({
        stage: 'routing',
        percent: pct,
        downloadSpeed: msg,
      });
    }
  };

  /**
   * Deploys single file:
   * - Immutable binary/asset files use zero-copy NTFS hardlinks (with copy fallback across volumes)
   * - Mutable config and user data files ALWAYS use independent copies (and deep-merge on update)
   *   so user edits never mutate `.blacksite_library`.
   */
  async function deployFileWithHardlink(srcFile, destFile) {
    if (!fs.existsSync(srcFile)) return;
    assertSafeSptTarget(destFile, sptDirectory);

    const destDir = path.dirname(destFile);
    if (!fs.existsSync(destDir)) {
      await fs.promises.mkdir(destDir, { recursive: true });
      journal.recordMkdir(destDir);
    }

    const isMutable = isMutableConfigFile(destFile) || isMutableConfigFile(srcFile);
    const isMergeableConfig = shouldDeepMergeConfigOnUpdate(destFile);
    const relPathKey = path.relative(sptDirectory, destFile).replace(/\\/g, '/').toLowerCase();

    // If destination file exists: pre-flight test with atomic rename to catch EBUSY (game running)
    if (fs.existsSync(destFile)) {
      const rand = Math.random().toString(36).slice(2, 8);
      const backupPath = `${destFile}.bs_bak_${Date.now()}_${rand}`;
      try {
        await fs.promises.rename(destFile, backupPath);
        journal.recordBackup(destFile, backupPath);
      } catch (lockErr) {
        const err = new Error(
          `File lock collision on ${path.basename(destFile)} (${lockErr.code || 'EBUSY'}). SPT Tarkov or Server may be running. Please close the game and try again.`
        );
        err.code = lockErr.code || 'EBUSY';
        throw err;
      }

      if (isMergeableConfig) {
        try {
          const backupContent = await fs.promises.readFile(backupPath, 'utf8');
          const incomingContent = await fs.promises.readFile(srcFile, 'utf8');
          const currentHash = sha256Buffer(Buffer.from(backupContent));
          const baseHash = modMeta.baseHashes ? modMeta.baseHashes[relPathKey] : null;

          // If user customized settings, preserve user settings via deep merge
          if (baseHash && currentHash !== baseHash) {
            console.log(`[Blacksite VFS] Deep-merging mutable config: ${relPathKey} (preserving user settings)`);
            let mergedContent = incomingContent;
            const ext = path.extname(destFile).toLowerCase();

            if (ext === '.json' || ext === '.jsonc') {
              try {
                const cleanUser = backupContent.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '$1');
                const cleanIncoming = incomingContent.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '$1');
                const userObj = JSON.parse(cleanUser);
                const incomingObj = JSON.parse(cleanIncoming);
                const mergedObj = deepMergeJsonObjects(userObj, incomingObj);
                mergedContent = JSON.stringify(mergedObj, null, 2);
              } catch (jsonErr) {
                console.warn('[Blacksite VFS] JSON parse error during merge, keeping user settings:', jsonErr.message);
                mergedContent = backupContent;
              }
            } else if (ext === '.cfg' || ext === '.ini') {
              mergedContent = deepMergeIniStrings(backupContent, incomingContent);
            }

            await fs.promises.writeFile(destFile, mergedContent, 'utf8');
            journal.recordCopy(destFile, srcFile);
            if (!modMeta.baseHashes) modMeta.baseHashes = {};
            modMeta.baseHashes[relPathKey] = sha256Buffer(Buffer.from(incomingContent));
            newlyDeployedFiles.push(path.relative(sptDirectory, destFile).replace(/\\/g, '/'));
            return;
          }
        } catch (mergeReadErr) {
          console.warn('[Blacksite VFS] Non-fatal config inspection error, falling back to clean copy:', mergeReadErr.message);
        }
      }
    }

    if (isMutable) {
      // Mutable config/data files are ALWAYS copied so editing installed files never mutates .blacksite_library
      await fs.promises.copyFile(srcFile, destFile);
      journal.recordCopy(destFile, srcFile);
      if (isMergeableConfig) {
        if (!modMeta.baseHashes) modMeta.baseHashes = {};
        modMeta.baseHashes[relPathKey] = sha256File(srcFile);
      }
    } else {
      // Immutable binary/asset payload: deploy via zero-copy NTFS hardlink (fallback to copy across drives)
      try {
        await fs.promises.link(srcFile, destFile);
        journal.recordLink(destFile, srcFile);
      } catch (linkErr) {
        await fs.promises.copyFile(srcFile, destFile);
        journal.recordCopy(destFile, srcFile);
      }
    }

    newlyDeployedFiles.push(path.relative(sptDirectory, destFile).replace(/\\/g, '/'));
  }

  /**
   * Recursively mirrors directory structure and deploys files via hardlinks/copies
   */
  async function deployDirectoryWithHardlinks(srcDir, destDir) {
    if (!fs.existsSync(srcDir)) return;
    assertSafeSptTarget(destDir, sptDirectory);
    if (!fs.existsSync(destDir)) {
      await fs.promises.mkdir(destDir, { recursive: true });
      journal.recordMkdir(destDir);
    }

    const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });

    if (performanceMode === 'turbo') {
      const batchSize = 32;
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (entry) => {
            const sPath = path.join(srcDir, entry.name);
            const dPath = path.join(destDir, entry.name);
            if (entry.isDirectory()) {
              await deployDirectoryWithHardlinks(sPath, dPath);
            } else {
              await deployFileWithHardlink(sPath, dPath);
            }
          })
        );
      }
    } else {
      for (const entry of entries) {
        const sPath = path.join(srcDir, entry.name);
        const dPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
          await deployDirectoryWithHardlinks(sPath, dPath);
        } else {
          await deployFileWithHardlink(sPath, dPath);
        }
        await new Promise((r) => setImmediate(r));
      }
    }
  }

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

  try {
    // 1. Locate and route SERVER MODS
    notifyRoute(92, 'Deploying server mod via NTFS Hardlink VFS...');
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
            await deployDirectoryWithHardlinks(srcModDir, destModDir);
            if (!detectedServerPath) {
              detectedServerPath = `${serverModsRelDir}/${modFolderName}`;
            }
          }
        }
      }
    }

    // 1b. Check for standalone server mod with package.json anywhere in tree
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
          await deployDirectoryWithHardlinks(pDir, destModDir);
          if (!detectedServerPath) {
            detectedServerPath = `${serverModsRelDir}/${modFolderName}`;
          }
        } catch (err) {
          console.warn('Error reading package.json in mod:', err);
        }
      }
    }

    // 2. Locate and route CLIENT PLUGINS (BepInEx/plugins)
    notifyRoute(95, 'Linking BepInEx client plugins...');
    const pluginsDirs = findDirectoriesByName(extractedDir, 'plugins').filter((d) => {
      const parent = path.basename(path.dirname(d)).toLowerCase();
      return parent === 'bepinex';
    });

    if (pluginsDirs.length > 0) {
      for (const pDir of pluginsDirs) {
        await deployDirectoryWithHardlinks(pDir, targetClientPluginsDir);
        const entries = fs.readdirSync(pDir);
        if (entries.length > 0 && !detectedClientPath) {
          detectedClientPath = `BepInEx/plugins/${entries[0]}`;
        }
      }
    }

    // 3. Locate and route CLIENT PATCHERS (BepInEx/patchers)
    notifyRoute(97, 'Linking BepInEx client patchers...');
    const patchersDirs = findDirectoriesByName(extractedDir, 'patchers').filter((d) => {
      const parent = path.basename(path.dirname(d)).toLowerCase();
      return parent === 'bepinex';
    });

    if (patchersDirs.length > 0) {
      for (const pDir of patchersDirs) {
        await deployDirectoryWithHardlinks(pDir, targetClientPatchersDir);
        const entries = fs.readdirSync(pDir);
        if (entries.length > 0 && !detectedClientPath) {
          detectedClientPath = `BepInEx/patchers/${entries[0]}`;
        }
      }
    }

    // 4. Locate standalone client .dll plugins
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
          const { role } = await inspectManagedDll(dllPath);
          const isPatcher = role === 'patcher';
          const targetDir = isPatcher ? targetClientPatchersDir : targetClientPluginsDir;
          const destDll = path.join(targetDir, fileName);
          await deployFileWithHardlink(dllPath, destDll);
          if (!detectedClientPath) {
            detectedClientPath = isPatcher ? `BepInEx/patchers/${fileName}` : `BepInEx/plugins/${fileName}`;
          }
        }
      }
    }

    // Delta File Purge: Remove deprecated .dll/.bundle ghost files from previous versions of this mod
    if (modMeta.deployedFiles && Array.isArray(modMeta.deployedFiles) && modMeta.deployedFiles.length > 0) {
      try {
        const purged = await purgeDeprecatedModFiles(sptDirectory, modMeta.deployedFiles, newlyDeployedFiles);
        if (purged.length > 0) {
          console.log(`[Blacksite DeltaPurge] Purged ${purged.length} deprecated ghost files for ${activeModKey}:`, purged);
        }
      } catch (purgeErr) {
        console.warn(`[Blacksite DeltaPurge] Non-fatal delta purge warning:`, purgeErr.message);
      }
    }
    modMeta.deployedFiles = newlyDeployedFiles;

    // Commit transaction: unlink temporary backups and persist base metadata
    await journal.commit();
    saveModMeta(sptDirectory, activeModKey, modMeta);
    console.log(`[Blacksite VFS] Hardlink transaction committed successfully for ${activeModKey}`);
  } catch (txErr) {
    console.error(`[Blacksite VFS] Deployment transaction failed: ${txErr.message}. Executing rollback...`);
    await journal.rollback();
    throw txErr;
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
 * Validates a download URL or redirect target:
 * - Enforces HTTPS by default unless `allowInsecureHttp === true`.
 * - Rejects HTTPS -> HTTP protocol downgrades on redirect hops.
 */
function validateDownloadUrl(targetUrl, { allowInsecureHttp = false, previousUrl = null } = {}) {
  if (!targetUrl || typeof targetUrl !== 'string') {
    const err = new Error('Invalid download URL: URL must be a non-empty string.');
    err.code = 'ERR_INVALID_URL';
    throw err;
  }
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (e) {
    const err = new Error(`Malformed download URL "${targetUrl}": ${e.message}`);
    err.code = 'ERR_INVALID_URL';
    throw err;
  }

  if (previousUrl) {
    try {
      const prevParsed = new URL(previousUrl);
      if (prevParsed.protocol === 'https:' && parsed.protocol === 'http:') {
        const err = new Error(
          `Security Error: Blocked insecure redirect downgrade from HTTPS (${prevParsed.hostname}) to HTTP (${parsed.hostname}).`
        );
        err.code = 'ERR_HTTPS_DOWNGRADE';
        throw err;
      }
    } catch (downgradeErr) {
      if (downgradeErr.code === 'ERR_HTTPS_DOWNGRADE') throw downgradeErr;
    }
  }

  if (parsed.protocol !== 'https:') {
    if (parsed.protocol === 'http:' && allowInsecureHttp === true) {
      return parsed;
    }
    const err = new Error(
      `Security Error: Refusing to download over insecure protocol "${parsed.protocol}" (${parsed.hostname}). HTTPS is required unless insecure sources are explicitly enabled.`
    );
    err.code = 'ERR_INSECURE_PROTOCOL';
    throw err;
  }

  return parsed;
}

function isTlsCertificateError(err) {
  if (!err) return false;
  const code = String(err.code || err.cause?.code || '');
  const msg = String(err.message || err.cause?.message || '');
  return (
    code.startsWith('CERT_') ||
    code.startsWith('ERR_TLS_') ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'HOSTNAME_MISMATCH' ||
    /certificate|self[- ]signed|unable to verify|tls|ssl/i.test(msg)
  );
}

function formatTlsError(err, targetUrl) {
  let host = targetUrl;
  try {
    host = new URL(targetUrl).hostname;
  } catch (_) {}
  const rawCode = err?.code || err?.cause?.code || 'ERR_TLS_CERT_INVALID';
  const formatted = new Error(
    `TLS certificate validation failed for "${host}" (${rawCode}). The server presented an expired, self-signed, or mismatched SSL certificate. Connection was aborted to protect your installation.`
  );
  formatted.code = 'ERR_TLS_CERT_INVALID';
  formatted.originalCode = rawCode;
  return formatted;
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

function safeUnlinkPartialFile(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (_) {}
}

/**
 * Native Node.js HTTPS/HTTP streaming downloader with strict TLS verification,
 * redirect downgrade protection, streaming size limits, and partial file cleanup.
 */
function downloadViaNodeHttp(
  requestUrl,
  destFilePath,
  headers = {},
  onProgress = null,
  redirectDepth = 0,
  options = {}
) {
  const limits = resolveResourceLimits(options.resourceLimits || options);
  const allowInsecureHttp = Boolean(options.allowInsecureHttp);
  const signal = options.signal || null;

  return new Promise((resolve, reject) => {
    const failAndCleanup = (err) => {
      safeUnlinkPartialFile(destFilePath);
      reject(err);
    };

    if (signal?.aborted) {
      const abortErr = new Error('Download cancelled by user.');
      abortErr.code = 'ERR_DOWNLOAD_ABORTED';
      return failAndCleanup(abortErr);
    }

    if (redirectDepth > 10) {
      const redirErr = new Error('Too many HTTP redirects (exceeded 10 hops).');
      redirErr.code = 'ERR_TOO_MANY_REDIRECTS';
      return failAndCleanup(redirErr);
    }

    let parsed;
    try {
      parsed = validateDownloadUrl(requestUrl, {
        allowInsecureHttp,
        previousUrl: options.previousUrl || null,
      });
    } catch (urlErr) {
      return failAndCleanup(urlErr);
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
        rejectUnauthorized: true,
        keepAlive: true,
      });
    }

    const req = client.request(reqOptions, (res) => {
      // Follow 301, 302, 303, 307, 308 redirects with strict protocol validation
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const location = res.headers['location'];
        if (!location) {
          res.resume();
          return failAndCleanup(new Error(`HTTP ${res.statusCode} redirect without Location header.`));
        }
        res.resume();
        let nextUrl;
        try {
          nextUrl = new URL(location, requestUrl).toString();
          validateDownloadUrl(nextUrl, {
            allowInsecureHttp,
            previousUrl: requestUrl,
          });
        } catch (redirValidationErr) {
          return failAndCleanup(redirValidationErr);
        }

        return downloadViaNodeHttp(nextUrl, destFilePath, headers, onProgress, redirectDepth + 1, {
          ...options,
          previousUrl: requestUrl,
        })
          .then(resolve)
          .catch(failAndCleanup);
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        const httpErr = new Error(
          `Download failed with HTTP status ${res.statusCode}: ${
            res.statusMessage || (res.statusCode === 404 ? 'Not Found' : 'Download Error')
          }`
        );
        httpErr.statusCode = res.statusCode;
        if (res.statusCode === 404) httpErr.code = 'ERR_NOT_FOUND_404';
        return failAndCleanup(httpErr);
      }

      const contentType = res.headers['content-type'] || '';
      if (contentType.includes('text/html') && !requestUrl.includes('github') && !requestUrl.includes('codeberg')) {
        res.resume();
        const htmlErr = new Error('Download failed: remote host returned an HTML web page instead of a mod archive file.');
        htmlErr.statusCode = 404;
        htmlErr.code = 'ERR_NOT_FOUND_404';
        return failAndCleanup(htmlErr);
      }

      const contentLengthHeader = res.headers['content-length'];
      const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
      if (totalBytes > limits.maxDownloadBytes) {
        res.resume();
        const limitErr = new Error(
          `Download size (${(totalBytes / (1024 * 1024)).toFixed(1)} MB) exceeds maximum allowed limit (${(
            limits.maxDownloadBytes /
            (1024 * 1024)
          ).toFixed(1)} MB).`
        );
        limitErr.code = 'ERR_DOWNLOAD_LIMIT_EXCEEDED';
        return failAndCleanup(limitErr);
      }

      const fileStream = fs.createWriteStream(destFilePath);

      let receivedBytes = 0;
      let lastProgressTime = Date.now();
      let lastBytesInWindow = 0;
      let abortedOrFailed = false;

      const abortStreamWithError = (err) => {
        if (abortedOrFailed) return;
        abortedOrFailed = true;
        try {
          res.destroy();
        } catch (_) {}
        try {
          req.destroy();
        } catch (_) {}
        fileStream.destroy();
        fileStream.once('close', () => failAndCleanup(err));
        setImmediate(() => failAndCleanup(err));
      };

      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            const abortErr = new Error('Download cancelled by user.');
            abortErr.code = 'ERR_DOWNLOAD_ABORTED';
            abortStreamWithError(abortErr);
          },
          { once: true }
        );
      }

      res.on('data', (chunk) => {
        if (abortedOrFailed) return;
        receivedBytes += chunk.length;

        if (receivedBytes > limits.maxDownloadBytes) {
          const limitErr = new Error(
            `Download stream exceeded maximum allowed size (${(limits.maxDownloadBytes / (1024 * 1024)).toFixed(1)} MB).`
          );
          limitErr.code = 'ERR_DOWNLOAD_LIMIT_EXCEEDED';
          abortStreamWithError(limitErr);
          return;
        }

        const canContinue = fileStream.write(chunk);
        if (!canContinue) {
          res.pause();
          fileStream.once('drain', () => res.resume());
        }

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

      let isFinished = false;
      const finishDownload = () => {
        if (isFinished || abortedOrFailed) return;
        isFinished = true;
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
      };

      res.on('end', () => {
        if (!abortedOrFailed) {
          fileStream.end();
        }
      });

      fileStream.on('finish', () => {
        finishDownload();
      });

      fileStream.on('close', () => {
        finishDownload();
      });

      res.on('error', (err) => {
        abortStreamWithError(isTlsCertificateError(err) ? formatTlsError(err, requestUrl) : err);
      });

      fileStream.on('error', (err) => {
        abortStreamWithError(err);
      });
    });

    req.on('timeout', () => {
      const timeoutErr = new Error('Download connection timed out after 45 seconds.');
      timeoutErr.code = 'ETIMEDOUT';
      req.destroy(timeoutErr);
    });

    req.on('error', (err) => {
      failAndCleanup(isTlsCertificateError(err) ? formatTlsError(err, requestUrl) : err);
    });

    req.end();
  });
}

function isNonRetryableDownloadError(err) {
  if (!err) return false;
  const nonRetryableCodes = new Set([
    'ERR_TLS_CERT_INVALID',
    'ERR_HTTPS_DOWNGRADE',
    'ERR_INSECURE_PROTOCOL',
    'ERR_INVALID_URL',
    'ERR_DOWNLOAD_LIMIT_EXCEEDED',
    'ERR_DOWNLOAD_ABORTED',
    'ERR_NOT_FOUND_404',
  ]);
  return nonRetryableCodes.has(err.code) || err.statusCode === 404;
}

/**
 * Streams a remote file directly to disk with strict TLS verification, redirect protocol checks,
 * streaming size limits, and automatic partial file cleanup on error.
 */
async function streamDownloadToFile(initialUrl, destFilePath, onProgress, maxRetries = 3, options = {}) {
  const limits = resolveResourceLimits(options.resourceLimits || options);
  const allowInsecureHttp = Boolean(options.allowInsecureHttp);
  const signal = options.signal || null;

  // Validate initial URL up front before any network call
  validateDownloadUrl(initialUrl, { allowInsecureHttp });

  let attempt = 0;

  while (attempt <= maxRetries) {
    let currentUrl = initialUrl;
    try {
      if (signal?.aborted) {
        const abortErr = new Error('Download cancelled by user.');
        abortErr.code = 'ERR_DOWNLOAD_ABORTED';
        throw abortErr;
      }

      let redirects = 0;
      const maxRedirects = 10;
      let response = null;

      const fetchFn =
        typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function'
          ? globalThis.fetch
          : fetch;

      const strategy = attempt === 0 ? 'default' : attempt === 1 ? 'fallback_curl' : 'browser';

      while (redirects <= maxRedirects) {
        validateDownloadUrl(currentUrl, { allowInsecureHttp });
        const headers = getDownloadHeaders(currentUrl, strategy);

        try {
          response = await fetchFn(currentUrl, {
            headers,
            redirect: 'manual',
            signal,
          });
        } catch (fetchErr) {
          if (signal?.aborted || fetchErr.name === 'AbortError') {
            const abortErr = new Error('Download cancelled by user.');
            abortErr.code = 'ERR_DOWNLOAD_ABORTED';
            throw abortErr;
          }
          if (isTlsCertificateError(fetchErr)) {
            throw formatTlsError(fetchErr, currentUrl);
          }
          return await downloadViaNodeHttp(currentUrl, destFilePath, headers, onProgress, 0, {
            ...options,
            resourceLimits: limits,
            allowInsecureHttp,
            signal,
          });
        }

        // Explicitly handle HTTP 301, 302, 303, 307, 308 redirects with downgrade checks
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (!location) {
            throw new Error(`HTTP ${response.status} redirect without Location header.`);
          }
          const nextUrl = new URL(location, currentUrl).toString();
          validateDownloadUrl(nextUrl, {
            allowInsecureHttp,
            previousUrl: currentUrl,
          });
          currentUrl = nextUrl;
          redirects++;
          continue;
        }

        // If 403 Forbidden is encountered on this hop, immediately try with tool fallback
        if (response.status === 403 && strategy !== 'fallback_curl') {
          const fallbackHeaders = getDownloadHeaders(currentUrl, 'fallback_curl');
          try {
            response = await fetchFn(currentUrl, {
              headers: fallbackHeaders,
              redirect: 'manual',
              signal,
            });
          } catch (fetchErr) {
            if (isTlsCertificateError(fetchErr)) {
              throw formatTlsError(fetchErr, currentUrl);
            }
            return await downloadViaNodeHttp(currentUrl, destFilePath, fallbackHeaders, onProgress, 0, {
              ...options,
              resourceLimits: limits,
              allowInsecureHttp,
              signal,
            });
          }

          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            if (location) {
              const nextUrl = new URL(location, currentUrl).toString();
              validateDownloadUrl(nextUrl, {
                allowInsecureHttp,
                previousUrl: currentUrl,
              });
              currentUrl = nextUrl;
              redirects++;
              continue;
            }
          }
        }

        break;
      }

      if (redirects > maxRedirects) {
        const redirErr = new Error('Too many HTTP redirects (exceeded 10 hops).');
        redirErr.code = 'ERR_TOO_MANY_REDIRECTS';
        throw redirErr;
      }

      if (!response.ok) {
        if (response.status === 404 && currentUrl.includes('files.sp-mod.com/mods/')) {
          const modIdMatch = currentUrl.match(/mods\/(\d+)\.zip/);
          if (modIdMatch && modIdMatch[1]) {
            const fallbackForgeUrl = `https://sp-mod.com/mod/download/${modIdMatch[1]}`;
            try {
              return await streamDownloadToFile(fallbackForgeUrl, destFilePath, onProgress, 1, options);
            } catch (_) {
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
      if (totalBytes > limits.maxDownloadBytes) {
        const limitErr = new Error(
          `Download size (${(totalBytes / (1024 * 1024)).toFixed(1)} MB) exceeds maximum allowed limit (${(
            limits.maxDownloadBytes /
            (1024 * 1024)
          ).toFixed(1)} MB).`
        );
        limitErr.code = 'ERR_DOWNLOAD_LIMIT_EXCEEDED';
        throw limitErr;
      }

      const fileStream = fs.createWriteStream(destFilePath);
      const readable = Readable.fromWeb(response.body);

      let receivedBytes = 0;
      let lastProgressTime = Date.now();
      let lastBytesInWindow = 0;
      let downloadSpeed = 'Calculating...';
      let abortedOrFailed = false;

      await new Promise((resolve, reject) => {
        const failStream = (err) => {
          if (abortedOrFailed) return;
          abortedOrFailed = true;
          try {
            readable.destroy();
          } catch (_) {}
          fileStream.destroy();
          safeUnlinkPartialFile(destFilePath);
          reject(err);
        };

        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              const abortErr = new Error('Download cancelled by user.');
              abortErr.code = 'ERR_DOWNLOAD_ABORTED';
              failStream(abortErr);
            },
            { once: true }
          );
        }

        readable.on('data', (chunk) => {
          if (abortedOrFailed) return;
          receivedBytes += chunk.length;

          if (receivedBytes > limits.maxDownloadBytes) {
            const limitErr = new Error(
              `Download stream exceeded maximum allowed size (${(limits.maxDownloadBytes / (1024 * 1024)).toFixed(1)} MB).`
            );
            limitErr.code = 'ERR_DOWNLOAD_LIMIT_EXCEEDED';
            failStream(limitErr);
            return;
          }

          const canContinue = fileStream.write(chunk);
          if (!canContinue) {
            readable.pause();
            fileStream.once('drain', () => readable.resume());
          }

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

        let isFinished = false;
        const finishDownload = () => {
          if (isFinished || abortedOrFailed) return;
          isFinished = true;
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
        };

        readable.on('end', () => {
          if (!abortedOrFailed) {
            fileStream.end();
          }
        });

        fileStream.on('finish', () => {
          finishDownload();
        });

        fileStream.on('close', () => {
          finishDownload();
        });

        readable.on('error', (err) => {
          failStream(err);
        });

        fileStream.on('error', (err) => {
          failStream(err);
        });
      });

      return { totalBytes: totalBytes || receivedBytes };
    } catch (err) {
      safeUnlinkPartialFile(destFilePath);

      if (isTlsCertificateError(err) && err.code !== 'ERR_TLS_CERT_INVALID') {
        err = formatTlsError(err, currentUrl);
      }

      if (isNonRetryableDownloadError(err)) {
        throw err;
      }

      attempt++;
      if (attempt > maxRetries) {
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
 * Downloads and installs a mod with isolated staging extraction, VFS hardlink/copy deployment, and SPT 3.x/4.0/4.1+ routing
 */
async function installMod({
  queueId,
  sptDirectory,
  sptVersion = '4.1.6',
  preferredServerModPath = null,
  modName,
  author,
  version,
  downloadUrl,
  archiveBase64,
  archiveFileName,
  performanceMode = 'balanced',
  allowInsecureHttp = false,
  resourceLimits = {},
  signal = null,
  onProgress,
}) {
  if (!sptDirectory || typeof sptDirectory !== 'string') {
    throw new Error('Valid SPT root directory is required.');
  }

  const limits = resolveResourceLimits(resourceLimits);

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
  const tempArchiveFile = path.join(tempWorkDir, path.basename(archiveFileName || 'mod-download.archive'));
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

      await streamDownloadToFile(downloadUrl, tempArchiveFile, onProgress, 3, {
        allowInsecureHttp,
        resourceLimits: limits,
        signal,
      });
    } else if (archiveBase64) {
      console.log(`[Blacksite Installer] Writing local archive buffer to disk...`);
      const buf = Buffer.from(archiveBase64, 'base64');
      if (buf.length > limits.maxDownloadBytes) {
        const limitErr = new Error(
          `Archive size (${(buf.length / (1024 * 1024)).toFixed(1)} MB) exceeds maximum allowed limit (${(
            limits.maxDownloadBytes /
            (1024 * 1024)
          ).toFixed(1)} MB).`
        );
        limitErr.code = 'ERR_DOWNLOAD_LIMIT_EXCEEDED';
        throw limitErr;
      }
      fs.writeFileSync(tempArchiveFile, buf);
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
      const { role, inferredGuid } = await inspectManagedDll(tempArchiveFile);
      const isPatcher = role === 'patcher';
      const targetSubdir = isPatcher ? path.join('BepInEx', 'patchers') : path.join('BepInEx', 'plugins');
      const targetDir = path.join(sptDirectory, targetSubdir);
      fs.mkdirSync(targetDir, { recursive: true });

      const cleanDllName =
        archiveFileName && archiveFileName.toLowerCase().endsWith('.dll')
          ? path.basename(archiveFileName)
          : `${(modName || 'Plugin').replace(/[^\w.-]/g, '')}.dll`;

      const destDllPath = path.join(targetDir, cleanDllName);
      assertSafeSptTarget(destDllPath, sptDirectory);
      fs.copyFileSync(tempArchiveFile, destDllPath);

      if (onProgress) {
        onProgress({
          stage: 'installed',
          percent: 100,
          downloadSpeed: 'Complete',
        });
      }

      const clientRelPath = `${targetSubdir.replace(/\\/g, '/')}/${cleanDllName}`;
      const routeResult = {
        success: true,
        serverPath: null,
        clientPath: clientRelPath,
        kind: 'Client',
        inferredGuid: inferredGuid || undefined,
        role,
      };
      console.log(`[Blacksite Installer] Standalone DLL placed into ${targetSubdir} (${role}):`, routeResult);
      return routeResult;
    }

    // 1. Extract into isolated staging directory FIRST (`tempExtractDir`)
    console.log(`[Blacksite Installer] Extracting archive into isolated staging (Performance mode: ${performanceMode})...`);
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

    await extractArchive(finalArchiveFile, tempExtractDir, performanceMode, onProgress, limits);

    // 2. Promote verified staging tree into `.blacksite_library/<modId>_<version>/extracted`
    const cleanModId = (modName || 'mod').replace(/[^\w.-]/g, '_');
    const cleanVer = (version || '1.0.0').replace(/[^\w.-]/g, '_');
    const cleanModIdentifier = `${cleanModId}_${cleanVer}`;
    const libraryDepotDir = path.join(sptDirectory, '.blacksite_library', cleanModIdentifier);
    let sourceDeployDir = tempExtractDir;
    try {
      const targetLibraryExtractDir = path.join(libraryDepotDir, 'extracted');
      if (fs.existsSync(targetLibraryExtractDir)) {
        fs.rmSync(targetLibraryExtractDir, { recursive: true, force: true });
      }
      fs.mkdirSync(libraryDepotDir, { recursive: true });
      fs.cpSync(tempExtractDir, targetLibraryExtractDir, { recursive: true, force: true });
      sourceDeployDir = targetLibraryExtractDir;
    } catch (depotErr) {
      console.warn('[Blacksite Installer] Library promotion fallback to staging dir:', depotErr.message);
      sourceDeployDir = tempExtractDir;
    }

    // 3. Routing stage via NTFS Hardlink VFS (mutable configs copied, immutable binaries hardlinked)
    console.log(`[Blacksite Installer] Deploying files via NTFS Hardlink VFS into SPT: ${sptDirectory}...`);
    if (onProgress) {
      onProgress({
        stage: 'routing',
        percent: 90,
        downloadSpeed: 'Zero-copy NTFS hardlink deployment...',
      });
    }
    const routeResult = await routeExtractedModToSpt(
      sourceDeployDir,
      sptDirectory,
      modName,
      sptVersion,
      performanceMode,
      onProgress,
      cleanModIdentifier,
      preferredServerModPath
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

// PROTECTED_CORE_ITEMS, FORBIDDEN_SPT_CORE_PATHS, and isProtectedCoreItem are declared above

/**
 * Permanently removes mod files from SPT/user/mods, SPT_Runtime/user/mods, user/mods,
 * BepInEx/plugins, and BepInEx/patchers with core SPT file safeguards and detailed reporting.
 */
async function uninstallMod({ sptDirectory, serverPath, clientPath, modName, clientPaths }) {
  if (!sptDirectory) return { success: false, error: 'SPT Directory not set' };
  const normalizedRoot = normalizeSptRoot(sptDirectory);

  const deletedPaths = [];
  const skippedProtected = [];
  const failedRemovals = [];

  const deletePath = (relOrAbs) => {
    if (!relOrAbs || typeof relOrAbs !== 'string') return;
    const full = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(normalizedRoot, relOrAbs);
    const relLabel = path.relative(normalizedRoot, full).replace(/\\/g, '/');

    try {
      assertSafeSptTarget(full, normalizedRoot);
    } catch (err) {
      console.warn(`[Blacksite Uninstall] Skipped deletion of protected/invalid target: ${full}`, err.message);
      skippedProtected.push(relLabel);
      return;
    }

    const basename = path.basename(full).replace(/\.disabled$/i, '');
    if (isProtectedCoreItem(basename) || isProtectedCoreItem(full)) {
      skippedProtected.push(relLabel);
      return;
    }

    const candidates = [full, full.endsWith('.disabled') ? full.slice(0, -9) : `${full}.disabled`];
    for (const target of new Set(candidates)) {
      if (fs.existsSync(target)) {
        try {
          fs.rmSync(target, { recursive: true, force: true });
          deletedPaths.push(path.relative(normalizedRoot, target).replace(/\\/g, '/'));
        } catch (err) {
          console.warn(`Failed removing ${target}:`, err.message);
          failedRemovals.push({
            path: path.relative(normalizedRoot, target).replace(/\\/g, '/'),
            error: err.message,
          });
        }
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

  // Fallback cleanup by modName across all supported server & client layouts
  if (modName && typeof modName === 'string') {
    const cleanModName = modName.trim();
    if (
      cleanModName &&
      !cleanModName.includes('/') &&
      !cleanModName.includes('\\') &&
      cleanModName !== '.' &&
      cleanModName !== '..' &&
      !isProtectedCoreItem(cleanModName)
    ) {
      const candidatePaths = [
        path.join(normalizedRoot, 'SPT', 'user', 'mods', cleanModName),
        path.join(normalizedRoot, 'SPT_Runtime', 'user', 'mods', cleanModName),
        path.join(normalizedRoot, 'user', 'mods', cleanModName),
        path.join(normalizedRoot, 'BepInEx', 'plugins', cleanModName),
        path.join(normalizedRoot, 'BepInEx', 'plugins', `${cleanModName}.dll`),
        path.join(normalizedRoot, 'BepInEx', 'patchers', cleanModName),
        path.join(normalizedRoot, 'BepInEx', 'patchers', `${cleanModName}.dll`),
      ];
      for (const cand of candidatePaths) {
        deletePath(cand);
      }
    }
  }

  return {
    success: failedRemovals.length === 0,
    deletedCount: deletedPaths.length,
    deletedPaths,
    skippedProtected,
    failedRemovals,
    ...(failedRemovals.length > 0
      ? { error: `Failed to remove ${failedRemovals.length} item(s): ${failedRemovals[0].error}` }
      : {}),
  };
}

/**
 * Deep purges all user mods from SPT/user/mods, SPT_Runtime/user/mods, user/mods,
 * BepInEx/plugins, and BepInEx/patchers.
 * Strictly safeguards SPT core system files (e.g. BepInEx/plugins/spt/) and reports skipped/failed items.
 */
async function uninstallAllMods({ sptDirectory }) {
  const normalizedRoot = normalizeSptRoot(sptDirectory);
  if (!normalizedRoot || !fs.existsSync(normalizedRoot)) {
    return { success: false, error: 'SPT Directory not set or does not exist' };
  }

  let deletedCount = 0;
  const deletedPaths = [];
  const skippedProtected = [];
  const failedRemovals = [];

  const removeEntrySafely = (targetPath) => {
    const relLabel = path.relative(normalizedRoot, targetPath).replace(/\\/g, '/');
    const cleanName = path.basename(targetPath).replace(/\.disabled$/i, '');

    if (isProtectedCoreItem(cleanName) || isProtectedCoreItem(targetPath)) {
      console.log(`[Blacksite Purge] Safeguarding core SPT item: ${relLabel}`);
      skippedProtected.push(relLabel);
      return;
    }

    try {
      assertSafeSptTarget(targetPath, normalizedRoot);
    } catch (safeErr) {
      skippedProtected.push(relLabel);
      return;
    }

    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      deletedCount++;
      deletedPaths.push(relLabel);
    } catch (err) {
      console.warn(`[Blacksite Purge] Failed removing ${relLabel}:`, err.message);
      failedRemovals.push({ path: relLabel, error: err.message });
    }
  };

  // 1. Clear server mods across all supported SPT layouts (4.0 SPT/user/mods, 4.1+ SPT_Runtime/user/mods, 3.x user/mods)
  const candidateUserDirs = [
    path.join(normalizedRoot, 'SPT', 'user', 'mods'),
    path.join(normalizedRoot, 'SPT_Runtime', 'user', 'mods'),
    path.join(normalizedRoot, 'user', 'mods'),
  ];

  for (const userModsDir of candidateUserDirs) {
    if (fs.existsSync(userModsDir)) {
      try {
        const entries = fs.readdirSync(userModsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            removeEntrySafely(path.join(userModsDir, entry.name));
          }
        }
      } catch (err) {
        console.warn('Error reading user mods dir:', err.message);
      }
    }
  }

  // 2. Clear client plugins (excluding protected SPT core files like 'spt' folder)
  const pluginsDir = path.join(normalizedRoot, 'BepInEx', 'plugins');
  if (fs.existsSync(pluginsDir)) {
    try {
      const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        removeEntrySafely(path.join(pluginsDir, entry.name));
      }
    } catch (err) {
      console.warn('Error clearing plugins dir:', err.message);
    }
  }

  // 3. Clear non-core client patchers if any
  const patchersDir = path.join(normalizedRoot, 'BepInEx', 'patchers');
  if (fs.existsSync(patchersDir)) {
    try {
      const entries = fs.readdirSync(patchersDir, { withFileTypes: true });
      for (const entry of entries) {
        removeEntrySafely(path.join(patchersDir, entry.name));
      }
    } catch (err) {
      console.warn('Error clearing patchers dir:', err.message);
    }
  }

  console.log(`[Blacksite Purge] Uninstalled mods complete (${deletedCount} removed, ${skippedProtected.length} protected, ${failedRemovals.length} failed).`);
  return {
    success: failedRemovals.length === 0,
    deletedCount,
    deletedPaths,
    skippedProtected,
    failedRemovals,
    ...(failedRemovals.length > 0
      ? { error: `Failed to remove ${failedRemovals.length} item(s): ${failedRemovals[0].error}` }
      : {}),
  };
}

/**
 * Toggles mod between enabled and disabled by appending or removing .disabled extension
 */
async function toggleModDisable({ sptDirectory, serverPath, clientPath, clientPaths = [], disable }) {
  if (!sptDirectory) return { success: false, error: 'SPT Directory not set' };

  function handlePath(targetPath) {
    if (!targetPath) return null;
    const full = path.isAbsolute(targetPath) ? targetPath : path.join(sptDirectory, targetPath);
    const basename = path.basename(full);
    if (isProtectedCoreItem(basename)) return targetPath;

    const disabledFull = full.endsWith('.disabled') ? full : `${full}.disabled`;
    const enabledFull = full.endsWith('.disabled') ? full.slice(0, -9) : full;

    if (disable) {
      if (fs.existsSync(enabledFull) && !fs.existsSync(disabledFull)) {
        try {
          fs.renameSync(enabledFull, disabledFull);
        } catch (e) {
          console.warn('[toggleModDisable] Failed renaming to disabled:', e.message);
        }
      }
      return path.relative(sptDirectory, disabledFull).replace(/\\/g, '/');
    } else {
      if (fs.existsSync(disabledFull) && !fs.existsSync(enabledFull)) {
        try {
          fs.renameSync(disabledFull, enabledFull);
        } catch (e) {
          console.warn('[toggleModDisable] Failed renaming to enabled:', e.message);
        }
      }
      return path.relative(sptDirectory, enabledFull).replace(/\\/g, '/');
    }
  }

  const updatedServerPath = serverPath ? handlePath(serverPath) : serverPath;
  const updatedClientPath = clientPath ? handlePath(clientPath) : clientPath;

  // Process and deduplicate all clientPaths
  const candidateClientPaths = Array.isArray(clientPaths) ? [...clientPaths] : [];
  if (clientPath && !candidateClientPaths.includes(clientPath)) {
    candidateClientPaths.push(clientPath);
  }

  const updatedClientPaths = [];
  for (const cp of candidateClientPaths) {
    if (cp) {
      const updated = handlePath(cp);
      if (updated && !updatedClientPaths.includes(updated)) {
        updatedClientPaths.push(updated);
      }
    }
  }

  return {
    success: true,
    serverPath: updatedServerPath,
    clientPath: updatedClientPath,
    clientPaths: updatedClientPaths,
  };
}

/**
 * Helper: Normalizes a mod or folder name for fuzzy Server <-> Client pairing
 * e.g. "DrakiaXYZ-Waypoints-1.5.2" -> "waypoints", "SVM" -> "svm"
 */
function normalizeModMatchKey(str) {
  if (!str || typeof str !== 'string') return '';
  let s = str
    .toLowerCase()
    .replace(/\.disabled$/i, '')
    .replace(/\.(dll|zip|7z|rar)$/i, '')
    .replace(/[-_.]v?\d+\.\d+(?:\.\d+)*.*$/i, '')
    .trim();
  // If formatted like "Author-ModName", extract both full and suffix
  if (s.includes('-')) {
    const parts = s.split('-').filter(Boolean);
    if (parts.length >= 2) {
      s = parts.slice(1).join('');
    }
  }
  return s.replace(/[^a-z0-9]/g, '');
}

/**
 * Helper: Extracts human-readable author from package.json author field, folder prefix, or GUID
 */
function resolveModAuthor(pkgData, folderOrFileName, inferredGuid) {
  if (pkgData) {
    if (typeof pkgData.author === 'string' && pkgData.author.trim()) {
      return pkgData.author.trim();
    }
    if (pkgData.author && typeof pkgData.author === 'object' && pkgData.author.name) {
      return String(pkgData.author.name).trim();
    }
    if (Array.isArray(pkgData.authors) && pkgData.authors.length > 0) {
      const first = pkgData.authors[0];
      return typeof first === 'string' ? first : first?.name || 'Community Author';
    }
  }

  const clean = String(folderOrFileName || '')
    .replace(/\.disabled$/i, '')
    .replace(/\.dll$/i, '');
  if (clean.includes('-')) {
    const prefix = clean.split('-')[0].trim();
    if (prefix.length >= 2 && !/^(spt|aki|mod|v\d+)/i.test(prefix)) {
      return prefix;
    }
  }

  if (inferredGuid && inferredGuid.includes('.')) {
    const parts = inferredGuid.split('.');
    if (parts.length >= 3 && !['com', 'net', 'org', 'me', 'xyz', 'dev', 'io', 'spt', 'eft', 'bepinex'].includes(parts[1])) {
      return parts[1];
    }
  }

  return 'Community Author';
}

/**
 * Helper: Non-blocking async reader for editable config files (.json, .jsonc, .cfg, .ini) inside a mod folder
 */
async function discoverConfigFilesInDir(baseDir, sptRoot, maxFiles = 12) {
  const configs = [];
  if (!baseDir || !fs.existsSync(baseDir)) return configs;

  const candidateDirs = [
    path.join(baseDir, 'config'),
    path.join(baseDir, 'configs'),
    path.join(baseDir, 'cfg'),
    baseDir,
  ];

  const seenPaths = new Set();
  const skipNames = new Set(['package.json', 'package-lock.json', 'tsconfig.json', 'manifest.json', 'deps.json']);

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (configs.length >= maxFiles) break;
        if (!entry.isFile()) continue;
        const lower = entry.name.toLowerCase();
        if (skipNames.has(lower)) continue;
        const ext = path.extname(lower);
        if (!['.json', '.jsonc', '.cfg', '.ini'].includes(ext)) continue;
        // In root mod dir, only pick explicit .cfg/.ini or files with config in name
        if (dir === baseDir && (ext === '.json' || ext === '.jsonc') && !lower.includes('config') && !lower.includes('settings')) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);
        if (seenPaths.has(fullPath)) continue;
        seenPaths.add(fullPath);

        try {
          const stat = await fs.promises.stat(fullPath);
          if (stat.size > 0 && stat.size <= 256 * 1024) {
            const content = await fs.promises.readFile(fullPath, 'utf8');
            const relPath = path.relative(sptRoot, fullPath).replace(/\\/g, '/');
            configs.push({
              id: `cfg-${relPath}`,
              name: entry.name,
              relativePath: relPath,
              format: ext === '.cfg' || ext === '.ini' ? 'ini' : 'json',
              content,
            });
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  return configs;
}

/**
 * Deeply scans SPT/user/mods, SPT_Runtime/user/mods, user/mods, BepInEx/plugins,
 * BepInEx/patchers, and BepInEx/config for all installed mods on disk using non-blocking async I/O.
 * Prioritizes the active detected SPT layout first and records `duplicateLocations` when a mod
 * folder exists across multiple layout variants.
 */
async function scanInstalledMods({ sptDirectory, preferredServerModPath = null } = {}) {
  const normalizedRoot = normalizeSptRoot(sptDirectory);
  if (!normalizedRoot || !fs.existsSync(normalizedRoot)) {
    return [];
  }

  const dirInfo = inspectSptDirectory(normalizedRoot, { preferredServerModPath });
  const defaultSptVer = dirInfo.sptVersion || (dirInfo.isSpt4xLayout ? '4.x' : '3.x');
  const activeServerRel = dirInfo.serverModPath || 'SPT/user/mods';

  const results = [];
  const usedIds = new Set();
  const ensureUniqueId = (preferredId, fallbackPrefix, fallbackName) => {
    let cand = (preferredId || `${fallbackPrefix}.${fallbackName}`).toLowerCase().trim();
    if (!usedIds.has(cand)) {
      usedIds.add(cand);
      return cand;
    }
    cand = `${fallbackPrefix}.${fallbackName.toLowerCase().replace(/[^a-z0-9._-]/g, '')}`;
    if (!usedIds.has(cand)) {
      usedIds.add(cand);
      return cand;
    }
    let idx = 2;
    while (usedIds.has(`${cand}.${idx}`)) idx++;
    const finalId = `${cand}.${idx}`;
    usedIds.add(finalId);
    return finalId;
  };

  const allLayoutCandidates = [
    { dir: path.join(normalizedRoot, 'SPT', 'user', 'mods'), rel: 'SPT/user/mods', sptVer: defaultSptVer },
    { dir: path.join(normalizedRoot, 'SPT_Runtime', 'user', 'mods'), rel: 'SPT_Runtime/user/mods', sptVer: defaultSptVer },
    { dir: path.join(normalizedRoot, 'user', 'mods'), rel: 'user/mods', sptVer: defaultSptVer },
  ];

  // Order candidate layouts so the active detected/configured layout is always scanned first
  const candidateUserDirs = [
    ...allLayoutCandidates.filter((c) => c.rel === activeServerRel),
    ...allLayoutCandidates.filter((c) => c.rel !== activeServerRel),
  ];

  const pluginsDir = path.join(normalizedRoot, 'BepInEx', 'plugins');

  // Map duplicate server mod folders across layouts so none are silently hidden
  const duplicateMap = new Map();
  for (const dup of dirInfo.duplicateMods || []) {
    duplicateMap.set(dup.name.toLowerCase(), dup.locations);
  }

  // 1. Scan server mods across all supported SPT layouts (active layout prioritized)
  const scannedServerFolders = new Map();
  for (const { dir: userModsDir, rel: relPrefix, sptVer } of candidateUserDirs) {
    if (!fs.existsSync(userModsDir)) continue;
    let entries = [];
    try {
      entries = await fs.promises.readdir(userModsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folderName = entry.name;
      const isDisabled = folderName.toLowerCase().endsWith('.disabled');
      const cleanFolderName = isDisabled ? folderName.slice(0, -9) : folderName;
      const lowerClean = cleanFolderName.toLowerCase();

      if (isProtectedCoreItem(cleanFolderName)) continue;
      if (scannedServerFolders.has(lowerClean)) {
        const existingMod = scannedServerFolders.get(lowerClean);
        const dupLoc = `${relPrefix}/${folderName}`;
        if (!Array.isArray(existingMod.duplicateLocations)) {
          existingMod.duplicateLocations = [existingMod.serverPath];
        }
        if (!existingMod.duplicateLocations.includes(dupLoc)) {
          existingMod.duplicateLocations.push(dupLoc);
        }
        continue;
      }

      const fullDir = path.join(userModsDir, folderName);
      let pkgJsonPath = path.join(fullDir, 'package.json');

      // Check 1 level deeper if package.json is nested inside a wrapper folder
      if (!fs.existsSync(pkgJsonPath)) {
        try {
          const subEntries = await fs.promises.readdir(fullDir, { withFileTypes: true });
          const subDirs = subEntries.filter((d) => d.isDirectory());
          if (subDirs.length === 1) {
            const nestedPkg = path.join(fullDir, subDirs[0].name, 'package.json');
            if (fs.existsSync(nestedPkg)) pkgJsonPath = nestedPkg;
          }
        } catch (_) {}
      }

      let modName = cleanFolderName;
      let author = resolveModAuthor(null, cleanFolderName, null);
      let version = '1.0.0';
      let modGuid = null;
      let modSptVersion = sptVer;
      let teaser = undefined;
      let dependencies = [];

      if (fs.existsSync(pkgJsonPath)) {
        try {
          const rawPkg = (await fs.promises.readFile(pkgJsonPath, 'utf8')).replace(/^\uFEFF/, '');
          const data = JSON.parse(rawPkg);
          if (data.name && typeof data.name === 'string') modName = data.name.trim();
          author = resolveModAuthor(data, cleanFolderName, data.guid || data.id);
          if (data.version && typeof data.version === 'string') version = data.version.trim();
          if (data.sptVersion || data.akiVersion) {
            modSptVersion = String(data.sptVersion || data.akiVersion).trim();
          }
          if (data.guid && typeof data.guid === 'string') {
            modGuid = data.guid.toLowerCase().trim();
          } else if (data.author && data.name && typeof data.author === 'string') {
            modGuid = `com.${data.author.toLowerCase().replace(/[^a-z0-9]/g, '')}.${data.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
          }
          if (data.description && typeof data.description === 'string') {
            teaser = data.description.trim();
          }
          if (data.modDependencies && typeof data.modDependencies === 'object') {
            dependencies = Object.keys(data.modDependencies);
          }
        } catch (_) {}
      }

      let installDate = new Date().toISOString().split('T')[0];
      try {
        const stat = await fs.promises.stat(fullDir);
        if (stat.mtime) installDate = stat.mtime.toISOString().split('T')[0];
      } catch (_) {}

      const configFiles = await discoverConfigFilesInDir(fullDir, normalizedRoot);
      const uniqueId = ensureUniqueId(modGuid, 'disk.server', cleanFolderName);
      const dupLocations = duplicateMap.get(lowerClean);

      const serverModEntry = {
        id: uniqueId,
        name: modName,
        author,
        version,
        kind: 'Server',
        sptVersion: modSptVersion,
        fikaCompatibility: true,
        installDate,
        serverPath: `${relPrefix}/${folderName}`,
        ...(dupLocations && dupLocations.length > 1
          ? { duplicateLocations: dupLocations.map((loc) => `${loc}/${folderName}`) }
          : {}),
        isDisabled,
        hasUpdate: false,
        latestVersion: version,
        teaser,
        inferredGuid: modGuid || undefined,
        dependencies,
        configFiles,
        _matchKeys: new Set([
          normalizeModMatchKey(cleanFolderName),
          normalizeModMatchKey(modName),
          ...(modGuid ? [normalizeModMatchKey(modGuid)] : []),
        ]),
      };

      scannedServerFolders.set(lowerClean, serverModEntry);
      results.push(serverModEntry);
      await new Promise((r) => setImmediate(r));
    }
  }

  // Helper to find an existing scanned mod that matches a client plugin
  const findMatchingServerOrClientMod = (cleanName, pluginName, inferredGuid) => {
    const keysToTry = [
      normalizeModMatchKey(cleanName),
      normalizeModMatchKey(pluginName),
      inferredGuid ? normalizeModMatchKey(inferredGuid) : '',
    ].filter((k) => k && k.length >= 3);

    for (const existing of results) {
      if (inferredGuid && existing.inferredGuid && existing.inferredGuid.toLowerCase() === inferredGuid.toLowerCase()) {
        return existing;
      }
      if (existing._matchKeys) {
        for (const k of keysToTry) {
          if (existing._matchKeys.has(k)) {
            return existing;
          }
        }
      }
    }
    return null;
  };

  // 2. Scan client plugins in BepInEx/plugins (both subdirectories and standalone DLLs)
  if (fs.existsSync(pluginsDir)) {
    let entries = [];
    try {
      entries = await fs.promises.readdir(pluginsDir, { withFileTypes: true });
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      const name = entry.name;
      const isDisabled = name.toLowerCase().endsWith('.disabled');
      const cleanName = isDisabled ? name.slice(0, -9) : name;

      if (isProtectedCoreItem(cleanName)) continue;

      if (entry.isDirectory()) {
        const folderDir = path.join(pluginsDir, name);
        let detectedName = cleanName;
        let detectedVersion = '1.0.0';
        let detectedAuthor = resolveModAuthor(null, cleanName, null);
        let detectedGuid = null;

        // Check package.json inside plugin folder if present
        const pkgJson = path.join(folderDir, 'package.json');
        if (fs.existsSync(pkgJson)) {
          try {
            const data = JSON.parse(await fs.promises.readFile(pkgJson, 'utf8'));
            if (data.name) detectedName = data.name;
            if (data.version) detectedVersion = data.version;
            detectedAuthor = resolveModAuthor(data, cleanName, data.guid);
            if (data.guid) detectedGuid = String(data.guid).toLowerCase();
          } catch (_) {}
        }

        // Also scan .dll files inside the plugin folder (up to 2 levels deep) for [BepInPlugin] metadata
        try {
          const subEntries = await fs.promises.readdir(folderDir, { withFileTypes: true });
          const dllFiles = [];
          for (const sub of subEntries) {
            const subClean = sub.name.replace(/\.disabled$/i, '');
            if (sub.isFile() && subClean.toLowerCase().endsWith('.dll')) {
              dllFiles.push(path.join(folderDir, sub.name));
            } else if (sub.isDirectory()) {
              try {
                const nested = await fs.promises.readdir(path.join(folderDir, sub.name), { withFileTypes: true });
                for (const n of nested) {
                  if (n.isFile() && n.name.replace(/\.disabled$/i, '').toLowerCase().endsWith('.dll')) {
                    dllFiles.push(path.join(folderDir, sub.name, n.name));
                  }
                }
              } catch (_) {}
            }
          }

          for (const dllPath of dllFiles) {
            const dllMeta = await inspectManagedDll(dllPath);
            if (dllMeta.inferredGuid && !detectedGuid) {
              detectedGuid = dllMeta.inferredGuid;
            }
            if (dllMeta.pluginVersion && detectedVersion === '1.0.0') {
              detectedVersion = dllMeta.pluginVersion;
            }
            if (dllMeta.pluginName && detectedName === cleanName) {
              detectedName = dllMeta.pluginName;
            }
            if (detectedGuid && detectedVersion !== '1.0.0') break;
          }
        } catch (_) {}

        if (detectedAuthor === 'Community Author' && detectedGuid) {
          detectedAuthor = resolveModAuthor(null, cleanName, detectedGuid);
        }

        const relClientPath = `BepInEx/plugins/${name}`;
        const folderConfigs = await discoverConfigFilesInDir(folderDir, normalizedRoot);

        // Check if this client plugin folder pairs with an already scanned server mod
        const pairedMod = findMatchingServerOrClientMod(cleanName, detectedName, detectedGuid);
        if (pairedMod) {
          pairedMod.kind = pairedMod.serverPath ? 'Both' : 'Client';
          if (!pairedMod.clientPath) pairedMod.clientPath = relClientPath;
          if (!Array.isArray(pairedMod.clientPaths)) {
            pairedMod.clientPaths = pairedMod.clientPath ? [pairedMod.clientPath] : [];
          }
          if (!pairedMod.clientPaths.includes(relClientPath)) {
            pairedMod.clientPaths.push(relClientPath);
          }
          if (detectedGuid && !pairedMod.inferredGuid) {
            pairedMod.inferredGuid = detectedGuid;
          }
          if (pairedMod.version === '1.0.0' && detectedVersion !== '1.0.0') {
            pairedMod.version = detectedVersion;
            pairedMod.latestVersion = detectedVersion;
          }
          if (folderConfigs.length > 0) {
            pairedMod.configFiles = [...(pairedMod.configFiles || []), ...folderConfigs];
          }
          continue;
        }

        let installDate = new Date().toISOString().split('T')[0];
        try {
          const stat = await fs.promises.stat(folderDir);
          if (stat.mtime) installDate = stat.mtime.toISOString().split('T')[0];
        } catch (_) {}

        const uniqueId = ensureUniqueId(detectedGuid, 'disk.client', cleanName);
        results.push({
          id: uniqueId,
          name: detectedName,
          author: detectedAuthor,
          version: detectedVersion,
          kind: 'Client',
          sptVersion: defaultSptVer,
          fikaCompatibility: true,
          installDate,
          clientPath: relClientPath,
          clientPaths: [relClientPath],
          isDisabled,
          hasUpdate: false,
          latestVersion: detectedVersion,
          configFiles: folderConfigs,
          inferredGuid: detectedGuid || undefined,
          _matchKeys: new Set([
            normalizeModMatchKey(cleanName),
            normalizeModMatchKey(detectedName),
            ...(detectedGuid ? [normalizeModMatchKey(detectedGuid)] : []),
          ]),
        });
      } else if (cleanName.toLowerCase().endsWith('.dll')) {
        const baseName = cleanName.replace(/\.dll$/i, '');
        const fullDll = path.join(pluginsDir, name);
        const { role, inferredGuid, pluginName, pluginVersion } = await inspectManagedDll(fullDll);
        const resolvedName = pluginName || baseName;
        const resolvedVer = pluginVersion || '1.0.0';
        const resolvedAuthor = resolveModAuthor(null, baseName, inferredGuid);
        const relClientPath = `BepInEx/plugins/${name}`;

        // Check if this standalone DLL pairs with an existing server or client mod
        const pairedMod = findMatchingServerOrClientMod(baseName, resolvedName, inferredGuid);
        if (pairedMod) {
          pairedMod.kind = pairedMod.serverPath ? 'Both' : 'Client';
          if (!pairedMod.clientPath) pairedMod.clientPath = relClientPath;
          if (!Array.isArray(pairedMod.clientPaths)) {
            pairedMod.clientPaths = pairedMod.clientPath ? [pairedMod.clientPath] : [];
          }
          if (!pairedMod.clientPaths.includes(relClientPath)) {
            pairedMod.clientPaths.push(relClientPath);
          }
          if (inferredGuid && !pairedMod.inferredGuid) {
            pairedMod.inferredGuid = inferredGuid;
          }
          if (pairedMod.version === '1.0.0' && resolvedVer !== '1.0.0') {
            pairedMod.version = resolvedVer;
            pairedMod.latestVersion = resolvedVer;
          }
          continue;
        }

        let installDate = new Date().toISOString().split('T')[0];
        try {
          const stat = await fs.promises.stat(fullDll);
          if (stat.mtime) installDate = stat.mtime.toISOString().split('T')[0];
        } catch (_) {}

        const uniqueId = ensureUniqueId(inferredGuid, 'disk.client', baseName);
        results.push({
          id: uniqueId,
          name: resolvedName,
          author: resolvedAuthor,
          version: resolvedVer,
          kind: 'Client',
          sptVersion: defaultSptVer,
          fikaCompatibility: true,
          installDate,
          clientPath: relClientPath,
          clientPaths: [relClientPath],
          isDisabled,
          hasUpdate: false,
          latestVersion: resolvedVer,
          configFiles: [],
          inferredGuid: inferredGuid || undefined,
          isPatcher: role === 'patcher',
          _matchKeys: new Set([
            normalizeModMatchKey(baseName),
            normalizeModMatchKey(resolvedName),
            ...(inferredGuid ? [normalizeModMatchKey(inferredGuid)] : []),
          ]),
        });
      }
      await new Promise((r) => setImmediate(r));
    }
  }

  // 3. Scan BepInEx/patchers (excluding protected core BepInEx/SPT patchers)
  const clientPatchersDir = path.join(normalizedRoot, 'BepInEx', 'patchers');
  if (fs.existsSync(clientPatchersDir)) {
    let patcherEntries = [];
    try {
      patcherEntries = await fs.promises.readdir(clientPatchersDir);
    } catch {
      patcherEntries = [];
    }

    for (const name of patcherEntries) {
      const isDisabled = name.toLowerCase().endsWith('.disabled');
      const cleanName = isDisabled ? name.slice(0, -9) : name;
      if (isProtectedCoreItem(cleanName)) continue;

      if (cleanName.toLowerCase().endsWith('.dll')) {
        const baseName = cleanName.replace(/\.dll$/i, '').replace(/[-_.]?PreloaderPatcher$/i, '').replace(/[-_.]?Patcher$/i, '');
        const fullDll = path.join(clientPatchersDir, name);
        const { inferredGuid, pluginName, pluginVersion } = await inspectManagedDll(fullDll);
        const relPatcherPath = `BepInEx/patchers/${name}`;

        const pairedMod = findMatchingServerOrClientMod(baseName, pluginName || baseName, inferredGuid);
        if (pairedMod) {
          if (!Array.isArray(pairedMod.clientPaths)) {
            pairedMod.clientPaths = pairedMod.clientPath ? [pairedMod.clientPath] : [];
          }
          if (!pairedMod.clientPaths.includes(relPatcherPath)) {
            pairedMod.clientPaths.push(relPatcherPath);
          }
          if (!pairedMod.clientPath) {
            pairedMod.clientPath = relPatcherPath;
          }
          continue;
        }

        const resolvedVer = pluginVersion || '1.0.0';
        const uniqueId = ensureUniqueId(inferredGuid, 'disk.patcher', baseName);
        results.push({
          id: uniqueId,
          name: pluginName || cleanName.replace(/\.dll$/i, ''),
          author: resolveModAuthor(null, baseName, inferredGuid),
          version: resolvedVer,
          kind: 'Client',
          sptVersion: defaultSptVer,
          fikaCompatibility: true,
          installDate: new Date().toISOString().split('T')[0],
          clientPath: relPatcherPath,
          clientPaths: [relPatcherPath],
          isDisabled,
          hasUpdate: false,
          latestVersion: resolvedVer,
          configFiles: [],
          inferredGuid: inferredGuid || undefined,
          isPatcher: true,
          _matchKeys: new Set([normalizeModMatchKey(baseName)]),
        });
      }
    }
  }

  // 4. Discover BepInEx/config/*.cfg files and attach them to their corresponding mods
  const bepInExConfigDir = path.join(normalizedRoot, 'BepInEx', 'config');
  if (fs.existsSync(bepInExConfigDir)) {
    try {
      const cfgFiles = await fs.promises.readdir(bepInExConfigDir, { withFileTypes: true });
      for (const entry of cfgFiles) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (ext !== '.cfg' && ext !== '.ini' && ext !== '.json') continue;
        const baseCfg = path.basename(entry.name, ext).toLowerCase();
        if (isProtectedCoreItem(baseCfg)) continue;

        const matchedMod =
          results.find((m) => m.inferredGuid && baseCfg.includes(m.inferredGuid.toLowerCase())) ||
          findMatchingServerOrClientMod(baseCfg, baseCfg, baseCfg);

        if (matchedMod && (!matchedMod.configFiles || matchedMod.configFiles.length < 15)) {
          const fullCfgPath = path.join(bepInExConfigDir, entry.name);
          try {
            const stat = await fs.promises.stat(fullCfgPath);
            if (stat.size > 0 && stat.size <= 256 * 1024) {
              const relPath = `BepInEx/config/${entry.name}`;
              if (!matchedMod.configFiles.some((c) => c.relativePath === relPath)) {
                matchedMod.configFiles.push({
                  id: `cfg-${relPath}`,
                  name: entry.name,
                  relativePath: relPath,
                  format: ext === '.json' ? 'json' : 'ini',
                  content: await fs.promises.readFile(fullCfgPath, 'utf8'),
                });
              }
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  // Strip temporary internal _matchKeys before returning over IPC
  for (const mod of results) {
    delete mod._matchKeys;
  }

  return results;
}

/**
 * Persists edited configuration file content directly to disk inside the SPT directory.
 * Breaks any existing hardlink first so editing a config can never mutate `.blacksite_library`.
 */
async function saveModConfigFile({ sptDirectory, relativePath, content }) {
  const normalizedRoot = normalizeSptRoot(sptDirectory);
  if (!normalizedRoot || !relativePath || typeof content !== 'string') {
    return { success: false, error: 'Invalid config save parameters' };
  }
  const fullTarget = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(normalizedRoot, ...relativePath.replace(/\\/g, '/').split('/'));
  try {
    assertSafeSptTarget(fullTarget, normalizedRoot);
    fs.mkdirSync(path.dirname(fullTarget), { recursive: true });
    // Break any potential hardlink before writing so .blacksite_library is never mutated
    if (fs.existsSync(fullTarget)) {
      try {
        const st = fs.statSync(fullTarget);
        if (st.nlink > 1) {
          fs.unlinkSync(fullTarget);
        }
      } catch (_) {}
    }
    fs.writeFileSync(fullTarget, content, 'utf8');
    return { success: true, savedPath: fullTarget };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Reads Tarkov player character save profiles from user/profiles/*.json across SPT 3.x & 4.x layouts
 */
async function scanSptPlayerProfiles({ sptDirectory }) {
  const normalizedRoot = normalizeSptRoot(sptDirectory);
  if (!normalizedRoot || !fs.existsSync(normalizedRoot)) return [];

  const candidateProfileDirs = [
    path.join(normalizedRoot, 'SPT', 'user', 'profiles'),
    path.join(normalizedRoot, 'SPT_Runtime', 'user', 'profiles'),
    path.join(normalizedRoot, 'user', 'profiles'),
  ];

  const results = [];
  const seenProfileIds = new Set();

  for (const profilesDir of candidateProfileDirs) {
    if (!fs.existsSync(profilesDir)) continue;
    try {
      const files = await fs.promises.readdir(profilesDir);
      for (const file of files) {
        if (!file.toLowerCase().endsWith('.json')) continue;
        const filePath = path.join(profilesDir, file);
        try {
          const raw = await fs.promises.readFile(filePath, 'utf8');
          const data = JSON.parse(raw);
          const pmcInfo = data?.characters?.pmc?.Info || data?.info || {};
          const profileId = data?.info?.id || data?._id || path.basename(file, '.json');
          if (seenProfileIds.has(profileId)) continue;
          seenProfileIds.add(profileId);

          const nickname = pmcInfo.Nickname || pmcInfo.username || profileId;
          const rawSide = String(pmcInfo.Side || '').toLowerCase();
          const side = rawSide.includes('bear') ? 'Bear' : rawSide.includes('usec') ? 'Usec' : 'Unknown';
          const level = Number(pmcInfo.Level) || 1;
          const experience = Number(pmcInfo.Experience) || 0;
          const edition = String(data?.characters?.pmc?.Info?.AccountType || data?.info?.edition || 'Standard');

          results.push({
            id: profileId,
            name: nickname,
            side,
            level,
            experience,
            edition,
            wipeVersion: data?.info?.wipeVersion || '4.x',
            lastPlayed: 'Local Save',
          });
        } catch (parseErr) {
          // Skip unparseable json
        }
      }
    } catch (err) {
      console.warn('[Blacksite VFS] Error scanning user profiles:', err.message);
    }
  }
  return results;
}

/**
 * Fast VFS profile relinker: zero-copy atomic enable/disable of mods for the active profile
 */
async function relinkVfsProfile({ sptDirectory, enabledModIds = [], disabledModIds = [] }) {
  const startTime = Date.now();
  const normalizedRoot = normalizeSptRoot(sptDirectory);
  if (!normalizedRoot || !fs.existsSync(normalizedRoot)) {
    return { success: false, error: 'Invalid SPT directory' };
  }

  const enabledSet = new Set(enabledModIds.map((id) => id.toLowerCase()));
  const disabledSet = new Set(disabledModIds.map((id) => id.toLowerCase()));

  // Scan installed mods on disk
  const diskMods = await scanInstalledMods({ sptDirectory: normalizedRoot });
  let switchedCount = 0;

  for (const mod of diskMods) {
    const modIdLower = mod.id.toLowerCase();
    const shouldBeEnabled = enabledSet.has(modIdLower);
    const shouldBeDisabled = disabledSet.has(modIdLower);

    if (shouldBeEnabled && mod.isDisabled) {
      await toggleModDisable({
        sptDirectory: normalizedRoot,
        serverPath: mod.serverPath,
        clientPath: mod.clientPath,
        clientPaths: mod.clientPaths,
        disable: false,
      });
      switchedCount++;
    } else if (shouldBeDisabled && !mod.isDisabled) {
      await toggleModDisable({
        sptDirectory: normalizedRoot,
        serverPath: mod.serverPath,
        clientPath: mod.clientPath,
        clientPaths: mod.clientPaths,
        disable: true,
      });
      switchedCount++;
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(`[Blacksite VFS] Profile relink complete: ${switchedCount} mods adjusted in ${durationMs}ms`);

  return {
    success: true,
    switchedCount,
    durationMs,
  };
}

/**
 * Purges leftover .blacksite_staging and OS temp files created during archive extraction
 */
async function clearTempDirectories({ sptDirectory } = {}) {
  let reclaimedBytes = 0;
  let deletedCount = 0;

  function safeDeleteDir(dirPath) {
    if (!fs.existsSync(dirPath)) return;
    try {
      const items = fs.readdirSync(dirPath);
      for (const item of items) {
        const full = path.join(dirPath, item);
        try {
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            safeDeleteDir(full);
          } else {
            reclaimedBytes += stat.size;
            fs.unlinkSync(full);
            deletedCount++;
          }
        } catch (_) {}
      }
      fs.rmdirSync(dirPath);
      deletedCount++;
    } catch (_) {}
  }

  // 1. Clear SPT directory .blacksite_staging
  const normalizedRoot = normalizeSptRoot(sptDirectory);
  if (normalizedRoot && fs.existsSync(normalizedRoot)) {
    const stagingRoot = path.join(normalizedRoot, '.blacksite_staging');
    if (fs.existsSync(stagingRoot)) {
      safeDeleteDir(stagingRoot);
    }
  }

  // 2. Clear os.tmpdir() artifacts
  try {
    const tmp = os.tmpdir();
    const entries = fs.readdirSync(tmp);
    for (const name of entries) {
      if (
        name.startsWith('blacksite-') ||
        name.startsWith('bs-staging-') ||
        name.startsWith('bs-extract-') ||
        name.startsWith('inst-')
      ) {
        const full = path.join(tmp, name);
        try {
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            safeDeleteDir(full);
          } else {
            reclaimedBytes += stat.size;
            fs.unlinkSync(full);
            deletedCount++;
          }
        } catch (_) {}
      }
    }
  } catch (_) {}

  return { success: true, reclaimedBytes, deletedCount };
}

module.exports = {
  installMod,
  uninstallMod,
  uninstallAllMods,
  toggleModDisable,
  scanInstalledMods,
  scanSptPlayerProfiles,
  relinkVfsProfile,
  clearTempDirectories,
  inspectSptDirectory,
  resolveSptPaths,
  normalizeSptRoot,
  saveModConfigFile,
  detectSptServerModsRelativePath,
  inspectManagedDll,
  normalizeAndRouteModEntry,
  purgeDeprecatedModFiles,
  assertSafeSptTarget,
  isProtectedCoreItem,
  isMutableConfigFile,
  shouldDeepMergeConfigOnUpdate,
  validateArchiveEntryPath,
  assertArchiveManifestWithinLimits,
  inspectAndValidateArchive,
  verifyExtractedStagingTree,
  extractArchive,
  routeExtractedModToSpt,
  validateDownloadUrl,
  downloadViaNodeHttp,
  streamDownloadToFile,
  resolveResourceLimits,
  DEFAULT_RESOURCE_LIMITS,
  DiagnosticRingBuffer,
};


