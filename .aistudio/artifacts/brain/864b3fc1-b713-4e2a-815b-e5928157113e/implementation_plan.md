# Implementation Plan: Phase 3 NTFS Hardlink VFS & Conflict Resolution Engine

Building on Phase 1's decompression hardening and Phase 2's cache/search optimization, Phase 3 implements **NTFS Hardlink Virtual File System (VFS)**, **Transactional Rollback Staging**, **Semantic Config Deep-Merging**, and an **Interactive Conflict Matrix Tab** powered by Tarjan's Strongly Connected Components (SCC) algorithm.

---

## Proposed Changes

### 1. `electron/modInstaller.cjs` & Hardlink Deployment Engine
- **Dedicated Staging Depot (`<SPT_ROOT>/.blacksite_library/<modId>_<version>/`)**:
  - Archives are extracted once into an immutable library depot on the same NTFS drive.
  - Deployment uses zero-copy, zero-elevation NTFS hardlinks (`fs.promises.link`) into `SPT_Runtime/user/mods` or `BepInEx/plugins`.
  - Linking 10,000 files completes in sub-100ms with zero duplicate disk consumption.
  - Automatically handles cross-volume (`EXDEV`) with parallel copy fallback.
- **Atomic Transaction Journal & Rollback on `EBUSY`**:
  - Maintains an in-memory operations journal (`journal = []`).
  - Pre-flights target files with atomic renames (`destPath.bs_bak_<rand>`) to detect running processes or lock contention immediately.
  - In case of failure or file lock, executes a clean reverse-order rollback, ensuring the SPT installation is never left in a corrupted half-installed state.
- **Mutable Config Detection & Semantic Deep-Merging**:
  - Distinguishes immutable binary assets (`.dll`, `.bundle`, `.db`) from mutable user configs (`.json`, `.jsonc`, `.cfg`, `.ini`).
  - Stores SHA-256 base hashes at install time.
  - During updates: if the user modified settings (`currentHash !== baseHash`), executes a recursive semantic AST deep-merge that appends new mod settings/keys while strictly preserving existing user values and keybinds.

---

### 2. `src/services/conflictResolver.ts` & Analysis Engine
- **Tarjan's Strongly Connected Components (SCC) Cycle Detector**:
  - Builds a directed dependency graph $G = (V, E)$ from mod manifests (`dependencies`, `loadBefore`, `loadAfter`, `[BepInDependency]`).
  - Runs Tarjan's SCC and Kahn's topological sort algorithm to detect circular dependency loops before `SPT.Server.exe` starts.
- **Multi-Level File Collision Classifier**:
  - Generates a case-folded, relative Virtual Path Index (VPI).
  - Categorizes collisions into:
    - `CRITICAL_BINARY` (`.dll` files contending for identical plugin slots).
    - `CONFIG_OVERWRITE` (`config.json`, `.cfg` colliding between mods).
    - `ASSET_OVERRIDE` (`.bundle`, audio, texture replacements).
- **Missing Prerequisites Detector**:
  - Identifies required dependency mods or addons that are absent or disabled, with 1-click resolution.

---

### 3. `src/components/ConflictMatrixTab.tsx` (Interactive Conflict Matrix)
- **Dedicated Tactical Conflict Tab**:
  - Added to the primary navigation bar with dynamic alert badge indicating active issues (`CRITICAL`, `WARNING`, `CIRCULAR`).
- **Visual Circular Dependency Inspector**:
  - Displays interactive cycle paths (e.g., `Mod A -> Mod B -> Mod C -> Mod A`) with load-order break suggestions.
- **Actionable Collision Resolver**:
  - Side-by-side collision cards displaying contending mods, file paths, and load priority.
  - 1-click resolution actions: "Prioritize Mod A", "Prioritize Mod B", "Disable Contending Mod", or "Keep Both (Auto-Rename / Sandbox)".
- **Missing Dependency Resolver**:
  - Lists missing required mods with immediate "Install Dependency from Forge" buttons.

---

### 4. `src/App.tsx` & Type Integrations
- Extend navigation tabs to include `'conflicts'`.
- Connect real-time loadout analysis so conflicts re-evaluate automatically whenever mods are enabled, disabled, updated, or uninstalled.
- Surface quick-action conflict notifications in the status bar and installed mods view.

---

## Validation & Verification

1. **Unit & Graph Algorithm Testing**:
   - Verify Tarjan's SCC on cyclic and acyclic dependency graphs.
   - Verify semantic config deep-merging on sample JSON/CFG files preserving user keys.
2. **Build & Lint Verification**:
   - Run `npm run lint` (`tsc -b`) and `compile_applet` (`npm run build`).
3. **User Flow Verification**:
   - Check the new Conflict Matrix tab in the UI.
   - Verify conflict collision classification and auto-fix actions.
