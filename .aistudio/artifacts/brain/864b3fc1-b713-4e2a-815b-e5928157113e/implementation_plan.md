# Fix Plan: Archive Extraction, Network TLS, and 404 Recovery

## Problem Analysis

Recent error logs revealed three distinct failure points during mod installations:

1. **Extraction Engine Failure (`WTT - Content Backport`, `ISB Aishi`)**:
   - `Unable to extract archive with any available decompression engine.`
   - Multi-gigabyte `.7z` archives require `7za.exe` (Windows built-in `tar.exe` does not support 7z LZMA2 compression).
   - In packaged builds, `resolve7zaBinary()` can fail if the packaged binary in `extraResources` is missing or inaccessible, and there is no automatic runtime recovery if missing.
   - Furthermore, `sourceMod` is currently not passed into `queueInstall()` in `App.tsx` (lines 554 and 773), which prevented the manual extraction recovery modal from rendering mod details.

2. **Network / TLS Handshake Failure (`Tactical Gear Component`)**:
   - `TypeError: fetch failed` inside `streamDownloadToFile()` via Undici.
   - External mod author servers (e.g. `emils.graphics`) fail Node's default strict TLS handshake / cipher negotiation.

3. **CDN 404 Not Found Errors (`ECOT - Eukyre's Consortium of Things`, `BALL - Better Ammo Loading List`)**:
   - `Download failed with HTTP status 404: Not Found` for URLs like `https://files.sp-mod.com/mods/2195.zip`.
   - Direct CDN files can be purged or reorganized. Currently, the installer aborts without trying alternate Forge routes or guiding the user to select another version.

---

## Proposed Changes

### 1. Robust 7-Zip Runtime Resolution & Auto-Provisioning (`electron/modInstaller.cjs`)
- **Multi-Path Search**: Expand `resolve7zaBinary()` to check:
  - `process.resourcesPath/bin/win/7za.exe`
  - `path.join(app.getPath('userData'), 'bin', '7za.exe')`
  - Standard system paths (`C:\Program Files\7-Zip\7z.exe`, `C:\Program Files (x86)\7-Zip\7z.exe`)
- **Runtime 7za Auto-Download**: If `7za.exe` is absent and a `.7z` / `.rar` archive needs extraction, download a verified standalone 7za binary to `app.getPath('userData')/bin/7za.exe` before extraction.
- **Enhanced Extraction Pipeline**:
  - Buffer larger stdout/stderr for multi-gigabyte archives.
  - Return clear diagnostic details if archive extraction fails, including target output folder and extracted files count.

### 2. Resilient Download Pipeline with TLS Fallback (`electron/modInstaller.cjs`)
- **Fallback on `fetch failed`**:
  - Catch `TypeError: fetch failed` / TLS handshake errors.
  - Retry using Node's native `https.request` with permissive TLS options (`rejectUnauthorized: false` for author domains with legacy certificates) and custom agent settings.
  - Add retry with backoff before declaring download failure.

### 3. Alternate Route Recovery & 404 Version Picker (`electron/modInstaller.cjs` & `src/App.tsx`)
- **Automatic 404 Fallback**:
  - If a direct CDN link `files.sp-mod.com/mods/{id}.zip` returns 404, automatically fall back to testing the Forge download route: `https://sp-mod.com/mod/download/{id}`.
- **Specific Error Reporting**:
  - When a download permanently 404s, tag the error code as `ERR_NOT_FOUND_404` and include the mod ID and available versions.
- **UI Recovery Flow**:
  - Fix `sourceMod` pass-through in `handleInstallMod` and `queueInstall` in `App.tsx` so the mod object is never lost.
  - Catch `ERR_NOT_FOUND_404` and automatically open the Version Picker modal, notifying the user that the CDN asset for that specific build was retired and allowing 1-click selection of an alternate compatible release.
  - Show the Manual Extraction recovery dialog if archive decompression fails, with a button to reveal the downloaded archive in Windows Explorer and open the destination mod folder.

---

## Verification Plan

### Automated / Build Checks
1. Compile and typecheck with `npm run build` to ensure TypeScript compliance in `src/App.tsx` and bridge definitions.
2. Verify syntax and error handling in `electron/modInstaller.cjs`.

### Functional Tests
1. **Extraction**: Test `.7z` extraction resolution with simulated missing bundled binary to verify fallback paths.
2. **TLS Resilience**: Verify that URLs failing standard undici `fetch` fallback cleanly to the https agent.
3. **404 Handling**: Test 404 download response to ensure it returns `ERR_NOT_FOUND_404` and triggers the Version Picker dialog in the UI.
