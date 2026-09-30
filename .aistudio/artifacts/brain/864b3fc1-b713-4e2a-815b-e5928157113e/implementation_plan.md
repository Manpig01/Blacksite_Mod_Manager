# Clean Release: Removal of SAIN Legacy AI Extension Mock Entry

This plan outlines the removal of the mock `SAIN Legacy AI Extension` entry (`me.sol.sain.legacy-patch`) from the default installed loadout and dependency graph so that fresh installations start with clean, un-flagged mod configurations.

### User Review & Critical Decisions

> [!IMPORTANT]
> The user confirmed the removal of the specific mock entry `SAIN Legacy AI Extension` rather than wiping all default installed mods.

- **Confirmed Decision 1**: Remove the `me.sol.sain.legacy-patch` mock entry from `INITIAL_INSTALLED_MODS`.
- **Confirmed Decision 2**: Clean up the dependency mapping in `DEFAULT_KNOWN_DEPS` and default profiles in `INITIAL_PROFILES` so no missing dependency warnings (`me.sol.sain` or `xyz.drakia.waypoints`) are triggered on startup.
- **Recommended Default**: Retain valid foundational mods (e.g. `xyz.drakia.bigbrain`, `fika.ghostfenixx.svm`, `me.sol.sain`, `com.amanda.graphics`) as healthy, working presets for new users, without dummy error states.

---

### 1. Overview & Core Concept

- **What It Does**: Cleans up the installed mods list by purging the placeholder `SAIN Legacy AI Extension` mod card and its unsatisfied dependencies.
- **Target Audience**: SPT players downloading the Windows release who want clean, production-grade loadout management without phantom dependency errors.
- **Key Value**: Delivers an error-free out-of-the-box state where all pre-installed or imported mods are verified and functional.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. User launches Blacksite Mod Manager.
  2. The "Installed Mods" tab shows verified, healthy mods with 0 warning banners or missing dependency alerts.
  3. The orange missing dependency badge (`1 Missing Dependencies`) will no longer appear on the toolbar.
  4. Users can install mods normally from the Browse Mods tab or local archives without encountering residual mock conflicts.
- **Visual Identity & Theme**:
  - Tactical military HUD styling (slate-900 `#121418`, card `#181B20`, orange `#EA580C`, green `#16A34A`).
  - No broken dependency cards or meme thumbnails in the default view.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Targeted Mock Removal vs. Empty State**:
  - *Chosen Approach*: Specifically remove `me.sol.sain.legacy-patch` from initial data fixtures and storage defaults.
  - *Why*: Users get a working demo loadout (BigBrain, SVM, SAIN, Amands Graphics) demonstrating mod management, ordering, and config editing without broken dependencies.
  - *Alternatives Considered*: Wiping all default mods would leave new users with an empty list and require setting up paths before exploring features.

- **Decision 2: Storage Migration for Existing Local Profiles**:
  - *Chosen Approach*: In `storageService.ts`, filter out `me.sol.sain.legacy-patch` if present in cached installed mods or loadout profiles on startup.
  - *Why*: Ensures existing dev/test browser cache sessions immediately reflect the clean state without manual localStorage clearing.

---

### 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                       Data Layer                            │
│  ┌──────────────────────────┐   ┌────────────────────────┐  │
│  │ fixtureCatalog.ts        │   │ storageService.ts      │  │
│  │ - Remove legacy patch    │   │ - Filter out legacy ID │  │
│  │ - Clean INITIAL_PROFILES │   │ - Clean known deps map │  │
│  └─────────────┬────────────┘   └───────────┬────────────┘  │
└────────────────┼────────────────────────────┼───────────────┘
                 │                            │
                 ▼                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      State Layer                            │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ App.tsx: installedMods State                          │  │
│  │ - No missing dependency warning badges                │  │
│  │ - Clean load order sequencing                         │  │
│  └──────────────────────────┬────────────────────────────┘  │
└─────────────────────────────┼───────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       UI Layer                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ InstalledModsTab.tsx                                  │  │
│  │ - BigBrain (#1), SVM (#2), SAIN (#3), Graphics (#4)   │  │
│  │ - Missing Dependencies badge hidden                   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

- **Interactive State Transitions**:
  - On launch, `loadInstalledMods()` sanitizes installed mods by filtering out any residual `me.sol.sain.legacy-patch` entries.
  - Missing dependency detection computes `dependencies.filter(dep => !installedIds.has(dep))`. With no unsatisfied dependencies, the `Missing Dependencies` alert count resolves to 0.
