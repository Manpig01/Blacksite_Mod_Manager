# Addons Tab & Parent Mod Dependency Integration

Add a dedicated **Addons** top-level navigation tab to Blacksite Mod Manager powered by the official Forge API (`/api/v0/addons`), featuring live search, sort, parent base mod verification, and one-click desktop installation with automatic parent mod companion prompts.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions were confirmed in Phase 1 interactive clarification:

- **Confirmed Decision 1 (Navigation Structure)**: Dedicated top navigation tab alongside "Browse Mods", "Installed Mods", "Modpack Tools", and "Settings".
- **Confirmed Decision 2 (Dependency Resolution)**: When installing an addon, Blacksite verifies whether the parent mod is installed. If missing, a clear companion prompt presents the option to install both the parent mod and addon in a single operation or install the addon standalone.

---

### 1. Overview & Core Concept

- **What It Does**: Adds an **Addons** tab directly accessible from the main header. Players can explore, search, filter, and sort addons published on Forge (`sp-mod.com`), inspect version constraints, see parent mod associations (such as Questing Bots, SAIN, Realism), and install them directly into their SPT directory.
- **Target Audience / Persona**: SPT (Single Player Tarkov) players who want companion sub-mods, voice packs, translations, AI compatibility patches, and config expansions without having to manually search the web or track parent mod prerequisites by hand.
- **Key Value**: Eliminates broken mod setups caused by installing companion addons without their required parent base mods, while giving addons a prominent, dedicated catalog experience.

---

### 2. User Experience & Visual Design

#### Key User Flows
1. **Catalog Browsing**: The player clicks **Addons** in the top navigation bar. A responsive grid of addon cards displays thumbnails, titles, authors, download counters, release dates, and parent mod badges.
2. **Search & Filter**: Players can filter addons by search query, sort order (Latest Release, Most Downloaded, Alphabetical), and filter by specific parent mods or favorites.
3. **Parent Mod Verification & Installation**:
   - The player clicks **Install** on an addon (e.g. *Questing Bots Fika Sync*).
   - If the parent mod (*Questing Bots*) is already present in `installedMods`, Blacksite queues the addon installation immediately with real progress tracking.
   - If the parent mod is missing, Blacksite displays a tactical confirmation modal:
     - Prominently showcases the parent mod name, thumbnail, and author.
     - Option 1: **Install Both (Recommended)** — queues the parent mod first, then queues the addon.
     - Option 2: **Install Addon Standalone** — proceeds with just the addon.
     - Option 3: **Cancel**.
4. **Detail & Version Inspection**: Clicking version history opens a version selection modal specific to the addon, allowing players to pick historical versions or check mod version constraints.

#### Visual Identity & Theme
- **Aesthetic Direction**: Tactical military HUD styling consistent with Blacksite's dark slate and amber industrial aesthetic.
- **Color Palette & Mood**:
  - Background Canvas: `#121418` (deep matte graphite)
  - Surface Containers: `#181B20` and `#20252D` with subtle borders (`#2B303C` / `#23272E`)
  - Accent / Primary Action: Tactical Amber (`#EA580C`)
  - Parent Mod Relation Link: Subtle Cyan/Sky accent (`#38BDF8`) for parent mod references
  - Text: Clean high-contrast whites (`#E8EAEE`) and muted steel grays (`#9AA3AF`)
- **Typography & Hierarchy**:
  - Clean font pairing with tabular monospace numbers for download metrics and version strings.
  - Zero-pill metadata discipline: dates, authors, and download counts formatted with clean typographical separators (`·`) without boxed badges.
- **Interactive Feedback**:
  - Smooth card hover lift with subtle amber accent boundary.
  - Installation button transitions from amber "Install" to green checkmark "Installed" when already present in the active SPT directory.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Dedicated Tab vs. Browse Sub-Filter**
  - *Chosen Approach*: Dedicated top navigation tab (`AddonsTab.tsx`).
  - *Why*: Addons have distinct metadata relationships (specifically `mod_id`, parent mod association, and `mod_version_constraint`) that benefit from dedicated filtering and distinct parent companion cards.
  - *Alternatives Considered*: Sub-filter inside Browse Mods was rejected because it clutters the main category filter and obscures addon-specific relationships.

- **Decision 2: Companion Detection & 1-Click Dual Queue**
  - *Chosen Approach*: Inspect `installedMods` for the parent mod by `modId`, `guid`, or slug. If missing, fetch the parent mod details from `/api/v0/mod/{modId}` and offer a 1-click dual install.
  - *Why*: Seamless user experience preventing broken runtime states without locking advanced users out of manual or custom setups.

- **Decision 3: Forge Addons API Client Architecture**
  - *Chosen Approach*: Add `getAddons` and `getAddonDetails` to `src/services/apiService.ts` utilizing `https://sp-mod.com/api/v0/addons` with query parameters (`query`, `sort`, `include=versions,mod`, pagination) and resilient error fallbacks.
  - *Why*: Matches existing API patterns, supports network timeout abort signals, and handles rate limiting smoothly.

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Blacksite Navigation Header                     │
│  [Browse Mods]      [Addons] *NEW*      [Installed]      [Modpacks]    │
└───────────────────────────┬────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          AddonsTab Component                           │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Search & Sort Controls (Query, Sort by Downloads/Recent, Reset)  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Addons Card Grid                                                 │  │
│  │   - Addon Thumbnail & Author                                     │  │
│  │   - Parent Mod Reference & Status ("Parent: Questing Bots ✓")    │  │
│  │   - Version Constraint & Download Metrics                        │  │
│  │   - One-Click Install & Version Picker Actions                   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Pagination Bar (Page numbers, Per Page selector)                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└───────────────────────────┬────────────────────────────────────────────┘
                            │
               ┌────────────┴────────────┐
               ▼                         ▼
┌───────────────────────────────┐ ┌──────────────────────────────────────┐
│       Parent Mod Check        │ │         apiService.getAddons         │
│ Installed? ──► Queue Addon    │ │ Endpoint: /api/v0/addons             │
│ Missing?   ──► CompanionModal │ │ Include:  versions,mod               │
└───────────────────────────────┘ └──────────────────────────────────────┘
```

#### Data Model Additions (`src/types.ts`)
```ts
export interface AddonVersion {
  id: number;
  version: string;
  link: string;
  content_length?: number;
  mod_version_constraint?: string;
  downloads: number;
  published_at?: string;
  created_at?: string;
}

export interface Addon {
  id: number;
  name: string;
  slug: string;
  teaser?: string;
  thumbnail: string;
  downloads: number;
  detail_url?: string;
  contains_ads?: boolean;
  mod_id: number;
  is_detached?: boolean;
  published_at?: string;
  created_at?: string;
  owner?: ModOwner;
  additional_authors?: ModOwner[];
  mod?: Mod;
  versions?: AddonVersion[];
}

export interface AddonQueryResult {
  addons: Addon[];
  total: number;
  currentPage: number;
  lastPage: number;
}
```

#### Interactive Component & State Mapping
- **`src/types.ts`**: Define `Addon`, `AddonVersion`, `AddonQueryResult`, and update navigation state (`activeTab: 'browse' | 'addons' | 'installed' | 'modpacks' | 'settings'`).
- **`src/services/apiService.ts`**: Implement `getAddons` and `getAddonDetails` querying `https://sp-mod.com/api/v0/addons` with parameters (`include=versions,mod`, `sort`, `query`, `page`, `per_page`).
- **`src/components/AddonsTab.tsx`**: New component rendering the responsive addons grid, search bar, parent mod link buttons, download counts, and install triggers.
- **`src/components/AddonCompanionModal.tsx`**: Tactical prompt displayed when installing an addon whose parent mod is not yet installed.
- **`src/App.tsx`**: Wire the `addons` tab into the navigation bar, state routing, and queue install pipeline.
