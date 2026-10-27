# Blacksite Mod Manager — Security, Reliability & Architecture Hardening Plan

This plan hardens Blacksite Mod Manager across archive decompression, HTTPS downloads, SPT 3.x/4.0/4.1 layout detection, VFS hardlink config isolation, Electron sandboxing and IPC boundaries, CI/CD reproducibility, and API rate-limit handling while preserving the existing tactical UI and workflows.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions incorporate your confirmed preferences from Phase 1:

- **Confirmed Decision 1 — Resource Limits for Downloads & Extraction**: Enforce default safety caps of **8 GB maximum download size**, **20 GB maximum uncompressed archive output**, **100,000 maximum files per archive**, and a **200:1 compression ratio ceiling** (for archives > 10 MB) so large overhaul mods succeed while zip-bombs and runaway streams abort cleanly with partial outputs purged.
- **Confirmed Decision 2 — Regression Test Runner**: Use Node.js’s built-in `node:test` and `node:assert/strict` runner against isolated temporary directories (`os.tmpdir()`), adding zero external test dependencies and guaranteeing the user's real SPT installation is never touched.
- **Confirmed Decision 3 — Ambiguous / Duplicate SPT Server Layouts**: Prioritize actual SPT binary and version evidence (`3.x` -> `user/mods`, `4.0.x` -> `SPT/user/mods`, `4.1.x+` -> `SPT_Runtime/user/mods`). When an installation is ambiguous or contains duplicate mod folders across multiple layouts, preserve the user's configured path and surface a clear warning toast identifying the duplicate/ambiguous paths rather than silently switching folders based on directory count.

---

## 1. Overview & Core Concept

- **What It Does**: Upgrades the desktop mod installer, VFS deployment engine, Electron security boundary, and Forge API client to fail closed against untrusted archives, unverified TLS certificates, protocol downgrades, and hardlink config corruption.
- **Target Audience / Persona**: Single Player Tarkov (SPT 3.x, 4.0, and 4.1) players and modpack maintainers managing large mod loadouts on Windows desktops.
- **Key Value**: Eliminates path traversal (`-spf` / Zip-Slip / ADS / symlinks) and MITM download risks, prevents in-place config edits from mutating the immutable VFS depot, protects all SPT layout variants during install/uninstall, and ensures deterministic builds.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  - **Safe Mod Download & Extraction**: When a mod is queued, the installer validates HTTPS URLs and redirects, enforces the 8 GB stream cap in real time, pre-inspects archive entries before extraction, and unpacks into an isolated staging directory before VFS deployment. If an archive violates path safety or resource limits, staging is wiped immediately and a clear diagnostic toast/modal explains the exact reason.
  - **SPT Directory Detection & Duplicate Reporting**: Selecting or rescanning an SPT root inspects server executables (`SPT.Server.exe`, `Aki.Server.exe`) and version metadata (`core.json`, `package.json`, core DLLs) to select `user/mods` (3.x), `SPT/user/mods` (4.0), or `SPT_Runtime/user/mods` (4.1). If duplicate mod folders exist across layouts or the layout is ambiguous, the user's configured path is preserved and a warning toast lists the detected duplicates.
  - **True Dual-Mod (`Both`) Classification & Folder Opening**: Mods display the dual-folder `2` badge only when both server and client paths are genuinely observed. Legacy synthetic dual paths in `localStorage` are conservatively migrated on startup using separator-normalized checks, and folder buttons dynamically reflect the active server/client paths.
- **Visual Identity & Theme**:
  - Preserves the existing tactical dark/light theme (`#121418` background, `#181B20` cards, `#EA580C` tactical orange accents, monospace telemetry badges) with zero visual regressions.
- **Interactive Feedback & Motion**:
  - Real-time download/extraction progress bars, clear TLS/archive security error states, and warning toasts for duplicate layout folders or rate-limit backoffs.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Pre-Extraction Archive Manifest Validation & Removing `-spf`**
  - *Chosen Approach*: Remove the `7za -spf` retry completely. Before extracting with 7-Zip, `tar`, PowerShell, or AdmZip, list and validate every archive entry header (`7za l -slt`, `tar -tvf`, or zip central directory inspection). Reject any archive containing absolute paths, drive-letter prefixes (`C:`), UNC paths (`\\`), parent traversal (`..`) after slash normalization, Windows Alternate Data Streams (`:`), or symlink/reparse attributes, and verify total uncompressed size (<= 20 GB), file count (<= 100,000), and compression ratio.
  - *Why*: Fail-closed pre-validation prevents any engine (especially PowerShell `Expand-Archive` or `tar`) from writing a single byte outside the staging directory before failing.
  - *Alternatives Considered*: Post-extraction cleanup or skipping bad entries in AdmZip was rejected because dangerous files or symlinks could already touch disk or leave partial broken installs.

- **Decision 2 — Strict TLS & HTTPS-Only Redirect Chain**
  - *Chosen Approach*: Remove `rejectUnauthorized: false` and `checkServerIdentity: () => undefined` from `downloadViaNodeHttp`. Validate every URL and redirect hop via `new URL()` to enforce `https:` (unless an explicit insecure flag is opted into), block HTTPS-to-HTTP downgrades, enforce the 8 GB byte counter during streaming, and unlink partial files on any failure or abort.
  - *Why*: Prevents silent MITM downgrade attacks and corrupted partial archives on disk.

- **Decision 3 — Hybrid VFS Deployment (Hardlink Immutable Binaries, Copy Mutable Configs)**
  - *Chosen Approach*: Keep zero-copy NTFS hardlinks (`fs.promises.link`) for immutable assets (`.dll`, `.bundle`, `.db`, media, read-only scripts), while always deploying mutable files (`.json`, `.jsonc`, `.cfg`, `.ini`, `.xml`, `.txt`, `.log`, and any file inside `config/`, `configs/`, `cfg/`, or `BepInEx/config/`) via independent file copies (`fs.promises.copyFile` / `writeFile`).
  - *Why*: Hardlinking config files causes in-game or editor changes to mutate the canonical copy inside `.blacksite_library`, corrupting clean reinstalls and profile switches.

- **Decision 4 — Sandboxed Renderer & Validated IPC Bridge**
  - *Chosen Approach*: Enable `sandbox: true` in `BrowserWindow`, remove Node `require('os')` fallback from `preload.cjs` (using standard `navigator.hardwareConcurrency`), validate `event.senderFrame` origin and top-frame identity on every `ipcMain.handle` call, validate IPC payloads with strict runtime guards, and enforce a Content Security Policy (CSP) header for both dev and packaged modes.
  - *Why*: Prevents untrusted mod metadata or remote content from escalating privileges if a renderer vulnerability occurs.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Security Boundary Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   Renderer Process (React 19 + TypeScript)                  │
│  ┌────────────────────┐  ┌──────────────────────┐  ┌─────────────────────┐  │
│  │ RateLimitedClient  │  │ Storage & Migration  │  │  UI Tabs & Modals   │  │
│  │ • Abort-aware queue│  │ • Conservative dual  │  │ • Dynamic path      │  │
│  │ • Retry-After parse│  │   path sanitization  │  │   labels & toasts   │  │
│  │ • Capped backoff   │  │ • True Both only     │  │ • Duplicate alerts  │  │
│  └─────────┬──────────┘  └──────────┬───────────┘  └──────────┬──────────┘  │
└────────────┼────────────────────────┼─────────────────────────┼─────────────┘
             │ HTTPS (CSP Enforced)   │ localStorage            │
             ▼                        ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│               ContextBridge Preload (sandbox: true, no Node APIs)           │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │ Validated IPC (Sender + Schema Guards)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Electron Main Process (Node.js CJS)                     │
│                                                                             │
│  ┌──────────────────────────────┐       ┌────────────────────────────────┐  │
│  │   Secure Download Streamer   │       │  SPT Layout & Version Engine   │  │
│  │ • Strict TLS verification    │       │ • Evidence-based layout choice │  │
│  │ • HTTPS redirect validation  │       │   3.x -> user/mods             │  │
│  │ • 8 GB live stream cap       │       │   4.0 -> SPT/user/mods         │  │
│  │ • Partial file cleanup       │       │   4.1 -> SPT_Runtime/user/mods │  │
│  └──────────────┬───────────────┘       │ • Ambiguity & duplicate report │  │
│                 │                       └───────────────┬────────────────┘  │
│                 ▼                                       │                   │
│  ┌──────────────────────────────┐                       ▼                   │
│  │  Fail-Closed Archive Guard   │       ┌────────────────────────────────┐  │
│  │ • No -spf flag               │──────▶│   Transactional VFS Deployer   │  │
│  │ • Pre-list entry validation  │       │ • Hardlink immutable binaries  │  │
│  │ • 20 GB / 100k files / ratio │       │ • Copy & merge mutable configs │  │
│  │ • Isolated staging + wipe    │       │ • Multi-layout safe uninstall  │  │
│  └──────────────────────────────┘       └────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State Strategy

- **Archive & Download Safety Limits**:
  - `MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024 * 1024` (8 GB)
  - `MAX_EXTRACTED_BYTES = 20 * 1024 * 1024 * 1024` (20 GB)
  - `MAX_ARCHIVE_FILES = 100_000`
  - `MAX_COMPRESSION_RATIO = 200` (applied when uncompressed total > 10 MB)
- **Evidence-Driven SPT Layout Selection**:
  1. Inspect server binary (`SPT_Runtime/SPT.Server.exe`, `SPT/SPT.Server.exe`, `SPT.Server.exe`, `Aki.Server.exe`) and version strings (`core.json`, `package.json`, `spt-core.dll`).
  2. Map verified version/binary directly:
     - SPT `4.1.x+` or `SPT_Runtime/SPT.Server.exe` -> `SPT_Runtime/user/mods`
     - SPT `4.0.x` or `SPT/SPT.Server.exe` -> `SPT/user/mods`
     - SPT `3.x` or `Aki.Server.exe` -> `user/mods`
  3. If multiple server mod directories exist on disk or version evidence is ambiguous, record `ambiguousLayouts` and `duplicateMods` in the inspection/scan payload so the UI preserves the user's configured path and displays a clear warning toast.
- **Uninstall Coverage Across All Layouts**:
  - `uninstallAllMods` and `uninstallMod` cover `SPT_Runtime/user/mods`, `SPT/user/mods`, and `user/mods`, plus `BepInEx/plugins` and `BepInEx/patchers`, validating every path with `assertSafeSptTarget` and `isProtectedCoreItem` and returning `{ deletedCount, skippedProtected, failedRemovals }`.
- **CI/CD Workflow Reproducibility**:
  - Retain `package-lock.json` and use `npm ci --include=optional` in `.github/workflows/build.yml`.
  - Add concurrency control (`concurrency: { group: release-windows-${{ github.ref }}, cancel-in-progress: false }`) to prevent overlapping runs from racing on the `v2.1.0-latest` tag, and scope job permissions cleanly without publishing or modifying any GitHub release during this task.
- **API Queue & Main-Process Non-Blocking Scans**:
  - Update `RateLimitedClient` in `apiService.ts` so queued requests listen to their `AbortSignal` while waiting in the queue (removing themselves immediately without consuming a slot when aborted), parse both integer seconds and HTTP-date formats in `Retry-After`, and cap backoff delay (e.g. max 30s).
  - Convert synchronous file reads/scans in `scanInstalledMods` and `discoverConfigFilesInDir` to non-blocking `fs.promises` calls so scanning large mod folders does not freeze the Electron main event loop.
