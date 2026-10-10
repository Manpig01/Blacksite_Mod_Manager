# Dedicated 7-Zip Engine Bundling & Archive Decompression Resilience

Fix the desktop mod extraction failure `Error: Unable to extract archive with any available decompression engine` occurring on `.7z` and `.rar` format mods (such as *ISB Aishi* v2.0.2) by embedding a dedicated 7-Zip binary directly into packaged builds, enabling automatic runtime binary extraction from ASAR, and providing clear manual extraction recovery in the UI.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following decisions have been confirmed via clarifying questions:

- **Confirmed Decision 1 (Decompression Packaging)**: Blacksite will use a **Dedicated bundled binary with auto-extraction fallback**. The 7za executable will be bundled directly into application resources and `electron/bin/`, with automatic extraction to `%TEMP%/blacksite-bin/` if executed from inside an ASAR container.
- **Confirmed Decision 2 (Corrupt / Unsupported Archive Handling)**: Blacksite will **Show clear error notification with manual extract option**. If decompression fails due to corruption or password protection, Blacksite will display an informative error modal with direct options to open the downloaded archive folder in Windows Explorer and manually place files into the SPT directory.

---

### 1. Overview & Core Concept

- **What It Does**:
  - Ensures Blacksite Mod Manager can extract all Single Player Tarkov mod archives (`.7z`, `.rar`, `.zip`, `.tar.gz`) across both development environments and packaged Windows distributions (`.exe` / `.asar`).
  - Solves the problem where mods distributed in 7-Zip format fail when Windows `tar.exe` (bsdtar) and `AdmZip` reject non-ZIP headers.
  - Automatically verifies and prepares executable decompression binaries before running extraction commands.
- **Target Audience**: Single Player Tarkov players installing complex weapon, audio, and gameplay mods formatted in `.7z` or `.rar`.
- **Key Value**: 100% install reliability regardless of archive compression format, with no external software prerequisites required from the player.

---

### 2. User Experience & Visual Design

- **Extraction Progress & Live Decompression**:
  - Decompression maintains real-time percentage feedback (`Extracting (7-Zip Multi-core) 45%...`) streamed via stdout without freezing the UI thread.
- **Error Recovery & Manual Extraction Modal**:
  - If an archive cannot be decompressed (e.g., password-protected or corrupt download):
    - Replaces generic error toast with a high-contrast tactical error dialog.
    - Displays: Mod name, file format (`.7z`), file size, and exact error reason.
    - Action buttons:
      - **"Open Download Folder"**: Invokes Electron bridge to open Windows File Explorer directly to the downloaded archive.
      - **"Open SPT Mods Folder"**: Opens `SPT/user/mods` or `SPT/BepInEx/plugins`.
      - **"Retry Download"**: Clears cache and restarts download from mirror.
      - **"Dismiss"**: Closes modal and resets install queue state.
- **Design Tokens & Tactical Aesthetic**:
  - Uses Blacksite dark tactical styling (`bg-zinc-950`, border `border-amber-500/30`, badge `text-amber-400`, buttons with sharp corners and subtle hover glow).

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Direct Binary Bundling vs. Relying on System 7-Zip**
  - *Chosen Approach*: Copy standalone Windows `7za.exe` directly into `electron/bin/win/7za.exe`, include in `package.json` `"files"` and `extraResources`, and unpack on-demand if loaded from `.asar`.
  - *Why*: End users cannot be expected to install standalone 7-Zip or add it to Windows PATH. The self-contained binary is only ~1.2 MB and eliminates 100% of missing decompression engine failures.
  - *Alternatives Considered*: Direct system PATH fallback only (fails on clean Windows installations without 7-Zip).

- **Decision 2: ASAR Unpack & Temp Fallback**
  - *Chosen Approach*: Multi-tier path resolver:
    1. Check `process.resourcesPath/bin/7za.exe` (extraResources).
    2. Check `process.resourcesPath/app.asar.unpacked/...`.
    3. If binary is only accessible inside `app.asar`, read buffer via `fs.readFileSync` and write to `%TEMP%/blacksite-bin/7za.exe` once on startup, then execute.
  - *Why*: `child_process.execFile` cannot execute binary executables located inside an Electron ASAR virtual archive. Extracting to temporary storage guarantees native Windows execution permissions.

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Blacksite Mod Manager                           │
│                                                                        │
│   Download Stream: https://sp-mod.com/mod/download/2478/isb-aishi/...  │
│                                 │                                      │
│                                 ▼                                      │
│               Download Archive to Staging Directory                    │
│                    (e.g., ISB-Aishi-v2.0.2.7z)                         │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │
                                  ▼
           ┌──────────────────────────────────────────────┐
           │        Decompression Engine Resolver         │
           │                                              │
           │  1. Check extraResources / app.asar.unpacked  │
           │  2. Check %TEMP%/blacksite-bin/7za.exe       │
           │  3. Auto-extract 7za.exe from ASAR buffer    │
           │  4. Fallback to System 7-Zip / PATH          │
           └──────────────────────┬───────────────────────┘
                                  │
                 ┌────────────────┴────────────────┐
                 ▼                                 ▼
      [Format is .7z / .rar]              [Format is .zip / .tar]
                 │                                 │
                 ▼                                 ▼
         Run 7za.exe -bsp1                 Run 7za.exe / bsdtar /
         Multi-threaded (-mmt)             chunked AdmZip
                 │                                 │
                 └────────────────┬────────────────┘
                                  ▼
                 ┌─────────────────────────────────┐
                 │    routeExtractedModToSpt()     │
                 │                                 │
                 │  • Server mod -> user/mods      │
                 │  • Client mod -> BepInEx/plugins│
                 └─────────────────────────────────┘
```

#### File Changes Planned:
1. **`electron/bin/win/7za.exe`**: Place the tested x64 `7za.exe` executable into dedicated electron binary store.
2. **`package.json`**:
   - Add `"electron/bin/**/*"` to `build.files`.
   - Add `extraResources: [{ "from": "electron/bin", "to": "bin" }]` to guarantee uncompressed physical files outside ASAR.
3. **`electron/modInstaller.cjs`**:
   - Upgrade `resolve7zaBinary()` to look in `extraResources/bin/`, unpack from ASAR to `%TEMP%/blacksite-bin/7za.exe` if needed, and verify execution rights.
   - Enhance `extractArchive()` error messaging with explicit format diagnostic details and actionable recovery data.
4. **`src/components/ManualExtractModal.tsx` & `src/App.tsx`**:
   - Provide visual recovery modal when decompression cannot proceed, with "Open Download Folder" and "Open SPT Folder" buttons.
