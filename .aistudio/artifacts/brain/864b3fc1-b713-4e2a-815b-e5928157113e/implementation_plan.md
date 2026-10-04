# Uncapped Turbo Max Mod Extraction Architecture

High-throughput, zero-limitation decompression and parallel disk routing architecture for Blacksite Mod Manager, maximizing CPU core saturation and extraction throughput for massive Single Player Tarkov mod installations.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following technical choices were confirmed during Phase 1 clarification:
> - **Turbo Max Execution Profile**: **All CPU Cores with High Process Priority** (`os.constants.priority.PRIORITY_HIGH`, `-mmt={totalCores}` with zero core reservations, yielding maximum hardware extraction speed).
> - **Default Setting**: **Keep Balanced as default (`N - 2` cores) and allow switching in Settings**, giving users full tactical control to engage Turbo Max when rapid installations are required.

- **Confirmed Decision 1**: Uncapped multi-threaded 7-Zip worker process allocating 100% of logical CPU cores (`os.cpus().length`) when Turbo Max is active.
- **Confirmed Decision 2**: Windows process priority class elevated to `High` (`PRIORITY_HIGH`), instructing the OS kernel scheduler to prioritize mod extraction threads ahead of standard background tasks.
- **Confirmed Decision 3**: Batch-parallelized asynchronous disk routing (`Promise.all` chunks) to eliminate sequential disk write bottlenecks during multi-gigabyte weapon and asset installations.
- **Confirmed Decision 4**: Real-time mode indicators in the queue and extraction status banner to reflect active CPU saturation and throughput.

---

### 1. Overview & Core Concept

- **What It Does**: Unshackles the extraction engine for users demanding raw, unconstrained speed. When Turbo Max mode is selected, all CPU logical cores and hyperthreads are saturated with high-priority decompression tasks and parallelized disk streams.
- **Target Audience**: Single Player Tarkov players installing massive weapon packs, overhaul bundles, and retexture packages (1GB–10GB+) who want their mod installed in seconds rather than waiting for conservative background extractors.
- **Key Value**: 
  - **Maximum Decompression Throughput**: 7-Zip saturates all CPU cores via `-mmt={allCores}` with quiet I/O stream flags (`-bso0 -bsp0`) preventing child-process buffer stalling.
  - **High Kernel Priority**: Decompression process runs with `PRIORITY_HIGH` on the OS scheduler for uninterrupted CPU time slices.
  - **Parallelized File Routing**: Extracted folders and assemblies are dispatched to `SPT_Runtime/user/mods` and `BepInEx/plugins` using concurrent asynchronous copy pools instead of sequential single-file walks.

---

### 2. User Experience & Visual Design

#### Key User Flows
1. **Engaging Turbo Max in Settings**:
   - Player opens the **Settings** tab.
   - Under **Extraction Speed & CPU Tuning**, player selects **Turbo Max (Uncapped)**.
   - Real-time hardware card immediately updates: `8 Cores Detected · 8 Threads Allocated · High Process Priority`.
   - Settings are persisted to `localStorage` via `storageService`.
2. **Installing Heavy Mods**:
   - Player clicks **Install Mod** on a large mod (e.g. WTT - Pack or 4K Textures).
   - In the download/install queue, the stage status reads `Extracting (Turbo Max: 8 Threads · High Priority)`.
   - Extraction finishes in a fraction of standard time, followed by rapid concurrent disk routing.

#### Visual Hierarchy & Styling
- Strict 60-30-10 tactical aesthetic adhering to frontend design guidelines (no static pills, clean typographic separators):
  - Container: `#181B20` surface with `#23272E` border and hover elevation.
  - Active selection: `#EA580C` accent border with subtle orange glow (`#EA580C/20`).
  - Hardware specs: `font-mono text-[11px] text-[#9AA3AF]` with `·` dividers.
  - Mode selector buttons: Clean segmented interactive controls with active states and clear technical descriptions.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Full Core Saturation vs OS Headroom in Turbo Max**:
  - *Chosen Approach*: Turbo Max allocates `os.cpus().length` threads with `PRIORITY_HIGH`. Balanced mode remains the default (`N - 2` threads, `PRIORITY_BELOW_NORMAL`) for multi-tasking safety.
  - *Why*: Satisfies the user's explicit mandate ("go full send with it no limitations i need it FAST") while preserving a stable, non-stuttering fallback mode.
- **Decision 2: Parallel Batch Copying in Routing**:
  - *Chosen Approach*: Replace sequential single-file copy loops with chunked parallel promises (`Promise.all` over directory batches) during file routing.
  - *Why*: On modern NVMe SSDs, sequential single-file copies underutilize available I/O queue depth. Concurrent file dispatch dramatically reduces post-extraction routing time for mods containing thousands of small files.
- **Decision 3: Settings Persistence & In-Queue Status**:
  - *Chosen Approach*: Store `extractionPerformanceMode: 'turbo' | 'balanced' | 'smooth'` in `SettingsState` and broadcast active extraction parameters to the download queue UI.
  - *Why*: Ensures transparency so the user can verify their high-performance profile is actively engaged during mod extraction.

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Renderer Process (React)                        │
│   SettingsTab: Mode Selector ('turbo' | 'balanced' | 'smooth')         │
│   App.tsx: Dispatches queueInstall with performanceMode                │
│   QueueItem: Displays real-time extraction thread count & priority    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ IPC: mod:install { performanceMode: 'turbo' }
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Electron Main Process (Node.js)                    │
│   modInstaller.cjs                                                     │
│   ┌──────────────────────────────────────────────────────────────────┐ │
│   │ 1. Download Stream (Throttled IPC progress updates)              │ │
│   │ 2. Decompression Engine (7za)                                    │ │
│   │    - Threads: os.cpus().length (all logical cores)               │ │
│   │    - Priority: os.constants.priority.PRIORITY_HIGH               │ │
│   │    - Direct extraction with -bso0 -bsp0 quiet pipes              │ │
│   │ 3. Parallel Asynchronous File Router                             │ │
│   │    - Concurrent directory & file dispatch (p-limit / batches)   │ │
│   │    - Direct writes to SPT_Runtime/user/mods & BepInEx/plugins    │ │
│   │ 4. Immediate Temp File Pruning & Ready State                     │ │
│   └──────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

#### Performance Profiles Matrix
| Mode | CPU Threads | Process Priority Class | I/O Routing Strategy | Use Case |
| :--- | :--- | :--- | :--- | :--- |
| **Turbo Max** | `os.cpus().length` (100% Cores) | `High` (`PRIORITY_HIGH`) | Parallel chunked dispatch | Fastest possible extraction; AFK or dedicated install |
| **Balanced (Default)** | `os.cpus().length - 2` (Min 2) | `Below Normal` (`PRIORITY_BELOW_NORMAL`) | Non-blocking async yielding | Fast extraction with zero desktop/mouse lag |
| **Smooth** | `os.cpus().length / 2` (Min 2) | `Low` (`PRIORITY_LOW`) | Throttled event-loop yields | Low-spec laptops, battery conservation |

---

### 5. Implementation Steps

1. **Decompression Engine Tuning (`electron/modInstaller.cjs`)**:
   - Update `getExtractionThreadCount`: for `turbo`, return full `os.cpus().length` with zero thread cap.
   - Update `extractArchive`: assign `os.constants.priority.PRIORITY_HIGH` (or `-10`) when `performanceMode === 'turbo'`.
   - Optimize 7za arguments for Turbo Max (`-mmt={cores}`, quiet pipes, fast archive streaming).
2. **Parallelized File Routing (`electron/modInstaller.cjs`)**:
   - Refactor `copyDirectoryContents` to batch file copies concurrently (`Promise.all` in chunks of 16 files) during Turbo mode, maximizing NVMe queue depth.
3. **Queue Feedback & Real-Time Metrics (`src/App.tsx`)**:
   - Pass `settings.extractionPerformanceMode` into installer routines.
   - Display clear status text during extraction (e.g. `Extracting (Turbo Max: 8 Cores · High Priority)...`).
4. **Settings UI Enhancement (`src/components/SettingsTab.tsx`)**:
   - Verify the dedicated **Extraction Speed & CPU Tuning** section clearly details Turbo Max, Balanced, and Smooth modes.
   - Ensure the detected core count and active allocation counters dynamically reflect the user's hardware.
5. **Verification**:
   - Run `compile_applet` and `lint_applet` to confirm clean builds and type safety across all components.
