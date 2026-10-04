import { InstalledMod, SettingsState, ModProfile, ConflictInfo, ModpackSnapshot, LoadoutManifest } from '../types';
import { INITIAL_INSTALLED_MODS, INITIAL_PROFILES, INITIAL_CONFLICTS } from '../data/fixtureCatalog';

const SETTINGS_KEY = 'blacksite_settings_v1';
const INSTALLED_MODS_KEY = 'blacksite_installed_mods_v1';
const PROFILES_KEY = 'blacksite_profiles_v1';
const CONFLICT_IGNORES_KEY = 'blacksite_conflict_ignores_v1';
const FAVORITE_MODS_KEY = 'blacksite_favorite_mods_v1';
const SNAPSHOTS_KEY = 'blacksite_snapshots_v1';

const DEFAULT_SETTINGS: SettingsState = {
  sptDirectory: 'C:\\SPT',
  sptVersion: '4.1.6',
  detectedServerBinary: 'SPT.Server.exe',
  clientModPath: 'BepInEx/plugins',
  serverModPath: 'SPT_Runtime/user/mods',
  isSpt4xLayout: true,
  activeProfileId: 'prof-1',
  autoCheckUpdates: true,
  downloadStallTimeoutSeconds: 60,
  theme: 'dark',
  showRecommendedMods: true,
};

const DEFAULT_KNOWN_DEPS: Record<string, string[]> = {
  'me.sol.sain': ['xyz.drakia.bigbrain'],
  'xyz.drakia.questingbots': ['xyz.drakia.bigbrain', 'me.sol.sain', 'xyz.drakia.waypoints'],
  'xyz.drakia.lootingbots': ['xyz.drakia.bigbrain'],
  'xyz.drakia.waypoints': ['xyz.drakia.bigbrain'],
};

const DEFAULT_INITIAL_TAGS: Record<string, { id: string; name: string; color: string }[]> = {
  'xyz.drakia.bigbrain': [
    { id: 'tag-core', name: 'Core AI', color: '#8B5CF6' },
    { id: 'tag-essential', name: 'Essential', color: '#10B981' },
  ],
  'fika.ghostfenixx.svm': [
    { id: 'tag-server', name: 'Server', color: '#F59E0B' },
    { id: 'tag-overhaul', name: 'Overhaul', color: '#EC4899' },
  ],
  'me.sol.sain': [
    { id: 'tag-core', name: 'Core AI', color: '#8B5CF6' },
    { id: 'tag-combat', name: 'Combat', color: '#EF4444' },
  ],
  'com.amanda.graphics': [{ id: 'tag-visuals', name: 'Visuals', color: '#06B6D4' }],
};

export const storageService = {
  loadSettings(): SettingsState {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const merged: SettingsState = { ...DEFAULT_SETTINGS, ...parsed };
        // Migrate SPT 4.x setups from legacy user/mods to modern SPT_Runtime/user/mods
        if (merged.sptVersion?.startsWith('4') && merged.serverModPath === 'user/mods') {
          merged.serverModPath = 'SPT_Runtime/user/mods';
        }
        return merged;
      }
    } catch {
      // ignore
    }
    return DEFAULT_SETTINGS;
  },

  saveSettings(settings: SettingsState): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }
  },

  loadInstalledMods(): InstalledMod[] {
    try {
      const saved = localStorage.getItem(INSTALLED_MODS_KEY);
      if (saved) {
        let parsed: InstalledMod[] = JSON.parse(saved);
        // Purge legacy mock patch if present from previous sessions
        if (parsed.some((m) => m.id === 'me.sol.sain.legacy-patch')) {
          parsed = parsed.filter((m) => m.id !== 'me.sol.sain.legacy-patch');
          localStorage.setItem(INSTALLED_MODS_KEY, JSON.stringify(parsed));
        }
        return parsed.map((m, idx) => ({
          ...m,
          loadOrder: typeof m.loadOrder === 'number' ? m.loadOrder : idx + 1,
          dependencies: m.dependencies ?? DEFAULT_KNOWN_DEPS[m.id] ?? [],
          tags: m.tags ?? DEFAULT_INITIAL_TAGS[m.id] ?? [],
        }));
      }
    } catch {
      // ignore
    }
    return INITIAL_INSTALLED_MODS.map((m, idx) => ({
      ...m,
      loadOrder: typeof m.loadOrder === 'number' ? m.loadOrder : idx + 1,
      dependencies: m.dependencies ?? DEFAULT_KNOWN_DEPS[m.id] ?? [],
      tags: m.tags ?? DEFAULT_INITIAL_TAGS[m.id] ?? [],
    }));
  },

  saveInstalledMods(mods: InstalledMod[]): void {
    try {
      localStorage.setItem(INSTALLED_MODS_KEY, JSON.stringify(mods));
    } catch {
      // ignore
    }
  },

  loadProfiles(): ModProfile[] {
    try {
      const saved = localStorage.getItem(PROFILES_KEY);
      if (saved) {
        const parsed: ModProfile[] = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.map((p) =>
            p.id === 'prof-1'
              ? {
                  ...p,
                  enabledModIds: [],
                  description: 'Clean vanilla profile with zero active mods',
                }
              : p
          );
        }
      }
    } catch {
      // ignore
    }
    return INITIAL_PROFILES;
  },

  saveProfiles(profiles: ModProfile[]): void {
    try {
      localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
    } catch {
      // ignore
    }
  },

  loadIgnoredConflicts(): string[] {
    try {
      const saved = localStorage.getItem(CONFLICT_IGNORES_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return [];
  },

  saveIgnoredConflicts(ignores: string[]): void {
    try {
      localStorage.setItem(CONFLICT_IGNORES_KEY, JSON.stringify(ignores));
    } catch {
      // ignore
    }
  },

  loadFavoriteModIds(): number[] {
    try {
      const saved = localStorage.getItem(FAVORITE_MODS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  },

  saveFavoriteModIds(modIds: number[]): void {
    try {
      localStorage.setItem(FAVORITE_MODS_KEY, JSON.stringify(modIds));
    } catch {
      // ignore
    }
  },

  toggleFavoriteMod(modId: number): boolean {
    const current = this.loadFavoriteModIds();
    const set = new Set(current);
    let isFav = false;
    if (set.has(modId)) {
      set.delete(modId);
      isFav = false;
    } else {
      set.add(modId);
      isFav = true;
    }
    this.saveFavoriteModIds(Array.from(set));
    return isFav;
  },

  isModFavorite(modId: number): boolean {
    const set = new Set(this.loadFavoriteModIds());
    return set.has(modId);
  },

  detectConflicts(installedMods: InstalledMod[], ignoredIds: string[]): ConflictInfo[] {
    const conflicts: ConflictInfo[] = [];
    const dllMap = new Map<string, { modId: string; modName: string }[]>();
    const packageMap = new Map<string, { modId: string; modName: string }[]>();

    for (const mod of installedMods) {
      if (mod.isDisabled) continue;

      if (mod.clientPath) {
        const fileName = mod.clientPath.split('/').pop()?.toLowerCase();
        if (fileName && fileName.endsWith('.dll')) {
          if (!dllMap.has(fileName)) dllMap.set(fileName, []);
          dllMap.get(fileName)!.push({ modId: mod.id, modName: mod.name });
        }
      }

      if (mod.id) {
        const pkg = mod.id.toLowerCase();
        if (!packageMap.has(pkg)) packageMap.set(pkg, []);
        packageMap.get(pkg)!.push({ modId: mod.id, modName: mod.name });
      }
    }

    // Check duplicate DLLs
    for (const [dll, list] of dllMap.entries()) {
      if (list.length > 1) {
        const conflictId = `conflict-dll-${dll}`;
        if (!ignoredIds.includes(conflictId)) {
          conflicts.push({
            id: conflictId,
            conflictingModIds: list.map(x => x.modId),
            conflictingModNames: list.map(x => x.modName),
            duplicateItem: dll,
            itemType: 'dll',
            details: `Multiple active mods install the same client DLL: ${dll}`
          });
        }
      }
    }

    // Check duplicate package IDs
    for (const [pkg, list] of packageMap.entries()) {
      if (list.length > 1) {
        const conflictId = `conflict-pkg-${pkg}`;
        if (!ignoredIds.includes(conflictId)) {
          conflicts.push({
            id: conflictId,
            conflictingModIds: list.map(x => x.modId),
            conflictingModNames: list.map(x => x.modName),
            duplicateItem: pkg,
            itemType: 'package_id',
            details: `Duplicate package ID registered in user/mods: ${pkg}`
          });
        }
      }
    }

    return conflicts;
  },

  loadSnapshots(): ModpackSnapshot[] {
    try {
      const saved = localStorage.getItem(SNAPSHOTS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [
      {
        id: 'snap-baseline-416',
        name: 'Vanilla Baseline Checkpoint',
        notes: 'Clean baseline backup before installing experimental combat plugins.',
        createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
        sptVersion: '4.1.6',
        enabledModIds: ['xyz.drakia.bigbrain', 'fika.ghostfenixx.svm'],
        totalModsCount: 2,
        modSnapshots: [
          {
            id: 'xyz.drakia.bigbrain',
            name: 'BigBrain',
            version: '1.1.2',
            isDisabled: false,
            loadOrder: 1,
            kind: 'Client',
          },
          {
            id: 'fika.ghostfenixx.svm',
            name: 'Server Value Modifier [SVM]',
            version: '1.9.0',
            isDisabled: false,
            loadOrder: 2,
            kind: 'Both',
          },
        ],
      },
    ];
  },

  saveSnapshots(snapshots: ModpackSnapshot[]): void {
    try {
      localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots));
    } catch {
      // ignore
    }
  },

  createSnapshot(
    name: string,
    notes: string | undefined,
    sptVersion: string,
    installedMods: InstalledMod[]
  ): ModpackSnapshot {
    const newSnapshot: ModpackSnapshot = {
      id: `snap-${Date.now()}`,
      name: name.trim() || `Snapshot ${new Date().toLocaleDateString()}`,
      notes: notes?.trim() || undefined,
      createdAt: new Date().toISOString(),
      sptVersion,
      enabledModIds: installedMods.filter((m) => !m.isDisabled).map((m) => m.id),
      totalModsCount: installedMods.length,
      modSnapshots: installedMods.map((m) => ({
        id: m.id,
        name: m.name,
        version: m.version,
        isDisabled: m.isDisabled,
        loadOrder: m.loadOrder,
        kind: m.kind,
      })),
    };

    const existing = this.loadSnapshots();
    const updated = [newSnapshot, ...existing];
    this.saveSnapshots(updated);
    return newSnapshot;
  },

  deleteSnapshot(id: string): void {
    const existing = this.loadSnapshots();
    const updated = existing.filter((s) => s.id !== id);
    this.saveSnapshots(updated);
  },

  generateShareCode(manifest: LoadoutManifest): string {
    try {
      const json = JSON.stringify(manifest);
      const encoded = btoa(encodeURIComponent(json));
      return `BS-${encoded}`;
    } catch {
      return '';
    }
  },

  parseShareCode(input: string): LoadoutManifest | null {
    try {
      const trimmed = input.trim();
      let rawJson = trimmed;

      if (trimmed.startsWith('BS-')) {
        const base64 = trimmed.slice(3);
        rawJson = decodeURIComponent(atob(base64));
      }

      const parsed = JSON.parse(rawJson);
      if (parsed && Array.isArray(parsed.mods)) {
        return parsed as LoadoutManifest;
      }
    } catch {
      // invalid JSON or share code
    }
    return null;
  },
};
