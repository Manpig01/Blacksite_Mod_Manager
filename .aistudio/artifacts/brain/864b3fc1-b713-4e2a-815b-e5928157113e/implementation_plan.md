# SPT 4.x Runtime Executable Auto-Detection & Working Directory Binding

An enhanced executable locator and runtime environment binder for Blacksite Mod Manager that resolves `SPT.Server.exe` and `SPT.Launcher.exe` across both `SPT_Runtime` and root SPT directories, executing the server directly inside `SPT_Runtime` with proper relative database and module resolution.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following technical choices were confirmed during Phase 1 clarification:
> - **Executable Search Hierarchy**: **Auto-scan both `SPT_Runtime` and root SPT directory** (prioritizes modern SPT 4.x `SPT_Runtime/` binaries, with seamless fallback to root directory).
> - **Working Directory Execution**: **Run directly from the `SPT_Runtime` directory** (`cwd: path.dirname(serverExe)`), ensuring the Node.js server engine accesses relative modules, database files, and configs without path errors.

- **Confirmed Decision 1**: Prioritize `path.join(sptDirectory, 'SPT_Runtime', 'SPT.Server.exe')` followed by root `SPT.Server.exe`, resolving modern SPT 4.1.x+ layouts while maintaining backwards compatibility with 3.x installations.
- **Confirmed Decision 2**: Automatically bind the child process `cwd` to `path.dirname(serverExe)` (e.g. `C:\SPT\SPT_Runtime`) so relative paths inside the SPT server (such as `user/mods`, database configs, and cache) load accurately.
- **Confirmed Decision 3**: Auto-detect `SPT.Launcher.exe` across both `SPT_Runtime` and root SPT, spawning the client with its own local working directory.
- **Confirmed Decision 4**: Display detected binary paths clearly in the terminal modal output for transparency.

---

### 1. Overview & Core Concept

- **What It Does**: Solves the `"Could not find SPT.Server.exe or Aki.Server.exe in C:\SPT"` error on SPT 4.x layouts where executables reside in `C:\SPT\SPT_Runtime\`. Blacksite auto-discovers binaries across both locations and sets the process working directory appropriately.
- **Target Audience**: Single Player Tarkov players running modern SPT 4.x (such as 4.1.6) or legacy 3.x installations.
- **Key Value**:
  - **Zero Manual Re-pathing**: Automatically locates executables in `SPT_Runtime` or root.
  - **Flawless Server Boot**: Running directly inside `SPT_Runtime` prevents database loading failures caused by mismatched execution directories.
  - **Accurate Diagnostic Logs**: Terminal displays the resolved binary paths and working directories.

---

### 2. User Experience & Visual Design

#### Key User Flows
1. **Launching SPT from Header**:
   - Player clicks **Launch SPT**.
   - Modal opens and terminal outputs:
     ```
     [10:53:01 PM] [Blacksite Launcher] Initializing Single Player Tarkov v4.1.6 environment...
     [10:53:01 PM] [Blacksite Launcher] Server Binary: C:\SPT\SPT_Runtime\SPT.Server.exe
     [10:53:01 PM] [Blacksite Launcher] Working Directory: C:\SPT\SPT_Runtime
     [10:53:01 PM] [Blacksite Launcher] Spawning SPT.Server.exe (port 6969)...
     ```
   - Server boots cleanly without `"Could not find"` errors.
2. **Auto-Chaining the Launcher**:
   - When the server outputs `"Server is ready"`, Blacksite detects the marker and launches `SPT_Runtime\SPT.Launcher.exe`.
   - Toast notification confirms successful launch.

#### Visual Polish & Theme Integration
- Terminal displays resolved binary location in the bottom telemetry bar: `Server: SPT_Runtime\SPT.Server.exe · Port 6969 Monitored`.
- Adheres to frontend design rules: zero static pills, clean unboxed typographic dividers (`·`), and high-contrast tactical styling.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Priority Order for Binary Resolution**:
  - *Chosen Approach*: Search `SPT_Runtime` first, then root `sptDirectory`.
  - *Why*: Modern SPT 4.x installations place core runtime engines in `SPT_Runtime`. Checking `SPT_Runtime` first ensures modern builds take precedence, while legacy 3.x setups fall through seamlessly.
- **Decision 2: Dynamic Working Directory Binding (`path.dirname(exe)`)**:
  - *Chosen Approach*: Bind `cwd` to `path.dirname(serverExe)` instead of hardcoded `sptDirectory`.
  - *Why*: In SPT 4.x, the server expects to find its `SPT_Data`, configuration files, and dependencies relative to `SPT_Runtime`. Running from root causes runtime crashes or missing file errors.
- **Decision 3: Independent Client Launcher Resolution**:
  - *Chosen Approach*: Separately search for `SPT.Launcher.exe` in `SPT_Runtime` and root, binding its `cwd` to its own folder.
  - *Why*: Some SPT builds keep the launcher in the root folder while the server is in `SPT_Runtime`; others place both in `SPT_Runtime`. Decoupled discovery ensures both layouts work out of the box.

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Executable Resolution Flow                      │
│                                                                        │
│   Target: SPT.Server.exe                                               │
│   1. Check {sptDirectory}/SPT_Runtime/SPT.Server.exe  ──▶ (Found: 4.x) │
│   2. Fallback {sptDirectory}/SPT.Server.exe           ──▶ (Found: 3.x) │
│                                                                        │
│   Target: SPT.Launcher.exe                                             │
│   1. Check {sptDirectory}/SPT_Runtime/SPT.Launcher.exe──▶ (Found)      │
│   2. Fallback {sptDirectory}/SPT.Launcher.exe         ──▶ (Found)      │
│                                                                        │
│   Execution Binding:                                                   │
│   spawn(serverExe, [], { cwd: path.dirname(serverExe) })               │
└────────────────────────────────────────────────────────────────────────┘
```

#### Executable Discovery Paths
| Component | Primary Search Path (SPT 4.x) | Secondary Search Path (Root / Legacy) |
| :--- | :--- | :--- |
| **Server** | `{sptDirectory}/SPT_Runtime/SPT.Server.exe` | `{sptDirectory}/SPT.Server.exe` / `Aki.Server.exe` |
| **Launcher** | `{sptDirectory}/SPT_Runtime/SPT.Launcher.exe` | `{sptDirectory}/SPT.Launcher.exe` / `Aki.Launcher.exe` |

---

### 5. Implementation Steps

1. **Update Executable Resolution in `electron/sptLauncher.cjs`**:
   - Update `findServerExecutable` to scan `SPT_Runtime/` first, then root directory.
   - Update `findLauncherExecutable` to scan `SPT_Runtime/` first, then root directory.
   - Set `cwd: path.dirname(serverExe)` when spawning the server.
   - Set `cwd: path.dirname(launcherPath)` when spawning the launcher.
2. **Update Diagnostics in `electron/sptLauncher.cjs`**:
   - Log the exact resolved executable path and active working directory to `onLog`.
3. **Update Simulation & UI in `src/components/SptLauncherModal.tsx`**:
   - Reflect `SPT_Runtime` resolution in the web simulation fallback and telemetry bar.
4. **Verification**:
   - Run `compile_applet` and `lint_applet` to confirm clean builds and type safety.
