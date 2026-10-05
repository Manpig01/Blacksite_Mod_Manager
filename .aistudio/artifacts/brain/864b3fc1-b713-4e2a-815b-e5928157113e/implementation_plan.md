# Real SPT Process Launcher: Server & Client Chaining Engine

An integrated execution manager for Single Player Tarkov that spawns `SPT.Server.exe`, streams real-time console output directly into Blacksite's terminal modal, monitors server startup milestones, and automatically launches `SPT.Launcher.exe` once the server is ready.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following technical choices were confirmed during Phase 1 clarification:
> - **Launch Flow**: **Spawn `SPT.Server.exe` first, wait for the server to initialize, then launch `SPT.Launcher.exe`**.
> - **Console Output Location**: **Streamed live directly inside Blacksite's integrated console modal** with color-coded status, search/filter, and autoscrolling.

- **Confirmed Decision 1**: Use `child_process.spawn` in the Electron main process with working directory set to `sptDirectory`, capturing raw `stdout` and `stderr` streams without shell buffering.
- **Confirmed Decision 2**: IPC streaming (`spt:server-log`) transmits console lines directly to the renderer in real time (< 5ms latency).
- **Confirmed Decision 3**: Regex and string marker analysis ("Server is ready", "Happy hunting", "Started webserver") detects when the database and server mods finish loading, immediately triggering detached execution of `SPT.Launcher.exe`.
- **Confirmed Decision 4**: Graceful process termination with Windows process-tree cleanup (`taskkill /F /T`) so port 6969 is cleanly released whenever the user clicks "Stop Server" or exits the app.

---

### 1. Overview & Core Concept

- **What It Does**: Replaces manual, multi-window launching with a unified, one-click experience. Clicking "Launch SPT" in Blacksite boots `SPT.Server.exe`, live-streams server initialization logs in an embedded terminal, detects server readiness, and opens `SPT.Launcher.exe`.
- **Target Audience**: Single Player Tarkov players who want an automated launch sequence without juggling open command prompt windows and launcher shortcuts.
- **Key Value**:
  - **Zero Manual Steps**: Auto-chains server boot into launcher execution.
  - **Embedded Terminal**: Watch server mods (SAIN, SVM, Realism) compile and initialize directly in Blacksite without a distracting CMD window.
  - **Double-Launch Prevention**: Tracks active server PID and port 6969 state to prevent multiple server instances from conflicting.
  - **One-Click Teardown**: Stop the server and clean up child processes with a single click.

---

### 2. User Experience & Visual Design

#### Key User Flows
1. **Launching from Header**:
   - Player clicks **Launch SPT** in the top navigation bar.
   - The **SPT Integrated Process Launcher** modal opens.
   - Blacksite checks executable paths (`SPT.Server.exe` and `SPT.Launcher.exe`).
   - Server begins booting; raw console logs stream in with color-coded timestamps.
2. **Server Ready & Chained Client Launch**:
   - Server finishes loading mods and outputs `Server is ready! Happy hunting in Tarkov!`.
   - The modal marks server status as `Ready (Port 6969 Active)`.
   - Blacksite automatically launches `SPT.Launcher.exe`.
   - Toast notification appears: `SPT Launched · SPT.Server.exe running & SPT.Launcher.exe started`.
3. **Stopping or Restarting**:
   - Player can click **Stop Server** to terminate the server process tree.
   - Console logs note clean shutdown: `[Blacksite Launcher] Server stopped. Process tree terminated.`

#### Visual Polish & Theme Integration
- Dark high-contrast tactical terminal (`#0B0D10` background, `#1F242C` border, monospaced font).
- Status bar header with live indicators:
  - Server status: `Starting` (pulsing orange) -> `Ready (Port 6969)` (emerald green) -> `Stopped` (slate).
  - Client status: `Waiting for Server...` -> `Launched (SPT.Launcher.exe)`.
- Action buttons: "Stop Server", "Restart", "Copy Logs", "Clear Console".

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Direct Executable Detection with Fallback**:
  - *Chosen Approach*: Check for modern `SPT.Server.exe` and `SPT.Launcher.exe` first, with automatic fallback to legacy `Aki.Server.exe` and `Aki.Launcher.exe`.
  - *Why*: Supports both modern SPT 4.x / 3.10+ and legacy installations without configuration errors.
- **Decision 2: Detached Client Launch vs Process Piping**:
  - *Chosen Approach*: Launch `SPT.Launcher.exe` as a detached, unreferenced process (`detached: true`, `stdio: 'ignore'`).
  - *Why*: Allows the game launcher to run independently so closing or minimizing Blacksite never kills the game window.
- **Decision 3: Tree Kill on Shutdown**:
  - *Chosen Approach*: Use Windows `taskkill /pid {pid} /T /F` (or `kill(-pid)` on Unix) to clean up Node.js server child processes.
  - *Why*: Prevents orphaned background server processes from locking port 6969 and causing "EADDRINUSE" errors on subsequent launches.

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Renderer Process (React)                        │
│   SptLauncherModal.tsx                                                 │
│   - Subscribes to desktopBridge.onSptServerLog                        │
│   - Displays live terminal logs & process status                       │
│   - Dispatches desktopBridge.launchSpt / stopSptServer                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ IPC: spt:launch / spt:server-log
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Electron Main Process (Node.js)                    │
│   main.cjs                                                             │
│   ┌──────────────────────────────────────────────────────────────────┐ │
│   │ 1. Verify SPT.Server.exe & SPT.Launcher.exe in sptDirectory      │ │
│   │ 2. Spawn SPT.Server.exe (cwd: sptDirectory)                      │ │
│   │    - stdout.on('data') ──▶ IPC 'spt:server-log'                  │ │
│   │    - stderr.on('data') ──▶ IPC 'spt:server-log'                  │ │
│   │ 3. Pattern Matcher: "Server is ready" / "Happy hunting"          │ │
│   │    - On Match ──▶ Spawn SPT.Launcher.exe (detached)              │ │
│   │    - IPC 'spt:client-launched'                                   │ │
│   │ 4. Process Teardown Handler (taskkill /T /F)                     │ │
│   └──────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

#### Executable Resolution Hierarchy
1. Server: `path.join(sptDirectory, 'SPT.Server.exe')` -> `path.join(sptDirectory, 'Aki.Server.exe')`
2. Launcher: `path.join(sptDirectory, 'SPT.Launcher.exe')` -> `path.join(sptDirectory, 'Aki.Launcher.exe')` -> `path.join(sptDirectory, 'EscapeFromTarkov.exe')`

---

### 5. Implementation Steps

1. **Implement Real Process Spawning in `electron/main.cjs`**:
   - Add `spt:launch`, `spt:stop`, and `spt:status` IPC handlers.
   - Implement live `stdout`/`stderr` streaming through `spt:server-log`.
   - Add ready-marker detection to auto-chain `SPT.Launcher.exe`.
   - Add process-tree kill for clean shutdown.
2. **Expose Bridge APIs in `electron/preload.cjs`**:
   - `launchSpt`, `stopSptServer`, `onSptServerLog`, `onSptClientLaunched`, `onSptServerExit`.
3. **Upgrade `src/components/SptLauncherModal.tsx`**:
   - Wire up real Electron IPC listeners with graceful web simulation fallback.
   - Display dynamic server readiness and launcher execution status.
   - Support autoscrolling, log copying, and manual restart.
4. **Header Integration in `src/components/Header.tsx` & `src/App.tsx`**:
   - Pass active running status to Header for live pulse indicators.
5. **Verification**:
   - Run `compile_applet` and `lint_applet` to confirm clean builds and type safety.
