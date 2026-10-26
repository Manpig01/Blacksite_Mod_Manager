# Blacksite Mod Manager — Codebase Refinement & Architectural Optimization Plan

## 1. Executive Summary
This refinement pass transforms the Blacksite Mod Manager codebase from large, monolithic components into a modular, strongly-typed, high-performance architecture while preserving 100% of existing SPT 3.x / 4.x functionality.

---

## 2. Strongly-Typed Desktop Bridge Service (`src/services/desktopBridgeService.ts`)
Currently, `(window as any).desktopBridge` is cast in over 35 locations across `App.tsx`, `InstalledModsTab.tsx`, `SettingsTab.tsx`, `SptLauncherModal.tsx`, `CustomTitleBar.tsx`, `ProfilesTab.tsx`, and `EmblemUploader.tsx`.
- **Action**:
  - Define a complete `DesktopBridgeAPI` TypeScript interface in `src/types.ts` (and augment `Window` in `src/vite-env.d.ts`) covering all IPC methods exposed in `electron/preload.cjs`:
    - Directory & shell methods (`selectDirectory`, `inspectSptDirectory`, `openFolder`, `showItemInFolder`, `openExternal`, `fetchImageDataUrl`)
    - Mod lifecycle methods (`installMod`, `onInstallProgress`, `uninstallMod`, `uninstallAllMods`, `toggleDisableMod`, `scanInstalledMods`, `saveModConfigFile`, `clearTempFiles`)
    - Profile & SPT launcher methods (`relinkVfsProfile`, `scanSptPlayerProfiles`, `launchSpt`, `stopSptServer`, `getSptStatus`, `onSptServerLog`, `onSptClientLaunched`, `onSptServerExit`)
    - Branding & window controls (`setCustomEmblem`, `updateAppIcon`, `resetCustomEmblem`, `windowControl`)
  - Create `src/services/desktopBridgeService.ts` providing safe, typed helper accessors (`getDesktopBridge()`, `isDesktopEnvironment()`, and typed wrapper helpers) so components never use `(window as any).desktopBridge`.

---

## 3. Custom Tactical Confirmation Modal (`src/components/TacticalConfirmModal.tsx`)
Native browser `confirm(...)` dialogs in `App.tsx`, `InstalledModsTab.tsx`, and `SettingsTab.tsx` block the renderer thread and clash with the dark tactical hardware UI.
- **Action**:
  - Create `src/components/TacticalConfirmModal.tsx` with customizable title, message, severity (`danger` | `warning` | `info`), confirm/cancel labels, and keyboard shortcuts (`Escape` to cancel, `Enter` to confirm).
  - Create a lightweight `useConfirmDialog` hook (`src/hooks/useConfirmDialog.ts`) returning `{ confirm, confirmModalProps }` so any workflow (uninstalling a mod, uninstalling all mods, clearing diagnostic logs, deleting a profile) can await a Promise-based confirmation modal cleanly.

---

## 4. Decomposing `App.tsx` into Domain Hooks
`src/App.tsx` (~2,200 lines) will be modularized by extracting cohesive custom hooks under `src/hooks/`:
1. **`src/hooks/useToastQueue.ts`**:
   - Manages toast notifications (`toasts`, `addToast`, `removeToast`) with stable `useCallback` references.
2. **`src/hooks/useSptProcessMonitor.ts`**:
   - Encapsulates SPT Server & Client status polling, IPC event listeners (`onSptServerLog`, `onSptClientLaunched`, `onSptServerExit`), server log ring-buffer management, and launch/stop handlers.
3. **`src/hooks/useDiskScanner.ts`**:
   - Encapsulates scanning local SPT folders (`scanInstalledMods`, `scanSptPlayerProfiles`), auto-linking scanned mods against Forge metadata (`autoLinkerService`), reconciling installed versions, and checking for remote updates.
4. **`src/hooks/useInstallQueue.ts`**:
   - Manages the download & extraction queue (`installQueue`, `activeDownloads`, `installProgress` IPC subscription, queueing single/batch mod installs, addon installs, and retry/remove operations).

---

## 5. Splitting Large Tab Components (`InstalledModsTab` & `SettingsTab`)
1. **`InstalledModsTab.tsx` Decomposition**:
   - Extract `src/components/installed/InstalledModsStatsBar.tsx` — Tactical summary bar for enabled/disabled/outdated/conflict counters and quick filter toggles.
   - Extract `src/components/installed/InstalledModRowCard.tsx` — Memoized (`React.memo`) individual mod card/row component with version selector, enable/disable switch, tag badges, dependency tree drawer, and action buttons.
2. **`SettingsTab.tsx` Decomposition**:
   - Extract `src/components/settings/DiagnosticLogSection.tsx` — Self-contained error & diagnostic log viewer with level filters, search, clipboard export, and clear action.
   - Extract `src/components/settings/SptDirectorySection.tsx` — SPT installation path selector, version auto-detection badge, and quick folder shortcuts (`user/mods`, `BepInEx/plugins`).

---

## 6. Performance, Memoization & Storage Batching Optimizations
- **`src/services/storageService.ts`**:
  - Add debounced background persistence (`saveInstalledModsDebounced`, `saveProfilesDebounced`) alongside immediate flush on `beforeunload` so rapid state updates (such as batch enabling/disabling mods or queue progress updates) do not synchronously serialize large JSON payloads on every frame.
  - Tighten TypeScript types in `storageService.ts` and `apiService.ts` to eliminate loose `any` types.
- **Memoized Filtering & Lookups**:
  - Precompute `Map<string, InstalledMod>` and `Set<string>` lookup structures in `App.tsx` and `InstalledModsTab.tsx` (`useMemo`) so mod installation checks, conflict lookups, and tag filtering run in $O(1)$ time per item rather than repeated `.find()` / `.some()` array scans.
