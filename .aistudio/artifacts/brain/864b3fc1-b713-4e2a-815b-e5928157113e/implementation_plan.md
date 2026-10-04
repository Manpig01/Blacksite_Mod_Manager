# Modpack Tools & Community Loadouts Tab

A dedicated navigation tab in Blacksite Mod Manager for creating, importing, sharing, and snapshotting complete Single Player Tarkov modpacks and loadout configurations.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The user confirmed that this major addition should be integrated as a **new dedicated navigation tab** ("Modpacks" / "Loadouts") in the primary navigation header, alongside Browse, Installed, Analytics, and Settings.

- **Navigation Integration**: A 5th primary tab labeled `Modpacks` with icon indicator and active preset counter.
- **Loadout Share & Import Engine**: Supports raw JSON manifest imports, file drops (`.json`), and compact Base64 share codes with a full dry-run diff preview before applying.
- **Curated SPT Presets**: 4 built-in community loadouts (Hardcore Realism, Visual Fidelity, Fika Co-op Base, Lightweight AI) with 1-click application.
- **Instant Snapshots & Rollback**: Create named loadout checkpoints (e.g., "Pre-Update Backup") with single-click restoration of enabled/disabled states and load orders.

---

### 1. Overview & Core Concept

- **What It Does**: Provides an end-to-end modpack management hub. Players can import friend loadouts, test curated community packs, and take non-destructive snapshots of their working mod loadouts with instant rollback if SPT crashes or conflicts arise.
- **Target Audience**: SPT players sharing loadouts on Discord/forums, players wanting quick starter modpacks without manually assembling 15+ mods, and players wanting safety checkpoints before updating or testing new mods.
- **Key Value**: Eliminates the frustration of broken loadouts and tedious manual mod synchronization by providing automated diff analysis, instant preset activation, and safe snapshot checkpoints.

---

### 2. User Experience & Visual Design

#### Key User Flows
1. **Curated Presets Carousel / Grid**:
   - User browses curated presets with tactical tags, SPT compatibility badges, and mod summaries.
   - Clicking *"Inspect Loadout"* opens a detailed modal showing which mods are installed vs missing, with an *"Apply Preset"* button that automatically adjusts active states and queues missing mods.
2. **Import Modpack / Loadout Wizard**:
   - User clicks *"Import Loadout"* and can either drag-and-drop a JSON manifest file, paste raw JSON, or enter a compact Base64 share code.
   - An interactive dry-run preview displays:
     - Exact mods to be activated
     - Active mods that will be disabled
     - Missing mods that need installation from `sp-mod.com`
   - User clicks *"Confirm & Apply"*, applying the loadout seamlessly with toast notifications.
3. **Snapshot & Checkpoint Rollback**:
   - User clicks *"Create Snapshot"*, gives it a label (e.g., *"Stable 4.1.6 - SAIN 3.0.5"*), and saves it.
   - The snapshot history displays timestamp, active mod count, and load order summary.
   - Clicking *"Rollback"* instantly restores the exact state without needing to re-download files.

#### Visual Identity & Theme
- **Color Discipline**: Strict 60-30-10 palette adhering to Blacksite dark tactical style:
  - Canvas: `#121418` dark slate
  - Structural cards: `#181B20` with `#23272E` hairline borders and subtle hover rings
  - Accent budget: `#EA580C` tactical orange and `#22C55E` success emerald for primary actions
- **Typography & Layout**:
  - Tabular numerals (`font-mono tabular-nums`) for mod counts, versions, and timestamps.
  - Zero-pill metadata: quiet text with subtle `·` separators.
  - No code comments in headers (`//`), no fake telemetry tickers.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Full-Screen Dedicated Tab vs Drawer Modal**:
  - *Chosen Approach*: New top-level navigation tab (`activeTab === 'modpacks'`).
  - *Why*: Accommodates curated cards, snapshot timelines, and the import wizard without cramping existing views or cluttering the Installed tab.
- **Decision 2: Non-Destructive Preset Application**:
  - *Chosen Approach*: Applying a preset or snapshot modifies enabled/disabled flags and load orders, but never deletes unmentioned mods from disk unless explicitly requested.
  - *Why*: Protects user mod installations and custom configurations from accidental deletion.
- **Decision 3: Local Storage Persistence**:
  - *Chosen Approach*: Custom snapshots and preset states persist in `localStorage` under `blacksite_snapshots_v1` via `storageService`.
  - *Why*: Zero server dependencies, instantaneous performance, and offline reliability.

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                               Header                                   │
│  [Browse Mods]  [Installed Mods]  [Modpacks]  [Analytics]  [Settings]   │
└────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                            ModpacksTab                                 │
│  ┌───────────────────────┐ ┌───────────────────┐ ┌───────────────────┐ │
│  │  Import / Share Hub   │ │  Curated Presets  │ │  Saved Snapshots  │ │
│  │  - JSON Drop / Paste  │ │  - Hardcore 2026  │ │  - Checkpoint #1  │ │
│  │  - Share Code Decode  │ │  - Visual Immersion│ │  - Checkpoint #2  │ │
│  │  - Diff Inspector     │ │  - Fika Co-op Base│ │  - Restore Button │ │
│  └───────────────────────┘ └───────────────────┘ └───────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                           StorageService                               │
│  - loadSnapshots() / saveSnapshots()                                   │
│  - generateShareCode() / parseShareCode()                              │
│  - applyLoadoutDiff(installedMods, targetManifest)                     │
└────────────────────────────────────────────────────────────────────────┘
```

#### Key Data Interfaces
```typescript
export interface ModpackSnapshot {
  id: string;
  name: string;
  notes?: string;
  createdAt: string;
  sptVersion: string;
  enabledModIds: string[];
  totalModsCount: number;
  manifest: Record<string, { version: string; loadOrder?: number }>;
}

export interface CuratedPreset {
  id: string;
  title: string;
  tagline: string;
  author: string;
  sptVersion: string;
  category: 'Hardcore' | 'Immersion' | 'Multiplayer' | 'Performance';
  description: string;
  modIds: string[];
  recommendedLoadOrders?: Record<string, number>;
}
```

---

### 5. Implementation Steps

1. **Types & Storage Service Updates (`src/types.ts`, `src/services/storageService.ts`)**:
   - Define `ModpackSnapshot` and `CuratedPreset` interfaces.
   - Add snapshot persistence (`loadSnapshots`, `saveSnapshot`, `deleteSnapshot`).
   - Add share code generator and decoder (compact JSON + Base64 encoding).
2. **Curated Presets Catalog (`src/data/curatedPresets.ts`)**:
   - Populate 4 realistic community presets using verified SPT mod GUIDs from the catalog.
3. **Modpack Tools Tab (`src/components/ModpacksTab.tsx`)**:
   - Build 3-section layout: Top Action Hub (Import & New Snapshot), Curated Presets Grid, and Snapshots Timeline.
   - Implement interactive Diff Inspector showing exact changes before applying any loadout.
4. **App Navigation Mounting (`src/App.tsx`)**:
   - Add `'modpacks'` to navigation tabs in `src/App.tsx`.
   - Wire handlers for applying presets, restoring snapshots, and queueing missing mods.
5. **Verification**:
   - Run `compile_applet` and `lint_applet` to verify zero type or build errors.
