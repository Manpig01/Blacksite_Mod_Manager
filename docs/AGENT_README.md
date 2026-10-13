# Blacksite Mod Manager (v2.1.0) — Architecture & Agent Reference Guide

> **Target Audience:** Google Antigravity Agent (`antigravity-preview-09-2026`), autonomous code-assist agents, and human core developers.
> **Repository:** `Manpig01/Blacksite_Mod_Manager-TEST`  
> **Application Version:** `2.1.0`  
> **Platform Target:** Windows x64 (Desktop Electron), Cross-platform Web preview (React / Vite)  
> **Domain:** Mod orchestration, dependency resolution, conflict management, and live server monitoring for **Single Player Tarkov (SPT)** and **Fika Co-op**.

---

## 1. Executive Summary & Purpose

**Blacksite Mod Manager** is a next-generation desktop management suite for Single Player Tarkov (SPT). It bridges the gap between the official mod repository (**The Forge** at `sp-mod.com`) and local disk operations across SPT 3.8.x through 4.x.

Key challenges this project solves:
1. **Consolidated Architecture**: Unifying Server mods (`SPT_Runtime/user/mods` or `user/mods`) and Client mods (`BepInEx/plugins`) under single unified management cards.
2. **First-Class Addons Ecosystem**: Direct integration with the Forge Addons API (`sp-mod.com/api/v0/addons`), tracking parent-child mod relationships and dependency constraints.
3. **Multi-Threaded Decompression Without Freezes**: Handling multi-gigabyte `.7z`, `.zip`, and `.rar` archives with live byte streaming and zero electron renderer thread starvation.
4. **Resilient Offline Operation**: High-performance multi-tier image caching (memory LRU + IndexedDB) and offline catalog fallbacks.
5. **Windows 11 (24H2/25H2) Stability**: Electron 34 runtime with pre-boot GPU and DACL sandbox bypass switches.

---

## 2. Technical Stack & Runtime Environments

| Subsystem | Technology | Purpose & Constraints |
| :--- | :--- | :--- |
| **Desktop Runtime** | Electron `^34.5.8` (Chromium 132 / Node 22) | Native OS integration, filesystem access, process spawn, IPC bridge |
| **Frontend Framework** | React `19.0.0` (TypeScript) | Declarative UI, state management, virtualization |
| **Bundler & Tooling** | Vite `^6.2.0`, `@tailwindcss/vite` | Rapid HMR in dev, optimized Rollup bundling in production |
| **Styling & Design System** | Tailwind CSS v4 | Tactical Carbon Operator aesthetic (`#121418` dark carbon, `#EA580C` hazard orange) |
| **Icons & Visuals** | `lucide-react` | Semantic HUD status and control icons |
| **Decompression Core** | Bundled `7za` binary (`16.02` / `7zip-bin`), Node `child_process`, `AdmZip` | High-speed multi-threaded `.7z`, `.zip`, `.rar`, `.tar.gz` extraction |
| **Packaging Engine** | `electron-builder` (`25.1.8`) | Produces Windows NSIS Setup Installer (`.exe`), Standalone ZIP, and Portable standalone (`.exe`) |
| **CI / CD Pipeline** | GitHub Actions (`windows-latest`) | Automated compilation, checksum verification (`SHA256SUMS.txt`), and Release publishing |

---

## 3. High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ELECTRON MAIN PROCESS (main.cjs)                      │
│  - Chromium pre-boot switches (--no-sandbox, --disable-gpu-sandbox)         │
│  - Single Instance Lock (requestSingleInstanceLock)                         │
│  - Crash Reporter & Diagnostic Logger (%LOCALAPPDATA%\...\crash.log)        │
│  - IPC Channel Hub ('bridge:*', 'mod:*', 'server:*', 'window:*')            │
└───────────────▲─────────────────────────────────────────────▲───────────────┘
                │ IPC Events / Messages                       │ IPC Invocations
┌───────────────▼──────────────────────────┐    ┌─────────────▼───────────────┐
│       RENDERER PROCESS (React 19)        │    │    NATIVE WORKERS / FS      │
│  - App.tsx (Root State Orchestrator)     │    │  modInstaller.cjs:          │
│  - Tabs: Catalog, Addons, Installed,     │    │   - streamDownloadToFile()  │
│          Profiles, Config, Server Logs   │    │   - extractArchive() (7za)  │
│  - Services:                             │    │   - routeToSpt()            │
│      * apiService.ts (Live Forge Sync)   │    │   - backupConfigs()         │
│      * bridgeService.ts (IPC / Fallback) │    │   - deepUninstall()         │
│      * addonCacheService.ts (IndexedDB)  │    │  serverProcess / sptLaunch  │
└──────────────────────────────────────────┘    └─────────────────────────────┘
```

---

## 4. Key Files & Repository Map

```
.
├── .github/
│   └── workflows/
│       ├── build.yml                 # Main CI: Compiles React, packages NSIS/Portable, releases tag
│       └── release.yml               # Production release pipeline with SHA256 checksum generation
├── docs/
│   ├── SPT_HUB_DESCRIPTION.md        # Official SPT Hub release documentation
│   └── AGENT_README.md               # This document (Antigravity & Agent Knowledge Base)
├── electron/
│   ├── main.cjs                      # Main process: lifecycle, IPC handlers, crash logger, window controls
│   ├── preload.cjs                   # Context bridge: exposes window.electronBridge to renderer
│   ├── modInstaller.cjs              # Core engine: downloads, 7z extraction, layout routing, config backup
│   └── bin/
│       ├── win/7za.exe               # Precompiled Windows x64 7-Zip standalone executable (1.2 MB)
│       ├── linux/7za                 # Precompiled Linux x64 7-Zip binary
│       └── mac/7za                   # Precompiled macOS 7-Zip binary
├── public/
│   ├── app.ico                       # High-resolution multi-size Windows application icon (16x16 to 256x256)
│   └── emblem.png                    # Tactical branding badge
├── src/
│   ├── App.tsx                       # Root view, active tab state, global toast provider, modals
│   ├── types.ts                      # Universal domain interfaces (Mod, Addon, Conflict, Profile, etc.)
│   ├── components/
│   │   ├── AddonsTab.tsx             # Complete Forge Addons browser, parent filtering, live search
│   │   ├── AddonDependencyPromptModal.tsx # Smart parent mod dependency installer prompt
│   │   ├── ModCard.tsx               # Unified mod card (consolidated client + server display)
│   │   ├── InstalledModsTab.tsx      # Installed mods list, conflict banners, bulk updates, enable/disable
│   │   ├── ModConfigEditorModal.tsx  # In-app JSON/CFG syntax editor with timestamped backup rotation
│   │   ├── ConflictResolverModal.tsx # Duplicate client DLL and package ID collision resolver
│   │   ├── SptLauncherModal.tsx      # Server orchestrator HUD with real-time stdout streaming
│   │   ├── CustomTitleBar.tsx        # Frameless window titlebar with minimize, maximize, close controls
│   │   └── WindowsDownloadModal.tsx  # In-app desktop installer & portable download guide
│   ├── services/
│   │   ├── apiService.ts             # REST client for sp-mod.com (mods, addons, versions, search, sort)
│   │   ├── bridgeService.ts          # Desktop Electron IPC bridge with browser-mode fallback emulation
│   │   └── addonCacheService.ts      # Multi-tier LRU memory + IndexedDB image & catalog persistence
│   └── data/
│       └── fixtureCatalog.ts         # Bundled offline fallback catalog for zero-connectivity situations
├── package.json                      # Dependency manifests, scripts, build configuration
├── vite.config.ts                    # Vite configuration, proxy routes, React plugin
└── README.md                         # Primary user-facing GitHub documentation
```

---

## 5. Domain Logic & Core Workflows

### 5.1 SPT Directory Layout Routing

Blacksite automatically detects the SPT version layout and routes mod files safely:

```
<SPT Root Directory>
│
├── BepInEx/
│   └── plugins/
│       ├── spt/                 <-- PROTECTED CORE (Strictly write-protected, never deleted)
│       ├── ModAuthor-Plugin/    <-- Managed Client Plugin (Folder-based)
│       └── StandaloneMod.dll    <-- Managed Client Plugin (Direct DLL)
│
├── SPT_Runtime/                 <-- Modern SPT 4.x Layout Engine
│   └── user/
│       └── mods/
│           └── ServerMod-1/     <-- Managed Server Mod
│
├── user/                        <-- Legacy SPT 3.x Layout Engine
│   └── mods/
│       └── ServerMod-1/     <-- Managed Server Mod
│
└── EscapeFromTarkov_Data/       <-- Game Root Overlays
```

**Critical Invariant:** Client plugins and patchers **ALWAYS** belong at `<Root>/BepInEx/plugins`. Never create `<Root>/SPT_Runtime/BepInEx`.

### 5.2 Archive Decompression Architecture (`modInstaller.cjs`)

Large mod archives (up to multiple gigabytes) are handled through a resilient multi-tier engine:

1. **`resolve7zaBinary()`**:
   - Searches unpacked ASAR directories (`app.asar.unpacked/electron/bin/win/7za.exe`).
   - Checks `extraResources` copied to `resources/bin/win/7za.exe`.
   - Extracts from virtual ASAR to `%APPDATA%\Blacksite Mod Manager\bin\7za.exe` if needed.
   - Falls back to system installs (`C:\Program Files\7-Zip\7z.exe`, Scoop, Chocolatey, `PATH`).
2. **Decompression Execution**:
   - Spawns `7za x archivePath -y -aoa -o{cleanDest} -bsp1 -mmt={threads}`.
   - Treats exit code `1` as non-fatal warning (retains extracted files if attributes/symlinks warned).
   - If relative extraction fails, retries with `-spf`.
   - Captures stdout progress strings (`(\d+)%`) and streams progress to renderer without UI freezing.
3. **Format Detection**:
   - Inspects file magic bytes (ZIP: `PK..`, 7Z: `7z¼¯'`, RAR: `Rar!`, GZIP: `0x1F, 0x8B`).
   - Renames file extension before extraction if downloaded payload lacked proper extension.

### 5.3 Addons Hub & Dependency Tracking

The Addons system (`src/components/AddonsTab.tsx` and `src/services/apiService.ts`):
- Connects directly to `https://sp-mod.com/api/v0/addons?include=mod,versions`.
- Translates sorting queries to upstream API standards (`-downloads`, `-created_at`, `name`).
- Normalizes authors, parent mod references, thumbnails, and version constraints.
- When a user installs an addon, checks if the parent mod (`addon.mod.id`) is already installed.
- If missing, launches `AddonDependencyPromptModal` allowing the user to install the parent base mod with 1 click.

### 5.4 High-Fidelity Addon Image Caching (`addonCacheService.ts`)

- **Resolution Hierarchy**: Addon thumbnail → Parent mod banner (`addon.mod.thumbnail_url`) → Category fallback SVG.
- **Proxy Failover**: Cycles through direct URL, image proxy, and fallback URLs to bypass CORS restrictions.
- **Persistent Storage**: Uses client-side **IndexedDB** (`blacksite-addon-images` database) and in-memory LRU cache so thumbnails remain accessible offline.

---

## 6. How the Antigravity Agent Can Assist This Project

When Google Antigravity Agent or autonomous coding agents assist on this repository, focus on:

1. **Automated Testing & Mod Archive Fixtures**:
   - Add automated integration tests in `tests/` verifying `modInstaller.cjs` against sample ZIP, 7Z, and RAR archives.
   - Test folder-based BepInEx plugins vs standalone DLL placement.
2. **Offline Mode & Sync Resilience**:
   - Expand `fixtureCatalog.ts` caching to periodically persist live Forge responses into local storage.
   - Enhance the conflict detection algorithm for complex circular mod dependencies.
3. **Fika Dedicated Server Automation**:
   - Extend the server orchestrator in `SptLauncherModal.tsx` to handle Fika Headless Server profiles, auto-restarting on crashes and tracking connected peer latencies.
4. **Configuration Schema Validation**:
   - Provide JSON schema validation for popular mod configuration files in `ModConfigEditorModal.tsx`.

---

## 7. Developer Cheat Sheet & Commands

```bash
# Install dependencies
npm install

# Run Vite dev server on port 3000
npm run dev

# TypeScript type check
npm run lint

# Compile production React bundle
npm run build

# Package Windows desktop binaries (NSIS setup & Portable exe)
npm run package:win

# Test mod installer script syntax
node -c electron/modInstaller.cjs
node -c electron/main.cjs
```

---

*This guide was generated for Blacksite Mod Manager v2.1.0 to facilitate rapid context assimilation by AI coding engines and maintainers.*
