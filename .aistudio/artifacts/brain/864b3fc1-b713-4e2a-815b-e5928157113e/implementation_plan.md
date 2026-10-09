# Blacksite: Batch Mod Updater, Nav Cleanup & Deep Disk Uninstall Plan

A comprehensive plan to remove the Analytics tab from the top navigation, introduce a dedicated 1-Click Batch Mod Updater for outdated mods, and fix the Uninstall and Uninstall All operations so that all client plugins (both folder-based and standalone DLLs) and server mods are completely removed from disk while safely safeguarding SPT core system files.

## User Review & Critical Decisions

> [!IMPORTANT]
> **Summary of Confirmed User Decisions**
> - **Navigation Bar Layout**: The Analytics tab is completely removed from the top navigation bar without adding an extra replacement tab, leaving a cleaner, focused 4-tab workflow: **Browse Mods**, **Installed Mods**, **Modpack Tools**, and **Settings**.
> - **New Feature**: Added a **1-Click Batch Mod Updater** accessible directly from the Installed Mods toolbar and multi-select action bar. It checks for updates, identifies all mods with available new releases compatible with the user's SPT version, and updates them in a single batch with config preservation and real-time progress.
> - **Deep Uninstall Fix**: Resolves the issue where files in `BepInEx/plugins/` (such as `DrakiaXYZ-Waypoints`, `mpstark-dynamicmaps`, `DynamicMaps-Extended`, `UnityToolkit`, etc.) remained on disk after uninstalling. We expand disk scanning to detect directory-based client plugins, track all installed files per mod, and provide a deep purge routine for "Uninstall All" that cleans all user mods while strictly safeguarding the SPT core system files (e.g. `BepInEx/plugins/spt/`).

---

## 1. Overview & Core Concept

- **What It Does**:
  1. Streamlines the desktop application header by removing the unused Analytics view.
  2. Empowers users with a 1-Click Batch Mod Updater: automatically detects all outdated installed mods, reviews target versions, and updates them sequentially with live progress and automatic config preservation.
  3. Overhauls the uninstallation engine: properly detects directory-based client plugins (which make up the majority of modern BepInEx mods), tracks full path manifests, and ensures that single uninstall and "Uninstall All" wipe every mod file from `BepInEx/plugins/` and `user/mods` without touching SPT core engine files.
- **Target Audience**: Single-Player Tarkov (SPT) players managing complex mod lists with dozens of server overhauls and BepInEx client plugins.
- **Key Value**: Eliminates manual version updating chore, keeps the UI clutter-free, and restores complete confidence that uninstalled mods leave zero orphan files or broken DLLs behind.

---

## 2. User Experience & Visual Design

### Key User Flows

#### Flow 1: 1-Click Batch Mod Updater
1. User navigates to **Installed Mods**.
2. If one or more mods have updates available (e.g., `updateCount > 0`), a high-visibility, tactical orange button appears: **Update All (N)** alongside **Check for Updates**.
3. Clicking **Update All** opens the **Batch Mod Updater Modal**:
   - Displays a list of mods to be updated with their current installed version $\rightarrow$ target latest version.
   - Shows a badge indicating **Config-Safe** (preserves `.json` / `.cfg` settings).
   - "Start Batch Update" button triggers automated updates with individual progress bars, status indicators (Queued $\rightarrow$ Downloading $\rightarrow$ Extracting $\rightarrow$ Complete), and speed metrics.
   - In multi-select mode, users also have an **Update Selected (N)** action.
4. When finished, a confirmation notification confirms all mods are now on their latest versions, and the update badge disappears.

#### Flow 2: Cleaned Top Navigation
- The top header renders strictly:
  - **Browse Mods** (`Compass` icon)
  - **Installed Mods** (`HardDrive` icon + count badge + conflict indicator)
  - **Modpack Tools** (`Boxes` icon)
  - **Settings** (`Settings` text)
- Zero residual analytics state, unneeded chart imports, or dead tab references.

#### Flow 3: Thorough Mod Uninstall & Complete Purge
1. **Single Mod Uninstall**:
   - When the user clicks the trash icon on any mod (e.g., `DrakiaXYZ-Waypoints`), Blacksite resolves both its server path (if any) and its client path—whether it is a standalone `.dll` file (`Liquidwarp.ArmorExpert.dll`) or a full folder (`BepInEx/plugins/DrakiaXYZ-Waypoints/`).
   - Recursively deletes the entire folder and any disabled variants (`.disabled`).
   - Removes the entry from state and disk cache.
2. **Uninstall All (Deep Purge)**:
   - Clicking **Uninstall All** prompts for explicit confirmation.
   - Communicates with the desktop bridge to execute `uninstallAllMods`:
     - Clears all server mods in `user/mods/` and `SPT_Runtime/user/mods/`.
     - Clears all non-core mod folders and mod `.dll` files in `BepInEx/plugins/`.
     - Explicit whitelist protection prevents touching SPT core directory (`spt/`), SPT core DLLs, or BepInEx internal system files.
     - Resets the UI installed mods table and clears local persistence.

### Visual Identity & Theme
- **Color Tokens**:
  - Dominant Neutral: Dark carbon `#121418` and surface panel `#181B20`.
  - Borders & Hairlines: Subdued slate `#2A2F38` and active border `#353C47`.
  - Tactical Accent: Orange `#EA580C` / `#F97316` for update CTAs and batch actions.
  - Warning/Danger: Crimson `#DC2626` / `#EF4444` for uninstall actions and purge confirmations.
- **Typography & Layout**:
  - Clean typographic hierarchy using tabular numbers (`font-mono tabular-nums`) for versions, download speeds, and file counts.
  - No decorative pills or fake code comments; clean inline status text.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Folder vs. DLL Detection in `BepInEx/plugins`
- **Chosen Approach**: Scan both `.dll` files directly in `BepInEx/plugins` AND first-level subdirectories (excluding protected system folders like `spt`). For each subfolder, detect its name, check for bundled `.dll` assemblies, extract assembly metadata/version if available, and register it as a full folder client mod.
- **Why**: Most modern SPT client mods (like `DrakiaXYZ-Waypoints`, `mpstark-dynamicmaps`, `UnityToolkit`, `WTT-ClientCommonLib`) install as self-contained subdirectories inside `BepInEx/plugins/`. The previous scanner only looked for top-level `.dll` files, making folder mods invisible to the manager.
- **Alternatives Considered**: Only tracking files placed during Blacksite installations. Rejected because users often have pre-existing mods or manually extract mods into their folder.

### Decision 2: Core SPT Protection Whitelist
- **Chosen Approach**: When performing bulk uninstall or unlinking client plugins, strictly protect:
  - Any folder matching `spt` (case-insensitive)
  - Any file or directory starting with `spt.` or `spt-`
  - Any BepInEx internal directory (e.g. `core`, `config`)
- **Why**: Single-Player Tarkov installs its own essential bridge plugin inside `BepInEx/plugins/spt/`. Deleting that would break the game installation.

### Decision 3: 1-Click Batch Updater Execution Model
- **Chosen Approach**: Implement an automated queue executor that loops through selected outdated mods, retrieves their latest compatible release via `apiService`, calls the streaming installation bridge, and updates the local state sequentially with animated progress.
- **Why**: Sequential updates avoid saturating disk I/O or triggering race conditions in BepInEx directories, while providing clear, transparent feedback for each mod being updated.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                               Header                                   │
│  [Browse Mods]   [Installed Mods (12)]   [Modpack Tools]   [Settings]  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        InstalledModsTab View                           │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Toolbar: [Check for Updates] [Update All (3)] [Uninstall All]... │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Multi-Select Bar: [Select All] [Update Selected (X)] [Export]...  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Mod Cards List (Folder & DLL Client Mods + Server Mods)          │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└───────────────────┬─────────────────────────────────┬──────────────────┘
                    │                                 │
                    ▼                                 ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────┐
│       BatchModUpdateModal            │  │   Desktop Bridge / Disk IPC  │
│ - Outdated mod preview & versions    │  │ - scanInstalledMods (dirs+dll│
│ - Progress per mod (0-100%)          │  │ - uninstallMod (clean paths) │
│ - Sequential safe installation       │  │ - uninstallAllMods (purge)   │
│ - Config preservation guarantee      │  │ - SPT Core whitelist guard   │
└──────────────────────────────────────┘  └──────────────────────────────┘
```

### Data Model & State Changes
1. **Remove `analytics` from Navigation**:
   - `activeTab`: `'browse' | 'installed' | 'modpacks' | 'settings'`
   - Remove `<AnalyticsTab />` and unused analytics imports in `src/App.tsx`.
2. **Batch Update State in `InstalledModsTab`**:
   - `isBatchUpdateOpen: boolean`
   - `batchUpdateQueue: InstalledMod[]`
   - `batchProgress: Record<string, { stage: string; percent: number }>`
3. **Enhanced Disk Scanner (`scanInstalledMods` in `electron/modInstaller.cjs`)**:
   - Scans subfolders in `BepInEx/plugins/` (excluding `spt`), sets `clientPath: 'BepInEx/plugins/<FolderName>'`.
   - Scans root `.dll` files in `BepInEx/plugins/`, sets `clientPath: 'BepInEx/plugins/<FileName>.dll'`.
4. **Enhanced Uninstall Operations**:
   - `uninstallMod`: Resolves whether `clientPath` is a directory or file; recursively deletes directory or file and any `.disabled` counterparts.
   - `uninstallAllMods`: Dedicated IPC call that removes all server mod directories in `user/mods` and `SPT_Runtime/user/mods`, plus all non-whitelisted client plugin folders and DLLs in `BepInEx/plugins`.

---

## Verification Plan

### Automated Verification
- Run `compile_applet` to verify TypeScript types, component interfaces, and clean build.
- Run `lint_applet` to verify syntax and code standards.

### Functional Verification
1. **Top Navigation**: Verify only 4 tabs exist (Browse Mods, Installed Mods, Modpack Tools, Settings).
2. **Deep Plugin Detection**: Verify that folder-based client plugins in `BepInEx/plugins` (like `DrakiaXYZ-Waypoints`, `mpstark-dynamicmaps`, etc.) are recognized in the installed list with accurate client paths.
3. **Uninstall Single Mod**: Confirm uninstalling a folder-based or DLL client mod completely removes its folder/file from `BepInEx/plugins`.
4. **Uninstall All (Deep Purge)**: Confirm "Uninstall All" cleans out mod folders and DLLs in `user/mods` and `BepInEx/plugins` while preserving `BepInEx/plugins/spt/`.
5. **1-Click Batch Mod Updater**:
   - Trigger "Check for Updates" to simulate/fetch outdated mods.
   - Click "Update All" to launch the Batch Mod Updater modal.
   - Verify progress updates through downloading, extraction, and completion.
   - Verify all updated mods show up-to-date status.
