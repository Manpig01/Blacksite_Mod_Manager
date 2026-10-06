# Dynamic SPT Version Switching & Compatible Release Installation Plan

Ensure that switching the SPT version in the Browse Mods dropdown dynamically updates the version badge on all mod cards and installs the specific release engineered for that SPT version.

## Proposed Changes

### 1. Dynamic Card Badge & Version Label Alignment
- In `src/components/BrowseModsTab.tsx`:
  - Calculate `activeTargetSptVersion = selectedSptVersion !== 'All' ? selectedSptVersion : sptVersion`.
  - Replace the hardcoded `SPT 4.1.6` badge with dynamic text:
    - When a specific version is selected in the dropdown (e.g., `SPT 4.1.5`, `SPT 4.0.12`, `SPT 3.11.4`), display `SPT ${selectedSptVersion}`.
    - When `All SPT Versions` is selected, display `SPT ${sptVersion}` (the user's auto-detected/configured installed game version).
  - Apply version-tier styling to the badge:
    - SPT 4.1.x: Emerald Green (`bg-[#16A34A]`)
    - SPT 4.0.x: Violet/Indigo (`bg-[#7C3AED]`)
    - SPT 3.x: Amber/Rose (`bg-[#D97706]`)
  - Update the title tooltip and compatibility indicator to reflect the targeted SPT release.

### 2. Compatible Release Selection on "Install" Click
- In `src/components/BrowseModsTab.tsx`:
  - Update the "Install" button handler to pass the active target SPT version (`activeTargetSptVersion`).
  - When the user clicks "Install", determine the best matching release:
    - If `mod.versions` are already loaded, match against `spt_version_constraint`.
    - If `mod.versions` are not populated in the catalog item, query `apiService.getModVersions(mod.id)` asynchronously to find the release specifically tagged or constrained for the chosen SPT release.
    - Pass the exact resolved release (`version.version` and `version.link`) to `onInstallMod(mod, resolvedVersion)`.

### 3. Queue & Dependency Resolver Integration
- In `src/App.tsx`:
  - Update `handleInstallMod` to accept the target release and respect the selected SPT version when resolving dependencies via `apiService.resolveModDependencies`.
  - Display the targeted SPT version in toast notifications and queue item status (e.g., `Installing Waypoints v1.4.2 (SPT 4.0.12)`).

## Verification Plan

### Automated Verification
- Run `compile_applet` to confirm TypeScript type safety.
- Run `lint_applet` to ensure adherence to codebase style standards.

### User Flow Verification
1. **Dropdown Switch**: Select `SPT 4.0.13` in the dropdown -> verify all cards display `SPT 4.0.13` (violet badge).
2. **Switch to 3.11.4**: Select `SPT 3.11.4` -> verify cards display `SPT 3.11.4` (amber badge).
3. **Switch to All SPT Versions**: Select `All SPT Versions` -> verify cards display the user's installed version (`SPT 4.1.6`).
4. **Install Matching Release**: Click "Install" on a mod while an older or specific SPT version is selected -> verify the installer targets the release compatible with that version.
