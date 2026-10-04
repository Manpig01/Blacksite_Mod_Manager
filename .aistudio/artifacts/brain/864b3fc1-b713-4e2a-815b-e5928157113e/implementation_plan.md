# High-Performance Mod Extraction & CPU Priority Tuning

A non-blocking decompression architecture and performance manager for Blacksite Mod Manager that eliminates system lag and desktop stutter during massive Single Player Tarkov mod installations while accelerating extraction throughput.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following technical choices were confirmed during Phase 1:
> - **Performance Profile**: **Balanced High Speed with Reserved CPU Cores** (allocates `N - 2` CPU threads to 7-Zip with `BelowNormal` process priority so Windows desktop, mouse cursor, and audio never stutter).
> - **Settings Control**: **Dedicated Extraction Speed & CPU Selector** added to the Settings tab, allowing switching between *Balanced*, *Turbo Max*, and *Smooth Background* modes.

- **Confirmed Decision 1**: Use multi-threaded 7za execution constrained to `os.cpus().length - 2` threads with Windows process priority set to `BelowNormal`, ensuring maximum extraction speed without starving the OS compositor.
- **Confirmed Decision 2**: Replace blocking synchronous disk copies (`fs.cpSync`) in the Electron main thread with non-blocking asynchronous stream pipelines (`fs.promises.cp` / streaming chunks) to eliminate the main process event loop lockups that caused the app and PC to freeze.
- **Confirmed Decision 3**: Add persistent performance preferences to `SettingsState` (`extractionPerformanceMode: 'balanced' | 'turbo' | 'smooth'`).

---

### 1. Overview & Core Concept

- **What It Does**: Solves computer slowdowns and freezes during the installation of large SPT mods (such as 1GB–10GB weapon packs, visual overhauls, and trader bundles). It tunes decompression engine parameters and moves disk routing into non-blocking asynchronous streams.
- **Target Audience**: Single Player Tarkov players installing massive mod packages who want their PC to remain completely responsive (smooth mouse cursor, uninterrupted Discord/browser/gameplay) while enjoying significantly faster extraction times.
- **Key Value**: 
  - **Zero Desktop Lag**: By dropping 7za worker process priority below normal and reserving 1–2 CPU cores for the operating system, CPU starvation is completely eliminated.
  - **Faster Extraction Times**: Multi-threaded decompression (`-mmt={cores}`) with quiet output flags (`-bso0 -bsp0`) and direct asynchronous disk routing eliminates redundant copy passes and buffer overheads.
  - **User Controllability**: Players can customize CPU thread allocation and extraction aggressiveness directly in Settings.

---

### 2. User Experience & Visual Design

#### Key User Flows
1. **Configuring Performance in Settings**:
   - User navigates to the **Settings** tab.
   - Under the new **Extraction & Performance Tuning** card, the user sees three tactical mode buttons:
     - **Balanced (Recommended)**: Utilizes `N - 2` CPU cores with background I/O priority. High speed with zero desktop stutter.
     - **Turbo Max**: Utilizes all CPU cores for fastest possible completion when the user is away from keyboard.
     - **Smooth Background**: Restricts to 2–4 cores with low priority for low-spec PCs or laptops on battery.
   - A real-time hardware summary displays detected CPU cores (e.g. `8 Cores Detected · 6 Threads Allocated`).
2. **Installing Large Mod**:
   - User queues a large mod (e.g. WTT - Armory, SAIN + BPK, or 4K Retextures).
   - During extraction, the progress bar displays real-time throughput metrics without stuttering the UI.
   - The user can continue navigating the mod manager, browsing mods, or using other applications with zero cursor lag.

#### Visual Identity & Theme
- Strict 60-30-10 Blacksite tactical palette:
  - Container card: `#181B20` with `#23272E` border and subtle hover state.
  - Accent: `#EA580C` tactical orange for active mode selection and `#22C55E` for status indicators.
  - Hardware specs: clean `font-mono text-[11px] text-[#9AA3AF]` with `·` separators (zero pills).

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Asynchronous Non-blocking IO vs Synchronous `fs.cpSync`**:
  - *Chosen Approach*: Replace `fs.cpSync` with `fs.promises.cp` and chunked asynchronous routing.
  - *Why*: In Node.js / Electron, `fs.cpSync` completely blocks the V8 main thread event loop for seconds (or minutes on mechanical hard drives or large mods), freezing IPC messages, window rendering, and window movement. Asynchronous IO yields to the event loop between directory entries.
- **Decision 2: `BelowNormal` Process Priority for Decompression Engines**:
  - *Chosen Approach*: Launch 7za with Windows `BELOW_NORMAL_PRIORITY_CLASS` (or `nice` on Unix).
  - *Why*: In Windows, 7-Zip executing at normal priority starves the Windows Desktop Window Manager (DWM.exe) and audio subsystem. `BelowNormal` allows 7za to consume 100% of its assigned cores when idle, but instantly yields CPU cycles whenever the user moves the mouse, switches windows, or plays audio.
- **Decision 3: Dedicated Performance Toggle in Settings**:
  - *Chosen Approach*: Persist `performanceMode` in `SettingsState` (`storageService`) and pass it to Electron IPC `mod:install`.
  - *Why*: Allows users on high-end 16-core gaming rigs to unleash Turbo mode, while laptop or budget quad-core users can select Smooth mode.

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Renderer Process (React)                        │
│   SettingsTab: Performance Mode Selector ('balanced' | 'turbo' | 'smooth')
│   App.tsx: Dispatches queueInstall with performanceMode options       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ IPC: mod:install
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Electron Main Process (Node.js)                    │
│   modInstaller.cjs                                                     │
│   ┌──────────────────────────────────────────────────────────────────┐ │
│   │ 1. Stream Download (64KB chunks directly to temp file)          │ │
│   │ 2. Decompression Engine (7za / tar)                             │ │
│   │    - Multi-threaded: -mmt={calculatedCores}                     │ │
│   │    - Process Priority: BelowNormal Priority Class                │ │
│   │    - Quiet Output: -bso0 -bsp0 (no maxBuffer lag)                │ │
│   │ 3. Non-Blocking Async Routing                                    │ │
│   │    - fs.promises.cp / asynchronous recursive directory walk      │ │
│   │    - Yields to event loop: zero UI freezes or IPC stalling       │ │
│   │ 4. Cleanup & IPC Completion                                      │ │
│   └──────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

#### Calculated Thread Allocations
- **Balanced (Default)**: `Math.max(2, Math.min(8, os.cpus().length - 2))` threads, `BelowNormal` priority.
- **Turbo Max**: `os.cpus().length` threads, `BelowNormal` priority.
- **Smooth Background**: `Math.max(2, Math.floor(os.cpus().length / 2))` threads, `Idle` / lowest priority.

#### Interface Additions (`src/types.ts`)
```typescript
export type ExtractionPerformanceMode = 'balanced' | 'turbo' | 'smooth';

export interface SettingsState {
  // ... existing fields ...
  extractionPerformanceMode: ExtractionPerformanceMode;
  maxExtractionThreads?: number;
}
```

---

### 5. Implementation Steps

1. **Update Data Interfaces & Storage Defaults (`src/types.ts`, `src/services/storageService.ts`)**:
   - Add `ExtractionPerformanceMode` type and field to `SettingsState`.
   - Default to `'balanced'` in `DEFAULT_SETTINGS`.
2. **Optimize Decompression Engine in `electron/modInstaller.cjs`**:
   - Add thread calculation utility based on `os.cpus().length` and performance mode.
   - Configure 7za spawn/execFile with Windows `BELOW_NORMAL_PRIORITY_CLASS` (or `windowsHide: true`).
   - Replace synchronous `fs.cpSync` in `routeExtractedModToSpt` with asynchronous `fs.promises.cp`.
3. **Connect IPC Parameters (`electron/main.cjs`, `electron/preload.cjs`, `src/App.tsx`)**:
   - Pass `extractionPerformanceMode` from `settings` through `bridge.installMod`.
4. **Build Extraction & Performance Tuning UI in `src/components/SettingsTab.tsx`**:
   - Add card with 3 tactical mode options, CPU hardware summary, and explanation of thread reservation.
5. **Verification**:
   - Run `compile_applet` and `lint_applet` to verify clean build with zero regressions.
