# Phase 4: Tactical Mod Profiles, Instant Loadout Swapper & Sharing Hub

Phase 4 elevates Blacksite from an installation engine to a comprehensive loadout orchestration platform. It delivers **isolated mod profiles**, **instant zero-copy VFS switching**, an **interactive profile comparison matrix**, and **portable `.bsite` loadout bundle export/import** with automated Forge dependency resolution.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural parameters have been established based on recommended standards for Single Player Tarkov (SPT) loadout management:

- **Confirmed Decision 1 (Core Focus)**: Implement a dedicated Profile Management suite featuring instant loadout switching, side-by-side profile comparison, and export/import `.bsite` bundles.
- **Confirmed Decision 2 (Save Data Linking)**: Link specific Tarkov player profiles (`user/profiles/*.json`) to mod loadouts so character progress matches installed weapon/item mods, while maintaining global safety backups.
- **Confirmed Decision 3 (Package Format)**: Utilize lightweight, reproducible `.bsite` JSON/ZIP manifests containing mod identifiers, Forge download links, load order rules, and user config diffs rather than bloated binary-only zips.

---

## 1. Overview & Core Concept

- **What It Does**: Enables players to maintain separate mod configurations (e.g. *Hardcore Realism*, *High-Performance Streamer*, *Vanilla Testing*, *Stalker Tarkov*) and hot-swap between them in under 200ms using Blacksite's NTFS Hardlink VFS. Users can visually compare any two loadouts, resolve discrepancies, and export/import their entire loadout as a shareable `.bsite` file.
- **Target Audience / Persona**: SPT players running distinct mod combinations for different playthroughs, content creators sharing curated mod lists with communities, and mod testers troubleshooting mod incompatibilities.
- **Key Value**: Eliminates tedious manual toggling of dozens of mods, prevents save file corruption caused by loading items missing from current mods, and enables frictionless 1-click community loadout sharing.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Profile Creation & Quick-Swap**:
   - User opens the **Profiles** tab or clicks the profile dropdown in the top bar.
   - User selects an existing profile or creates a new one from scratch or by cloning the active loadout.
   - Switching triggers an instant NTFS VFS relink; the UI updates with an animated confirmation and active mod count summary.
2. **Visual Loadout Comparison (Diff Matrix)**:
   - User selects "Compare Profiles" to inspect two loadouts side-by-side.
   - Split-screen comparison identifies identical mods, loadout-exclusive mods, version mismatches, and custom config differences.
   - Quick-action buttons allow instant syncing of specific mods from one profile into the other.
3. **Exporting a `.bsite` Manifest**:
   - User clicks "Export Loadout Bundle" on any profile.
   - Configures bundle metadata (Name, Description, Author, SPT Version Target, include custom config overrides).
   - Generates a lightweight `.bsite` manifest file ready to share with friends or community discords.
4. **Importing & Batch Installing**:
   - User drags-and-drops or selects a `.bsite` file.
   - Blacksite performs pre-flight verification: checks SPT compatibility, identifies which mods are already cached in `.blacksite_library`, and highlights missing dependencies.
   - 1-click "Install Missing Mods & Activate" batches downloads directly via the Forge API.

### Visual Identity & Theme

- **Aesthetic Direction**: Tactical military HUD / Classified terminal aesthetic (`slate-950` obsidian backdrop, `zinc-800` panel boundaries, `emerald-400` status indicators, `amber-400` conflict/sync accents).
- **Typography & Hierarchy**: High-contrast monospaced data readouts (`font-mono` for hashes, versions, file counts) paired with clean geometric sans (`Inter`/system) for controls and section headings.
- **Anti-Slop Restraint**: Zero decorative rounded pills for metadata. Information is rendered with quiet typographic dividers (`·`, `/`). Functional filter segments and profile selectors use crisp, interactive segmented controls.
- **Interactive Feedback**:
   - Smooth pulse indicators on active profile cards.
   - Real-time diff badges displaying delta counts (`+4 mods`, `-2 mods`, `1 version diff`).
   - Non-blocking toast notifications and progress overlays during batch Forge installations.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: VFS Profile Relinking vs. Mod Disabling
- **Chosen Approach**: Profile activation dynamically repoints hardlinks in `SPT_Runtime/user/mods` and `BepInEx/plugins` to match the target profile's enabled set, drawing from `.blacksite_library`.
- **Why**: Switching profiles takes <150ms and consumes 0 additional disk space, regardless of whether 10 or 200 mods are active.
- **Alternatives Considered**: Renaming directories with `.disabled` suffixes or duplicating mod folders. Discarded due to folder clutter, slow file copy times, and potential BepInEx loader scan errors.

### Decision 2: Save Account Association
- **Chosen Approach**: Profiles optionally link to an SPT player profile ID (e.g. `user/profiles/account123.json`). When switching to a loadout, Blacksite sets the active SPT launcher profile preference.
- **Why**: Modded weapons, armors, and traders inject custom item IDs into character inventories. Switching modsets without switching character accounts can result in corrupt or wiped inventories.
- **Alternatives Considered**: Forcing a single character across all mod profiles or completely sandboxing save directories. Sandboxing complicates manual backups; linking provides seamless safety without hiding files.

### Decision 3: `.bsite` Manifest Architecture
- **Chosen Approach**: Standardized JSON manifest (optionally zipped with customized configuration files). Contains mod IDs, versions, Forge URLs, load orders, and config diffs.
- **Why**: Keeps sharing payloads tiny (<100KB) while allowing Blacksite's automated installer to download missing assets with progress tracking.
- **Alternatives Considered**: Zipping 10GB of game mods together. Discarded due to distribution size, copyright rehosting issues, and network bandwidth costs.

---

## 4. Technical Architecture & Data Strategy

### System & Component Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Blacksite Main Interface                        │
├───────────────────┬────────────────────────────────────────────────────┤
│  Top Bar Switcher │  Active Profile Indicator & Quick Dropdown         │
├───────────────────┴────────────────────────────────────────────────────┤
│                       Profiles Management Tab                          │
│ ┌───────────────────────────┐ ┌──────────────────────────────────────┐ │
│ │ Profile Deck (Cards)      │ │ Loadout Details & Inspector          │ │
│ │  - Active Indicator       │ │  - Mod Roster & Load Order           │ │
│ │  - Mod Count & Total Size │ │  - Linked Tarkov Character Profile   │ │
│ │  - Clone / Delete / Edit  │ │  - Export .bsite / Compare Button    │ │
│ └───────────────────────────┘ └──────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────────────┤
│                       Modal & Tool Dialogs                             │
│ ┌─────────────────────────┐ ┌───────────────────┐ ┌──────────────────┐ │
│ │ Profile Compare (Diff)  │ │ .bsite Export     │ │ .bsite Import &  │ │
│ │ Side-by-Side Mod Delta  │ │ Metadata & Config │ │ Batch Downloader │ │
│ └─────────────────────────┘ └───────────────────┘ └──────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Profile Engine (`services/profileService.ts`)            │
│  - CRUD operations for ModProfile instances                            │
│  - Diff generator: computeProfileDiff(profileA, profileB)              │
│  - Manifest serializer & deserializer (.bsite)                         │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│            VFS Fast Relinker (`electron/modInstaller.cjs`)             │
│  - Atomic hardlink sync against target profile manifest                │
│  - Cleans orphaned links & deploys missing links from depot            │
│  - Updates SPT launcher profile mapping in `user/profiles/`            │
└────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State

```typescript
export interface ModProfile {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  isDefault?: boolean;
  enabledModIds: string[];
  customLoadOrder?: Record<string, number>;
  linkedSptProfileId?: string; // e.g. "65a1b2c3d4e5f67890"
  modConfigs?: Record<string, Record<string, any>>; // Custom config overrides
  tags: string[];
  bannerColor?: string;
}

export interface ProfileDiffResult {
  commonMods: InstalledMod[];
  onlyInProfileA: InstalledMod[];
  onlyInProfileB: InstalledMod[];
  versionMismatches: {
    modId: string;
    modName: string;
    versionA: string;
    versionB: string;
  }[];
}

export interface BsiteBundleManifest {
  formatVersion: '1.0';
  manifestType: 'blacksite_loadout_bundle';
  metadata: {
    name: string;
    description: string;
    author: string;
    targetSptVersion: string;
    exportedAt: string;
    modCount: number;
  };
  mods: {
    id: string;
    guid?: string;
    name: string;
    version: string;
    author?: string;
    downloadUrl?: string;
    sourceHubId?: number;
    required: boolean;
    loadPriority?: number;
  }[];
  configOverrides?: Record<string, string>; // relative path -> serialized JSON/INI
}
```

### Key Sequences & Integrations

1. **Profile Activation Sequence**:
   - `handleSelectProfile(profileId)` -> invokes `profileService.activateProfile(profileId)`.
   - VFS relinker examines current links in `user/mods` and `BepInEx/plugins`.
   - Unlinks mods absent from the target profile; hardlinks enabled mods from `.blacksite_library`.
   - Fires conflict resolver to ensure the target loadout has zero circular loops or unresolved critical collisions.
   - Emits status update and displays profile switch toast.

2. **Bundle Export & Import Workflow**:
   - **Export**: Reads profile's active mods, fetches canonical download links from Forge metadata, bundles modified config files into a `.bsite` JSON/ZIP, and triggers native file save.
   - **Import**: Parses `.bsite`, analyzes existing local mods vs. required mods, queries Forge API for missing items, presents pre-installation modal with download queue, and provisions new profile.

---

## Validation & Verification

1. **Profile Lifecycle Testing**:
   - Verify creating, editing, cloning, and deleting profiles with state persistence in `storageService`.
   - Verify active profile switching correctly updates the mod list and active status in the UI.
2. **Profile Comparison & Sync Testing**:
   - Verify diff engine calculates exact common, unique-A, unique-B, and version delta sets.
   - Verify 1-click sync action accurately updates the recipient profile's enabled mods list.
3. **Import/Export Verification**:
   - Export a profile to `.bsite` file and verify manifest JSON structure.
   - Import `.bsite` into a new profile and verify dependency resolution and configuration restoration.
4. **Build & Lint Verification**:
   - Run `npm run lint` and `compile_applet` to ensure zero compilation or type errors.
