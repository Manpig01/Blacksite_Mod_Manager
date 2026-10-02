# Implementation Plan: Streaming Downloads & SPT_Runtime Archive Routing

Resolve large mod installation lag, provide live percentage progress, and fix archive extraction for `SPT_Runtime` structures (resolving empty folders such as `WTT-CommonLib`).

## Proposed Changes

### 1. Zero-Lag Direct-to-Disk Streaming Engine (`electron/modInstaller.cjs`)
- **Direct-to-Disk Stream Pipeline**:
  - Replace memory-heavy `response.arrayBuffer()` and synchronous `fs.writeFileSync()` with chunked disk streaming using `fs.createWriteStream()` and Node.js stream pipeline.
  - Keeps V8 RAM usage below 30 MB regardless of archive size (whether 20 MB or 4 GB), preventing garbage collection pauses and eliminating UI freezing.
- **Real-Time Progress & Speed Calculation**:
  - Track `receivedBytes`, `totalBytes` (from `content-length` header), elapsed time, and download speed in MB/s.
  - Emit throttled progress events (every 150ms) to the Electron renderer via progress callbacks:
    - Stages: `'downloading'`, `'extracting'`, `'routing'`, `'installed'`.
    - Data: `{ queueId, stage, percent, receivedBytes, totalBytes, speed, detail }`.

### 2. Comprehensive SPT Archive Routing (`electron/modInstaller.cjs`)
- **Support for `SPT_Runtime` & Deeply Nested Folders**:
  - Detect and copy `SPT_Runtime/user` and `SPT_Runtime/BepInEx` (the format used by WTT - CommonLib, SAIN, and SPT 4.x mods).
  - Also support `BepInEx/patchers` (e.g. `FixPluginTypesSerialization.dll` needed by WTT CommonLib).
  - Recursively search for any `user/mods/<folder>` or `BepInEx/plugins/<folder>` regardless of how many nested directory wrappers the author included in the zip/7z.
- **Accurate Folder Registration & Cleanup**:
  - Detect the exact name of the extracted server mod folder (e.g. `WTT-ServerCommonLib`) rather than defaulting to an arbitrary name.
  - Never generate empty placeholder folders; only register paths that actually contain installed files.

### 3. Real-Time Progress IPC Bridge & Renderer UI (`electron/preload.cjs` & `src/App.tsx`)
- **Preload Bridge**:
  - Expose `onInstallProgress(callback)` in `window.desktopBridge` to listen for IPC progress events from the main process.
- **Live Percentage Display in UI**:
  - Update `QueueItem` state in `App.tsx` on each progress tick so the user sees live download percentages (e.g., `45% (585 MB / 1.3 GB) • 16.2 MB/s`), followed by decompression and routing status.
  - Display progress in the Queue modal, floating indicator, and status bar.

---

## User Review Required

> [!IMPORTANT]
> - All future installations of large mods (like 1.3 GB weapons/content packs) will stream directly to disk without freezing the application.
> - Mods with `SPT_Runtime`, `BepInEx/patchers`, or non-standard root folders (such as `WTT - CommonLib`) will have all server DLLs, client DLLs, and patchers placed in their respective locations automatically.

---

## Verification Plan

### Automated Verification
- **Compilation Check**: Run `npm run build` (`tsc -b && vite build`) to ensure frontend compilation.
- **Electron Script Syntax**: Verify `electron/main.cjs`, `electron/preload.cjs`, and `electron/modInstaller.cjs` using `node -c`.

### Manual & Behavioral Verification
1. **SPT_Runtime Extraction Test**:
   - Reinstall `WTT - CommonLib` via Blacksite.
   - Verify that `user/mods/WTT-ServerCommonLib` contains `config.jsonc`, `db/`, and `WTT-ServerCommonLib.dll`.
   - Verify that `BepInEx/plugins/WTT-ClientCommonLib` contains the client DLLs and `BepInEx/patchers` contains `FixPluginTypesSerialization.dll`.
2. **Large Mod Streaming & Progress Test**:
   - Install a large mod (e.g. Content Backport or 1GB+ pack).
   - Observe real-time percentage (`0%` to `100%`) and download speed without any UI stutter or window lag.
