import { InstalledMod, SettingsState, ModProfile, ConflictInfo } from '../types';
import { INITIAL_INSTALLED_MODS, INITIAL_PROFILES, INITIAL_CONFLICTS } from '../data/fixtureCatalog';

const SETTINGS_KEY = 'blacksite_settings_v1';
const INSTALLED_MODS_KEY = 'blacksite_installed_mods_v1';
const PROFILES_KEY = 'blacksite_profiles_v1';
const CONFLICT_IGNORES_KEY = 'blacksite_conflict_ignores_v1';

const DEFAULT_SETTINGS: SettingsState = {
  sptDirectory: 'C:\\Games\\SPT-Tarkov',
  sptVersion: '4.0.12',
  detectedServerBinary: 'SPT.Server.exe',
  clientModPath: 'BepInEx/plugins',
  serverModPath: 'SPT_Runtime/user/mods',
  isSpt4xLayout: true,
  activeProfileId: 'prof-1',
  autoCheckUpdates: true,
  downloadStallTimeoutSeconds: 60,
  theme: 'dark',
};

const DEFAULT_KNOWN_DEPS: Record<string, string[]> = {
  'me.sol.sain': ['xyz.drakia.bigbrain'],
  'me.sol.sain.legacy-patch': ['xyz.drakia.bigbrain', 'me.sol.sain', 'xyz.drakia.waypoints'],
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
  'me.sol.sain.legacy-patch': [{ id: 'tag-legacy', name: 'Legacy', color: '#6B7280' }],
};

export const storageService = {
  loadSettings(): SettingsState {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
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
        if (!parsed.some((m) => m.id === 'me.sol.sain.legacy-patch')) {
          const sample = INITIAL_INSTALLED_MODS.find((m) => m.id === 'me.sol.sain.legacy-patch');
          if (sample) parsed.push(sample);
        }
        return parsed.map((m, idx) => ({
          ...m,
          loadOrder: typeof m.loadOrder === 'number' ? m.loadOrder : idx + 1,
          dependencies:
            m.id === 'me.sol.sain.legacy-patch' && (!m.dependencies || !m.dependencies.includes('xyz.drakia.waypoints'))
              ? DEFAULT_KNOWN_DEPS['me.sol.sain.legacy-patch']
              : m.dependencies ?? DEFAULT_KNOWN_DEPS[m.id] ?? [],
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
      if (saved) return JSON.parse(saved);
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
  }
};
