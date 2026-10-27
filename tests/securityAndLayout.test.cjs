const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const AdmZip = require('adm-zip');

const {
  validateArchiveEntryPath,
  assertArchiveManifestWithinLimits,
  resolveResourceLimits,
  extractArchive,
  inspectSptDirectory,
  uninstallMod,
  uninstallAllMods,
  routeExtractedModToSpt,
  saveModConfigFile,
  isMutableConfigFile,
  validateDownloadUrl,
  streamDownloadToFile,
  scanInstalledMods,
} = require('../electron/modInstaller.cjs');

function makeTempDir(prefix = 'blacksite-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('Archive path validation blocks traversal, drive roots, UNC paths, ADS, and symlinks', () => {
  assert.equal(validateArchiveEntryPath('user/mods/MyMod/package.json'), 'user/mods/MyMod/package.json');
  assert.equal(validateArchiveEntryPath('BepInEx\\plugins\\MyPlugin.dll'), 'BepInEx/plugins/MyPlugin.dll');

  assert.throws(() => validateArchiveEntryPath('../outside.txt'), /path traversal/i);
  assert.throws(() => validateArchiveEntryPath('user/mods/../../outside.txt'), /path traversal/i);
  assert.throws(() => validateArchiveEntryPath('user\\mods\\..\\..\\outside.txt'), /path traversal/i);
  assert.throws(() => validateArchiveEntryPath('/etc/passwd'), /absolute or UNC/i);
  assert.throws(() => validateArchiveEntryPath('C:\\Windows\\System32\\cmd.exe'), /drive path or Windows Alternate Data Stream/i);
  assert.throws(() => validateArchiveEntryPath('\\\\evil-server\\share\\payload.dll'), /absolute or UNC/i);
  assert.throws(
    () => validateArchiveEntryPath('BepInEx/plugins/mod.dll:Zone.Identifier'),
    /drive path or Windows Alternate Data Stream/i
  );
  assert.throws(
    () => validateArchiveEntryPath('user/mods/MyMod/link', { isSymlink: true }),
    /symbolic link or reparse point/i
  );
});

test('Archive manifest resource limits reject excessive file counts, size, and compression ratio', () => {
  const defaultLimits = resolveResourceLimits();
  assert.equal(defaultLimits.maxDownloadBytes, 8 * 1024 * 1024 * 1024);
  assert.equal(defaultLimits.maxExtractedBytes, 20 * 1024 * 1024 * 1024);
  assert.equal(defaultLimits.maxFiles, 100000);

  assert.doesNotThrow(() =>
    assertArchiveManifestWithinLimits({ fileCount: 10, totalUncompressedBytes: 1024 }, 512, defaultLimits)
  );

  // Excessive file count
  assert.throws(
    () =>
      assertArchiveManifestWithinLimits(
        { fileCount: 101, totalUncompressedBytes: 2048 },
        1024,
        resolveResourceLimits({ maxFiles: 100 })
      ),
    /exceeds maximum file count limit/i
  );

  // Excessive uncompressed size
  assert.throws(
    () =>
      assertArchiveManifestWithinLimits(
        { fileCount: 1, totalUncompressedBytes: 5000 },
        2000,
        resolveResourceLimits({ maxExtractedBytes: 1000 })
      ),
    /exceeds maximum uncompressed size limit/i
  );

  // Zip bomb ratio (> 10 MB uncompressed and ratio > 200:1)
  assert.throws(
    () =>
      assertArchiveManifestWithinLimits(
        { fileCount: 1, totalUncompressedBytes: 25 * 1024 * 1024 },
        10 * 1024,
        defaultLimits
      ),
    /extreme compression ratio/i
  );
});

test('extractArchive fails closed on malicious zip traversal entry and cleans up staging directory', async (t) => {
  const tmpRoot = makeTempDir('blacksite-zip-');
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  const zipPath = path.join(tmpRoot, 'malicious.zip');
  const extractDest = path.join(tmpRoot, 'staging');
  const outsideTarget = path.join(tmpRoot, 'pwned.txt');

  // Build a zip buffer and patch the raw entry filename to "../pwned.txt" (12 chars)
  // because AdmZip.addFile sanitizes '../' on creation.
  const placeholderName = 'XXXXXXXX.txt'; // 12 bytes, same length as '../pwned.txt'
  const evilName = '../pwned.txt';
  const zip = new AdmZip();
  zip.addFile('user/mods/GoodMod/package.json', Buffer.from('{"name":"good"}'));
  zip.addFile(placeholderName, Buffer.from('escaped'));
  const rawZipBuf = zip.toBuffer();

  // Replace all occurrences of placeholderName in local & central headers with "../pwned.txt"
  let idx = 0;
  while ((idx = rawZipBuf.indexOf(placeholderName, idx, 'utf8')) !== -1) {
    rawZipBuf.write(evilName, idx, evilName.length, 'utf8');
    idx += evilName.length;
  }
  fs.writeFileSync(zipPath, rawZipBuf);

  await assert.rejects(
    () => extractArchive(zipPath, extractDest),
    /Unsafe archive entry/i
  );

  assert.equal(fs.existsSync(outsideTarget), false, 'No file outside staging may be created');
  assert.equal(fs.existsSync(extractDest), false, 'Failed extraction must clean up partial staging output');
});

test('Download validation enforces HTTPS by default, blocks HTTPS->HTTP downgrade, and enforces streaming byte limits', async (t) => {
  assert.doesNotThrow(() => validateDownloadUrl('https://mods.sp-tarkov.com/files/mod.zip'));
  assert.throws(
    () => validateDownloadUrl('http://mods.sp-tarkov.com/files/mod.zip'),
    /Refusing to download over insecure protocol/i
  );
  assert.throws(
    () =>
      validateDownloadUrl('http://cdn.sp-tarkov.com/mod.zip', {
        allowInsecureHttp: true,
        previousUrl: 'https://mods.sp-tarkov.com/download/1',
      }),
    /Blocked insecure redirect downgrade/i
  );
  assert.doesNotThrow(() =>
    validateDownloadUrl('http://127.0.0.1:8080/mod.zip', { allowInsecureHttp: true })
  );
  assert.throws(() => validateDownloadUrl('file:///C:/Windows/win.ini'), /Refusing to download over insecure protocol/i);

  const tmpRoot = makeTempDir('blacksite-dl-');
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.write(Buffer.alloc(4096, 0x41));
    res.end(Buffer.alloc(4096, 0x42));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const destFile = path.join(tmpRoot, 'partial.zip');

  await assert.rejects(
    () =>
      streamDownloadToFile(`http://127.0.0.1:${port}/oversized.zip`, destFile, null, 0, {
        allowInsecureHttp: true,
        maxDownloadBytes: 2048,
      }),
    /exceeded maximum allowed size/i
  );

  assert.equal(fs.existsSync(destFile), false, 'Partial download file must be unlinked when byte limit is exceeded');
});

test('SPT layout detection distinguishes 3.x, 4.0, 4.1+ and preserves preferred path when ambiguous', async (t) => {
  const tmpRoot = makeTempDir('blacksite-spt-layouts-');
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  // 1. SPT 3.x layout (Aki.Server.exe -> user/mods)
  const spt3Dir = path.join(tmpRoot, 'spt3');
  fs.mkdirSync(path.join(spt3Dir, 'user', 'mods'), { recursive: true });
  fs.writeFileSync(path.join(spt3Dir, 'Aki.Server.exe'), 'binary');
  const info3 = inspectSptDirectory(spt3Dir);
  assert.equal(info3.serverModPath, 'user/mods');

  // 2. SPT 4.0 layout (SPT/SPT.Server.exe -> SPT/user/mods)
  const spt40Dir = path.join(tmpRoot, 'spt40');
  fs.mkdirSync(path.join(spt40Dir, 'SPT', 'user', 'mods'), { recursive: true });
  fs.writeFileSync(path.join(spt40Dir, 'SPT', 'SPT.Server.exe'), 'binary');
  const info40 = inspectSptDirectory(spt40Dir);
  assert.equal(info40.serverModPath, 'SPT/user/mods');

  // 3. SPT 4.1+ layout (SPT_Runtime/SPT.Server.exe -> SPT_Runtime/user/mods)
  const spt41Dir = path.join(tmpRoot, 'spt41');
  fs.mkdirSync(path.join(spt41Dir, 'SPT_Runtime', 'user', 'mods'), { recursive: true });
  fs.writeFileSync(path.join(spt41Dir, 'SPT_Runtime', 'SPT.Server.exe'), 'binary');
  const info41 = inspectSptDirectory(spt41Dir);
  assert.equal(info41.serverModPath, 'SPT_Runtime/user/mods');

  // 4. Ambiguous layout with duplicate mod folders across SPT/user/mods and SPT_Runtime/user/mods
  const ambigDir = path.join(tmpRoot, 'ambiguous');
  fs.mkdirSync(path.join(ambigDir, 'SPT', 'user', 'mods', 'SharedMod'), { recursive: true });
  fs.mkdirSync(path.join(ambigDir, 'SPT_Runtime', 'user', 'mods', 'SharedMod'), { recursive: true });
  fs.writeFileSync(path.join(ambigDir, 'EscapeFromTarkov.exe'), 'binary');

  const ambigInfo = inspectSptDirectory(ambigDir, { preferredServerModPath: 'SPT/user/mods' });
  assert.equal(ambigInfo.isLayoutAmbiguous, true);
  assert.equal(ambigInfo.serverModPath, 'SPT/user/mods');
  assert.ok(ambigInfo.duplicateMods.some((d) => d.modName === 'SharedMod'));
  assert.ok(ambigInfo.layoutWarning && ambigInfo.layoutWarning.includes('SharedMod'));

  // Verify scanInstalledMods surfaces duplicateLocations
  fs.writeFileSync(
    path.join(ambigDir, 'SPT', 'user', 'mods', 'SharedMod', 'package.json'),
    JSON.stringify({ name: 'SharedMod', version: '1.2.0', author: 'Tester' })
  );
  fs.writeFileSync(
    path.join(ambigDir, 'SPT_Runtime', 'user', 'mods', 'SharedMod', 'package.json'),
    JSON.stringify({ name: 'SharedMod', version: '1.0.0', author: 'Tester' })
  );
  const scanned = await scanInstalledMods({
    sptDirectory: ambigDir,
    preferredServerModPath: 'SPT/user/mods',
  });
  const shared = scanned.find((m) => m.name === 'SharedMod');
  assert.ok(shared, 'Expected SharedMod to be discovered');
  assert.ok(Array.isArray(shared.duplicateLocations) && shared.duplicateLocations.length >= 1);
});

test('VFS deployment copies mutable configs and hardlinks binaries so config edits never corrupt .blacksite_library', async (t) => {
  const tmpRoot = makeTempDir('blacksite-vfs-');
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  const sptDir = path.join(tmpRoot, 'SPT_Install');
  fs.mkdirSync(path.join(sptDir, 'SPT', 'user', 'mods'), { recursive: true });
  fs.mkdirSync(path.join(sptDir, 'BepInEx', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(sptDir, 'SPT', 'SPT.Server.exe'), 'binary');

  const libraryModDir = path.join(sptDir, '.blacksite_library', 'TestHybridMod');
  fs.mkdirSync(path.join(libraryModDir, 'user', 'mods', 'TestHybridMod', 'config'), { recursive: true });
  fs.mkdirSync(path.join(libraryModDir, 'BepInEx', 'plugins', 'TestHybridMod'), { recursive: true });

  const libConfigPath = path.join(libraryModDir, 'user', 'mods', 'TestHybridMod', 'config', 'config.json');
  const libDllPath = path.join(libraryModDir, 'BepInEx', 'plugins', 'TestHybridMod', 'TestHybridMod.dll');

  fs.writeFileSync(libConfigPath, JSON.stringify({ enabled: true, multiplier: 1 }, null, 2));
  fs.writeFileSync(libDllPath, 'IMMUTABLE_BINARY_PAYLOAD');

  assert.equal(isMutableConfigFile(libConfigPath), true);
  assert.equal(isMutableConfigFile(libDllPath), false);

  const routeResult = await routeExtractedModToSpt(
    libraryModDir,
    sptDir,
    'TestHybridMod',
    '4.0.0',
    'balanced',
    null,
    'TestHybridMod',
    'SPT/user/mods'
  );
  assert.equal(routeResult.kind, 'Both');

  const deployedConfigPath = path.join(sptDir, 'SPT', 'user', 'mods', 'TestHybridMod', 'config', 'config.json');
  const deployedDllPath = path.join(sptDir, 'BepInEx', 'plugins', 'TestHybridMod', 'TestHybridMod.dll');

  assert.equal(fs.existsSync(deployedConfigPath), true);
  assert.equal(fs.existsSync(deployedDllPath), true);

  // Mutable config must NOT share inode with library copy
  const libConfigStat = fs.statSync(libConfigPath);
  const deployedConfigStat = fs.statSync(deployedConfigPath);
  assert.equal(libConfigStat.nlink, 1, 'Library config file must not be hardlinked');
  assert.notEqual(libConfigStat.ino, deployedConfigStat.ino, 'Deployed config must have an independent inode');

  // Edit deployed config via saveModConfigFile and verify library copy stays pristine
  const saveRes = await saveModConfigFile({
    sptDirectory: sptDir,
    relativePath: 'SPT/user/mods/TestHybridMod/config/config.json',
    content: JSON.stringify({ enabled: false, multiplier: 99 }, null, 2),
  });
  assert.equal(saveRes.success, true);

  const libraryConfigAfterEdit = JSON.parse(fs.readFileSync(libConfigPath, 'utf8'));
  const deployedConfigAfterEdit = JSON.parse(fs.readFileSync(deployedConfigPath, 'utf8'));
  assert.equal(libraryConfigAfterEdit.multiplier, 1, 'Library source config must remain unchanged');
  assert.equal(deployedConfigAfterEdit.multiplier, 99, 'Deployed config must reflect saved changes');
});

test('uninstallMod and uninstallAllMods clean all server layouts and BepInEx while protecting core SPT files', async (t) => {
  const tmpRoot = makeTempDir('blacksite-uninstall-');
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  const sptDir = path.join(tmpRoot, 'SPT_Game');
  // Core protected paths
  fs.mkdirSync(path.join(sptDir, 'BepInEx', 'plugins', 'spt'), { recursive: true });
  fs.writeFileSync(path.join(sptDir, 'BepInEx', 'plugins', 'spt', 'spt-core.dll'), 'core');
  fs.mkdirSync(path.join(sptDir, 'BepInEx', 'patchers'), { recursive: true });
  fs.writeFileSync(path.join(sptDir, 'BepInEx', 'patchers', 'spt-prepatch.dll'), 'core-patcher');
  fs.writeFileSync(path.join(sptDir, 'EscapeFromTarkov.exe'), 'game');

  // Populate mods across all 3 server layouts + plugins + patchers
  const serverLayouts = ['SPT/user/mods', 'SPT_Runtime/user/mods', 'user/mods'];
  for (const rel of serverLayouts) {
    const modDir = path.join(sptDir, ...rel.split('/'), 'SampleServerMod');
    fs.mkdirSync(modDir, { recursive: true });
    fs.writeFileSync(path.join(modDir, 'package.json'), '{"name":"SampleServerMod"}');
  }
  fs.writeFileSync(path.join(sptDir, 'BepInEx', 'plugins', 'SamplePlugin.dll'), 'plugin');
  fs.writeFileSync(path.join(sptDir, 'BepInEx', 'patchers', 'CustomPatcher.dll'), 'patcher');

  // Test single mod fallback removal across all server layouts
  const singleRes = await uninstallMod({
    sptDirectory: sptDir,
    modName: 'SampleServerMod',
  });
  assert.equal(singleRes.success, true);
  for (const rel of serverLayouts) {
    assert.equal(fs.existsSync(path.join(sptDir, ...rel.split('/'), 'SampleServerMod')), false);
  }

  // Re-add one server mod and test uninstallAllMods
  fs.mkdirSync(path.join(sptDir, 'SPT_Runtime', 'user', 'mods', 'AnotherMod'), { recursive: true });
  const wipeRes = await uninstallAllMods({ sptDirectory: sptDir });
  assert.equal(wipeRes.success, true);
  assert.equal(fs.existsSync(path.join(sptDir, 'SPT_Runtime', 'user', 'mods', 'AnotherMod')), false);
  assert.equal(fs.existsSync(path.join(sptDir, 'BepInEx', 'plugins', 'SamplePlugin.dll')), false);
  assert.equal(fs.existsSync(path.join(sptDir, 'BepInEx', 'patchers', 'CustomPatcher.dll')), false);

  // Core SPT files must still exist
  assert.equal(fs.existsSync(path.join(sptDir, 'BepInEx', 'plugins', 'spt', 'spt-core.dll')), true);
  assert.equal(fs.existsSync(path.join(sptDir, 'BepInEx', 'patchers', 'spt-prepatch.dll')), true);
  assert.equal(fs.existsSync(path.join(sptDir, 'EscapeFromTarkov.exe')), true);
  assert.ok(wipeRes.skippedProtected.length >= 2);
});
