import { InstalledMod, SettingsState, ModProfile } from '../types';
import { INITIAL_PROFILES } from '../data/fixtureCatalog';
import { getKnownDependencyMeta } from '../data/knownDependencies';

const SETTINGS_KEY = 'blacksite_settings_v1';
const INSTALLED_MODS_KEY = 'blacksite_installed_mods_v1';
const PROFILES_KEY = 'blacksite_profiles_v1';
const CONFLICT_IGNORES_KEY = 'blacksite_conflict_ignores_v1';
const FAVORITE_MODS_KEY = 'blacksite_favorite_mods_v1';

let modsWriteTimer: ReturnType<typeof setTimeout> | null = null;
let pendingModsPayload: InstalledMod[] | null = null;
let profilesWriteTimer: ReturnType<typeof setTimeout> | null = null;
let pendingProfilesPayload: ModProfile[] | null = null;


const DEFAULT_SETTINGS: SettingsState = {
  sptDirectory: 'C:\\SPT',
  sptVersion: '4.1.6',
  detectedServerBinary: 'SPT.Server.exe',
  clientModPath: 'BepInEx/plugins',
  serverModPath: 'SPT/user/mods',
  isSpt4xLayout: true,
  activeProfileId: 'prof-default',
  autoCheckUpdates: true,
  downloadStallTimeoutSeconds: 60,
  theme: 'dark',
  showRecommendedMods: true,
  extractionPerformanceMode: 'balanced',
};

const DEFAULT_KNOWN_DEPS: Record<string, string[]> = {
  'me.sol.sain': ['xyz.drakia.bigbrain'],
  'xyz.drakia.questingbots': ['xyz.drakia.bigbrain', 'me.sol.sain', 'xyz.drakia.waypoints'],
  'xyz.drakia.lootingbots': ['xyz.drakia.bigbrain'],
  'xyz.drakia.waypoints': ['xyz.drakia.bigbrain'],
};

const LEGACY_DEMO_MOD_IDS = new Set([
  'xyz.drakia.bigbrain',
  'fika.ghostfenixx.svm',
  'me.sol.sain',
  'com.amanda.graphics',
  'me.sol.sain.legacy-patch',
]);

const LEGACY_DEMO_INSTALL_DATES = new Set([
  '2025-02-14',
  '2025-02-12',
  '2025-02-10',
  '2025-02-01',
  '2026-09-10',
  '2026-09-12',
  '2026-09-15',
  '2026-09-18',
]);

const LEGACY_DEMO_PROFILE_IDS = new Set(['prof-1', 'prof-2', 'prof-3', 'prof-4']);
const LEGACY_FAKE_SAVE_IDS = new Set([
  'account-bear-42',
  'account-usec-28',
  'account-hardcore-12',
]);

function isLegacyFixtureDemoMod(m: InstalledMod): boolean {
  if (!m) return false;
  if (m.id === 'me.sol.sain.legacy-patch') return true;
  if (LEGACY_DEMO_MOD_IDS.has(m.id) && LEGACY_DEMO_INSTALL_DATES.has(m.installDate)) {
    return true;
  }
  return false;
}

function isLegacyDemoProfile(p: ModProfile): boolean {
  if (!p) return false;
  if (LEGACY_DEMO_PROFILE_IDS.has(p.id)) return true;
  if (p.linkedSptProfileId && LEGACY_FAKE_SAVE_IDS.has(p.linkedSptProfileId)) return true;
  return false;
}

export function migrateAndNormalizeInstalledMods(rawMods: InstalledMod[]): {
  mods: InstalledMod[];
  didMutate: boolean;
} {
  if (!Array.isArray(rawMods)) return { mods: [], didMutate: false };

  let didMutate = false;
  const filtered = rawMods.filter((m) => {
    if (isLegacyFixtureDemoMod(m)) {
      didMutate = true;
      return false;
    }
    return true;
  });

  const mods = filtered.map((m, idx) => {
    const known = getKnownDependencyMeta(m.id) || getKnownDependencyMeta(m.name) || getKnownDependencyMeta(m.modId);
    const cleanToken = (m.name || '').replace(/\s+/g, '');
    const catLower = (m.categoryTitle || known?.categoryTitle || '').toLowerCase();

    const normServerPath = m.serverPath ? m.serverPath.replace(/\\/g, '/') : undefined;
    const normClientPath = m.clientPath ? m.clientPath.replace(/\\/g, '/') : undefined;
    if (normServerPath !== m.serverPath || normClientPath !== m.clientPath) {
      didMutate = true;
    }

    // Detect legacy synthetic dual paths created by older browser-preview simulation:
    // specifically `<serverDir>/<cleanToken>` AND `<clientDir>/<cleanToken>.dll`
    const isSyntheticDual =
      m.kind === 'Both' &&
      Boolean(cleanToken) &&
      Boolean(normServerPath?.endsWith(`/${cleanToken}`)) &&
      Boolean(normClientPath?.endsWith(`/${cleanToken}.dll`));

    let serverPath = normServerPath;
    let clientPath = normClientPath;
    let kind = m.kind || known?.kind || 'Client';

    if (isSyntheticDual) {
      if (known?.kind === 'Client') {
        kind = 'Client';
        serverPath = undefined;
        didMutate = true;
      } else if (known?.kind === 'Server') {
        kind = 'Server';
        clientPath = undefined;
        didMutate = true;
      } else if (!known) {
        // Unknown mod with synthetic `<cleanToken>` + `<cleanToken>.dll` paths from older web fallback
        if (catLower.includes('server') || catLower.includes('trader') || catLower.includes('overhaul')) {
          kind = 'Server';
          clientPath = undefined;
          didMutate = true;
        } else if (
          catLower === 'ui' ||
          catLower.includes('client') ||
          catLower.includes('graphics') ||
          catLower.includes('audio') ||
          catLower.includes('tools') ||
          catLower.includes('addons')
        ) {
          kind = 'Client';
          serverPath = undefined;
          didMutate = true;
        }
      }
      // Note: if known?.kind === 'Both', or if paths are genuine non-synthetic disk paths, preserve Both + paths!
    }

    return {
      ...m,
      serverPath,
      clientPath,
      thumbnail: m.thumbnail || known?.thumbnail || (m.modId ? `https://files.sp-mod.com/mods/${m.modId}.png` : undefined),
      author:
        m.author && m.author !== 'Forge Dependency' && m.author !== 'Community Author'
          ? m.author
          : known?.author || m.author || 'Community Author',
      categoryTitle: m.categoryTitle || known?.categoryTitle || (kind === 'Server' ? 'Overhauls' : 'Tools'),
      teaser: m.teaser || known?.teaser,
      kind,
      loadOrder: typeof m.loadOrder === 'number' ? m.loadOrder : idx + 1,
      dependencies: m.dependencies ?? DEFAULT_KNOWN_DEPS[m.id] ?? [],
      tags: m.tags ?? [],
    };
  });

  return { mods, didMutate };
}

export const storageService = {
  loadSettings(): SettingsState {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.activeProfileId && LEGACY_DEMO_PROFILE_IDS.has(parsed.activeProfileId)) {
          parsed.activeProfileId = 'prof-default';
        }
        return { ...DEFAULT_SETTINGS, ...parsed };
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
        const parsed: InstalledMod[] = JSON.parse(saved);
        if (!Array.isArray(parsed)) return [];

        const { mods, didMutate } = migrateAndNormalizeInstalledMods(parsed);
        if (didMutate) {
          localStorage.setItem(INSTALLED_MODS_KEY, JSON.stringify(mods));
        }
        return mods;
      }
    } catch {
      // ignore
    }
    return [];
  },

  saveInstalledMods(mods: InstalledMod[]): void {
    pendingModsPayload = null;
    if (modsWriteTimer) {
      clearTimeout(modsWriteTimer);
      modsWriteTimer = null;
    }
    try {
      localStorage.setItem(INSTALLED_MODS_KEY, JSON.stringify(mods));
    } catch {
      // ignore
    }
  },

  saveInstalledModsDebounced(mods: InstalledMod[], delayMs = 180): void {
    pendingModsPayload = mods;
    if (modsWriteTimer) clearTimeout(modsWriteTimer);
    modsWriteTimer = setTimeout(() => {
      modsWriteTimer = null;
      if (pendingModsPayload) {
        try {
          localStorage.setItem(INSTALLED_MODS_KEY, JSON.stringify(pendingModsPayload));
        } catch {
          // ignore
        }
        pendingModsPayload = null;
      }
    }, delayMs);
  },

  loadProfiles(): ModProfile[] {
    try {
      const saved = localStorage.getItem(PROFILES_KEY);
      if (saved) {
        const parsed: ModProfile[] = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const cleaned = parsed.filter((p) => !isLegacyDemoProfile(p));
          if (cleaned.length > 0) {
            if (cleaned.length !== parsed.length) {
              localStorage.setItem(PROFILES_KEY, JSON.stringify(cleaned));
            }
            return cleaned;
          }
          localStorage.setItem(PROFILES_KEY, JSON.stringify(INITIAL_PROFILES));
          return INITIAL_PROFILES;
        }
      }
    } catch {
      // ignore
    }
    return INITIAL_PROFILES;
  },

  saveProfiles(profiles: ModProfile[]): void {
    pendingProfilesPayload = null;
    if (profilesWriteTimer) {
      clearTimeout(profilesWriteTimer);
      profilesWriteTimer = null;
    }
    try {
      localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
    } catch {
      // ignore
    }
  },

  saveProfilesDebounced(profiles: ModProfile[], delayMs = 180): void {
    pendingProfilesPayload = profiles;
    if (profilesWriteTimer) clearTimeout(profilesWriteTimer);
    profilesWriteTimer = setTimeout(() => {
      profilesWriteTimer = null;
      if (pendingProfilesPayload) {
        try {
          localStorage.setItem(PROFILES_KEY, JSON.stringify(pendingProfilesPayload));
        } catch {
          // ignore
        }
        pendingProfilesPayload = null;
      }
    }, delayMs);
  },

  flushPendingWrites(): void {
    if (modsWriteTimer) {
      clearTimeout(modsWriteTimer);
      modsWriteTimer = null;
    }
    if (pendingModsPayload) {
      try {
        localStorage.setItem(INSTALLED_MODS_KEY, JSON.stringify(pendingModsPayload));
      } catch {
        // ignore
      }
      pendingModsPayload = null;
    }
    if (profilesWriteTimer) {
      clearTimeout(profilesWriteTimer);
      profilesWriteTimer = null;
    }
    if (pendingProfilesPayload) {
      try {
        localStorage.setItem(PROFILES_KEY, JSON.stringify(pendingProfilesPayload));
      } catch {
        // ignore
      }
      pendingProfilesPayload = null;
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
};

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    storageService.flushPendingWrites();
  });
}


