# Implementation Plan: SPT_Runtime Routing, Folder Navigation & Non-Blocking 1.3GB+ Download Streaming

Address exact folder structure requirements for SPT 4.x, resolve the empty folder issue in "Show in Folder", eliminate Electron UI freezing on large (1.3GB+) downloads via direct-to-disk streaming, and display live percentage progress.

---

## Proposed Changes

### 1. Modern SPT 4.x Directory Routing (`electron/modInstaller.cjs`)
- **Server Mods (`SPT_Runtime\user\mods`)**:
  - Dynamically detect whether `<sptDirectory>\SPT_Runtime` exists.
  - Automatically route all server mods into `<sptDirectory>\SPT_Runtime\user\mods` (or `<sptDirectory>\user\mods` if legacy SPT 3.x is used).
  - Handle mods packaged as `user/mods/...` (like Lotus) or `SPT_Runtime/user/mods/...` (like WTT-CommonLib/ServerCommonLib), routing their server components strictly into `SPT_Runtime\user\mods`.
- **Client Mods & Plugins (`SPT\BepInEx`)**:
  - Strictly enforce that `BepInEx` (plugins and patchers) is placed ONLY at root `<sptDirectory>\BepInEx\plugins` and `<sptDirectory>\BepInEx\patchers`.
  - Prevent creation of any erroneous `SPT\SPT_Runtime\BepInEx` folder under any circumstances.
- **Accurate Folder Resolution for "Show in Folder"**:
  - When copying server mod files, detect the actual extracted mod folder name (e.g. `WTT-ServerCommonLib` or `Lotus`).
  - Store the exact relative server path (e.g. `SPT_Runtime/user/mods/WTT-ServerCommonLib` or `SPT_Runtime/user/mods/Lotus`) on the installed mod record.
  - Remove generation of unused empty dummy folders (such as `user\mods\WTT-CommonLib`).
  - When the user clicks the "Show in Folder" folder icon, open the actual populated mod directory in Windows Explorer.

---

### 2. High-Performance Streaming Engine for Large Mods (1.3GB+) (`electron/modInstaller.cjs`)
- **Direct-to-Disk Stream Pipeline**:
  - Replace memory-heavy `response.arrayBuffer()` and synchronous disk writing with a Node.js `fs.createWriteStream()` pipeline.
  - Stream data directly from the network socket into temporary archive files in small chunks (64 KB).
  - Memory consumption remains minimal (< 30 MB) even when downloading 1.3GB+ content packs, completely eliminating V8 memory thrashing, garbage collection stalls, and application freezing.
- **Asynchronous 7-Zip Extraction**:
  - Decompress archives asynchronously with background child processes, avoiding blocking the Node.js event loop during decompression.

---

### 3. Live Download Percentage & Speed Display (`electron/main.cjs`, `electron/preload.cjs`, `src/App.tsx`)
- **IPC Progress Reporting**:
  - Main process calculates `receivedBytes`, `totalBytes`, instantaneous download speed (`MB/s`), and exact percentage (`(receivedBytes / totalBytes) * 100`).
  - Sends throttled progress events (`mod:install-progress`) over IPC every 150ms.
- **Preload Bridge**:
  - Expose `onInstallProgress(callback)` in `window.desktopBridge`.
- **UI Progress Visualization**:
  - Update `QueueItem` state in real time:
    - Downloading stage: displays exact percentage (e.g. `45% (585 MB / 1.3 GB) • 14.8 MB/s`).
    - Extracting stage: displays `Extracting archive...`.
    - Routing stage: displays `Routing to SPT_Runtime...`.
  - Show live progress bars in the status bar, download drawer, and queue modal.

---

## User Review Required

> [!IMPORTANT]
> - Server mods (including Lotus and WTT-ServerCommonLib) will be placed in `SPT\SPT_Runtime\user\mods`.
> - Client plugins and patchers will always stay at root `SPT\BepInEx`.
> - Any existing empty folders created by earlier runs will be cleaned up so clicking "Show in Folder" navigates straight to the active files.

---

## Verification Plan

### Automated Verification
- Run `npm run build` (`tsc -b && vite build`) to confirm clean compilation.
- Validate Node.js syntax with `node -c electron/main.cjs electron/preload.cjs electron/modInstaller.cjs`.

### Functional Verification
1. **Directory Structure Verification**:
   - Install Lotus: verify files reside in `<sptDirectory>\SPT_Runtime\user\mods\Lotus`.
   - Install WTT - CommonLib: verify server files reside in `<sptDirectory>\SPT_Runtime\user\mods\WTT-ServerCommonLib` and client files in `<sptDirectory>\BepInEx\plugins\WTT-ClientCommonLib`.
   - Confirm no `SPT\SPT_Runtime\BepInEx` is created.
2. **Show in Folder Action**:
   - Click the folder icon on Lotus and WTT - CommonLib; verify Windows Explorer opens directly to the populated folder.
3. **1.3GB+ Streaming & Progress**:
   - Queue a large mod download; verify real-time percentage progress (`0% -> 100%`) and download speed without any window stutter or lag.
