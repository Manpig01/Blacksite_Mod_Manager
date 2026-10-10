# Fix: App Emblem Image Loading & Non-Blocking Mod Archive Extraction

Resolve broken application emblem images across desktop titlebar, header, and settings by switching to bundled assets with offline storage persistence, and eliminate 10–20 second UI freezes during large mod installations via non-blocking background extraction with live percentage progress streaming.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions were confirmed with the user:

- **Emblem Loading & Storage**: Bundle the emblem asset directly into the application build, with offline `localStorage` and Electron user-data persistence for custom branding uploads.
- **Decompression Engine**: Offload archive extraction to a non-blocking background child process/worker with real-time percentage progress streaming, preventing main thread event loop stalls.

---

## 1. Overview & Core Concept

- **What It Does**:
  1. **Fixes Application Emblem**: Replaces hardcoded `/emblem.png` absolute root paths (which break in Electron's `file://` protocol) with a bundled asset and a unified `useAppEmblem` hook. Allows drag-and-drop custom emblem uploads that persist instantly offline without requiring an Express server.
  2. **Eliminates Decompression Freezes**: Redesigns the archive extraction subsystem in `electron/modInstaller.cjs` to run completely detached from the Node.js/Electron main event loop. Uses Windows-native multi-threaded engines (`7za.exe` and `System32\tar.exe`) or isolated worker threads, parsing real-time decompression progress to keep the UI buttery smooth.
- **Target Audience**: Single Player Tarkov (SPT) and Fika players installing large mod packs (e.g., WTT-Artem, realism overhauls) on Windows.
- **Key Value**: The application interface remains 100% responsive during massive extractions, and branding/logos render correctly across all views.

---

## 2. User Experience & Visual Design

- **Visual Rendering**:
  - Window Titlebar (`CustomTitleBar.tsx`), Navigation Header (`Header.tsx`), Settings Tab (`EmblemUploader.tsx`), and the Desktop Modal (`WindowsDownloadModal.tsx`) will immediately display the crisp, high-resolution Blacksite emblem without broken image icons.
- **Live Extraction Feedback**:
  - During extraction of large mods (100MB – 2GB+), the bottom status bar and installation queue will display live updating progress (e.g., `Extracting WTT-Artem: 42% (Multi-threaded)...`) instead of stalling at `100% Extracting (balanced mode)...`.
  - The window remains completely draggable, responsive to clicks, and animations continue smoothly.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Bundled Asset Import vs. Relative URL**
  - *Chosen Approach*: Bundle `emblem.png` via Vite (`import defaultEmblem from '../assets/emblem.png'`) combined with `localStorage` fallback for custom user uploads.
  - *Why*: Bundled imports resolve reliably regardless of host, port, or protocol (`file://`, `http://`, `https://`).
  - *Alternatives Considered*: Pure relative `./emblem.png` paths; while better than `/emblem.png`, they can still break with nested hash router routes or varying document base URLs.

- **Decision 2: Non-Blocking Background Extraction vs. Synchronous Fallbacks**
  - *Chosen Approach*: Execute decompression in a dedicated asynchronous child process using Windows 10/11 native `tar.exe` or `7za.exe` with quoted paths, and strictly ban synchronous `AdmZip.extractAllTo` on the main process thread.
  - *Why*: Synchronous decompression in Node.js halts the entire V8 runtime and OS window message loop for 10–20 seconds on large archives.
  - *Alternatives Considered*: Web Workers in renderer; renderer does not have direct filesystem write access to SPT game directories.

- **Decision 3: Real-Time Extraction Progress Streaming**
  - *Chosen Approach*: Stream stdout from the decompression process to extract progress percentages, forwarding updates every 250ms via IPC to the UI.
  - *Why*: Keeps the user informed of active progress rather than appearing stuck.

---

## 4. Technical Architecture & Component Hierarchy

### System Flow & Decompression Pipeline

```
┌────────────────────────────────────────────────────────┐
│               Electron Renderer (React UI)              │
│                                                        │
│   • CustomTitleBar  <──┐                               │
│   • Header          <──┼── useAppEmblem (Bundled Asset │
│   • EmblemUploader  <──┘    + localStorage Offline)    │
│                                                        │
│   • Queue Progress  <── IPC onInstallProgress          │
└──────────────────────────┬─────────────────────────────┘
                           │ ipcRenderer.invoke('mod:install')
                           ▼
┌────────────────────────────────────────────────────────┐
│               Electron Main Process                    │
│             (electron/modInstaller.cjs)                │
└──────────────────────────┬─────────────────────────────┘
                           │ Spawns Non-Blocking Child Process
                           ▼
┌────────────────────────────────────────────────────────┐
│             Decompression Worker / Process             │
│                                                        │
│  1. 7za.exe (Multi-threaded -mmt)                      │
│  2. Windows Native System32/tar.exe (Async libarchive) │
│  3. Async Worker Thread Fallback (Zero main-loop lock) │
│                                                        │
│  ──> Streams real-time % progress back to UI           │
└────────────────────────────────────────────────────────┘
```

### Action Items
1. **Emblem Asset & Unified Hook**:
   - Copy `public/emblem.png` to `src/assets/emblem.png`.
   - Implement `useAppEmblem.ts` hook providing the active emblem, with support for `localStorage` persistence and event dispatching.
   - Update `CustomTitleBar.tsx`, `Header.tsx`, `WindowsDownloadModal.tsx`, and `EmblemUploader.tsx` to consume `useAppEmblem`.
   - Update `EmblemUploader.tsx` to store custom emblems directly into `localStorage` (and sync via Electron IPC if available) without requiring Express `/api/upload-emblem`.
2. **Non-Blocking Extraction Engine**:
   - Refactor `extractArchive` in `electron/modInstaller.cjs`:
     - Fix 7za path quoting (`-o"${destinationDir}"`).
     - Add Windows `tar.exe` non-blocking execution.
     - Replace synchronous `AdmZip.extractAllTo` with async non-blocking execution or worker thread.
     - Stream extraction progress updates (percentage & heartbeat) via `onProgress` during decompression.
3. **Verification**:
   - Run compilation and lint check.
   - Verify dev server build and responsiveness.
