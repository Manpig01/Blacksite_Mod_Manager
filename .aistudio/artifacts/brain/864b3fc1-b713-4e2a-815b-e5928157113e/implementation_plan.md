# Implementation Plan: Forge Dependency Resolution & Installation Recovery

Implement official SPT Forge dependency resolution via the `/mods/dependencies` API, add an interactive Dependency Confirmation Modal letting users choose whether to install with or without dependencies, and provide version health detection with an automatic recovery picker for 404 download errors.

## Proposed Changes

### 1. SPT Forge API Service (`src/services/apiService.ts`)
- **Implement Dependency Resolution Endpoint**:
  - Add `resolveModDependencies(modIdentifier: string | number, version: string, sptVersion: string)` calling `GET /api/v0/mods/dependencies?mods=${modIdentifier}:${version}&spt_version=${sptVersion}`.
  - Recursively parse the returned tree of dependencies (including nested dependencies like SAIN -> Waypoints / BigBrain).
- **Implement Version Health & Auto-Resolution**:
  - In `getModVersions(modId)`, sort versions by latest published date and check compatibility against the active SPT version (`settings.sptVersion`).
  - Provide a fallback check when resolving download links so outdated 404 links (such as early WTT Content Backport hosting) are flagged before download.

### 2. Interactive Dependency Modal (`src/components/DependencyInstallModal.tsx`)
- Create a dedicated, polished modal that opens when a mod requires other packages:
  - **Tree View / Checklist**: Lists the primary mod and all required dependencies, their author, latest compatible version, and whether each dependency is already installed locally.
  - **User Choices**:
    - **"Install with Dependencies"**: Queues the entire dependency tree in the correct dependency order.
    - **"Custom Selection"**: Allows unchecking individual dependencies.
    - **"Install Without Dependencies"**: Installs only the requested target mod.
  - **Conflict Warnings**: Highlights any incompatible or conflicting mods flagged by the Forge resolver.

### 3. Installation Flow & Error Recovery (`src/App.tsx` & `src/components/VersionPickerModal.tsx`)
- **Pre-Install Dependency Check**:
  - In `handleInstallMod`, query `apiService.resolveModDependencies` before queuing.
  - If missing dependencies are found, display `DependencyInstallModal`. If none are required, proceed directly.
- **404 / Broken Link Recovery**:
  - When a download fails with a 404 status (or unresolvable external CDN), capture the error and automatically open the `VersionPickerModal` with version health indicators.
  - Provide direct options in the modal: "Try another version", "Open Forge mod page", or "Upload local archive (.zip/.7z)".
- **Queue Progress & Sequential Installation**:
  - When installing with dependencies, sequentially download, extract, and route each dependency so prerequisites (e.g. BigBrain, SAIN) are installed before the dependent mod.

### 4. Native Desktop Installer Engine (`electron/modInstaller.cjs`)
- Enhance error classification so HTTP status codes (such as 404 Not Found, 403 Forbidden, 429 Rate Limit) are structured and returned to the renderer.
- Support automatic retry with follow-redirect headers and fallback to alternate mirror links if provided.

---

## User Review Required

> [!NOTE]
> - Do you want installed dependencies to be automatically activated in your current loadout profile upon download completion? (Recommended: Yes).
> - All required and optional dependencies returned by the Forge API will have clear visual indicators and checkboxes in the modal.

---

## Verification Plan

### Automated Verification
- **Compilation Check**: Run `npm run build` (`tsc -b && vite build`) to verify all TypeScript types, component interfaces, and bundle generation.
- **Node Syntax Verification**: Validate `electron/modInstaller.cjs`, `electron/preload.cjs`, and `electron/main.cjs`.

### Manual & Behavioral Verification
1. **Dependency Modal**:
   - Browse to a mod with known dependencies (e.g., *WTT - Black Division* or *SAIN*).
   - Click "Install". Confirm that the **Dependency Modal** appears showing required prerequisites (BigBrain, Waypoints, etc.) with active checkboxes and "Install with Dependencies" / "Install Without Dependencies" buttons.
2. **404 Download Link Handling**:
   - Attempt to install an older or broken version (such as *WTT - Content Backport v1.0.0*).
   - Confirm that Blacksite catches the 404, opens the **Version Picker Modal** showing version health indicators, and allows choosing a working release (e.g., v1.1.3 or latest) without silent failure.
3. **SPT Directory Verification**:
   - Verify that extracted files and `.dll` assemblies land in `<SPT>\user\mods` and `<SPT>\BepInEx\plugins` respectively.
