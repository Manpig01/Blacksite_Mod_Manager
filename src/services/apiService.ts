import { Mod, ModCategory, SptVersionInfo, ModVersion, CatalogSortOption, RecommendedModItem, InstalledMod, ForgeDependencyNode, ResolvedDependencyItem, Addon, AddonVersion, AddonQueryResult } from '../types';
import { FIXTURE_MODS, MOD_CATEGORIES, SPT_VERSIONS } from '../data/fixtureCatalog';
import { getKnownDependencyMeta } from '../data/knownDependencies';
import { sortSptVersionsByMostRecent, sortModVersionsByMostRecent, isSptVersionCompatible } from '../utils/versionUtils';

const API_BASE = 'https://sp-mod.com/api/v0';

export interface CatalogQueryFilters {
  query?: string;
  author?: string;
  categoryId?: number | null;
  sptVersion?: string;
  sort?: CatalogSortOption;
  page?: number;
  perPage?: number;
  hideFeatured?: boolean;
  hideContainsAds?: boolean;
  hideContainsAi?: boolean;
  hideInstalled?: boolean;
  fikaOnly?: boolean;
  installedGuids?: string[];
}

export interface CatalogQueryResult {
  mods: Mod[];
  total: number;
  currentPage: number;
  lastPage: number;
  isOfflineFallback: boolean;
}

export function normalizeForgeImageUrl(url?: string | null): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('/')) return `https://sp-mod.com${trimmed}`;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://files.sp-mod.com/${trimmed.replace(/^\/+/, '')}`;
}

export function normalizeAddon(item: any): Addon {
  if (!item) return item;
  const owner = item.owner;
  const authors: { id: number; name: string; avatar?: string; roles?: string[] }[] = [];
  if (owner) {
    authors.push({
      id: owner.id,
      name: owner.name,
      avatar: normalizeForgeImageUrl(owner.profile_photo_url) || undefined
    });
  }
  if (Array.isArray(item.additional_authors)) {
    for (const a of item.additional_authors) {
      if (a && a.id) {
        authors.push({
          id: a.id,
          name: a.name,
          avatar: normalizeForgeImageUrl(a.profile_photo_url) || undefined
        });
      }
    }
  }

  const versions: AddonVersion[] = Array.isArray(item.versions)
    ? item.versions.map((v: any) => ({
        id: v.id,
        addon_id: item.id,
        version: v.version || '1.0.0',
        slug: v.slug || (v.version ? v.version.replace(/\./g, '-') : '1-0-0'),
        link: v.link || `https://sp-mod.com/addon/download/${item.id}/${item.slug || 'addon'}/${v.version || '1.0.0'}`,
        changelog: v.description || v.changelog || '',
        content_length: v.content_length,
        downloads: v.downloads ?? 0,
        published_at: v.published_at || v.created_at,
        mod_version_constraint: v.mod_version_constraint || null
      }))
    : [];

  return {
    id: item.id,
    name: (item.name || '').trim(),
    slug: item.slug || '',
    teaser: item.teaser || '',
    description: item.description || '',
    mod_id: item.mod_id,
    category_id: item.category_id,
    downloads: item.downloads ?? 0,
    rating: item.rating,
    status: item.status,
    created_at: item.created_at,
    updated_at: item.updated_at,
    thumbnail: normalizeForgeImageUrl(item.thumbnail) || undefined,
    authors: authors.length > 0 ? authors : (item.authors || [{ id: 0, name: 'Community' }]),
    versions,
    mod: item.mod
      ? {
          id: item.mod.id,
          name: item.mod.name,
          slug: item.mod.slug,
          thumbnail: normalizeForgeImageUrl(item.mod.thumbnail) || undefined,
          authors: item.mod.owner
            ? [{ id: item.mod.owner.id, name: item.mod.owner.name }]
            : item.mod.authors
        }
      : undefined
  };
}

let cachedAllAddons: { data: Addon[]; timestamp: number } | null = null;
const ADDONS_CACHE_TTL = 60 * 1000; // 60 seconds

export function normalizeMod(m: any): Mod {
  if (!m) return m;
  const normThumbnail =
    normalizeForgeImageUrl(m.thumbnail) ||
    (m.hub_id ? `https://files.sp-mod.com/mods/${m.hub_id}.png` : '') ||
    '';
  const normOwner = m.owner
    ? {
        ...m.owner,
        profile_photo_url: normalizeForgeImageUrl(m.owner.profile_photo_url),
      }
    : m.owner;

  return {
    ...m,
    thumbnail: normThumbnail,
    owner: normOwner,
  };
}

interface IndexedCatalogEntry {
  mod: Mod;
  tokens: string;
  authorLower: string;
  categoryTitleLower: string;
  fikaCompatible: boolean;
  sptVersionStrings: string[];
}

const CATALOG_STORAGE_KEY = 'blacksite_catalog_mods_v2';
const LAST_SYNC_KEY = 'blacksite_catalog_last_sync_v2';

const catalogMap = new Map<number, Mod>();
let indexedCatalog: IndexedCatalogEntry[] = [];
let isCatalogInitialized = false;
let syncInFlight: Promise<number> | null = null;

function buildIndexEntry(mod: Mod): IndexedCatalogEntry {
  const authorName = mod.owner?.name || '';
  const catTitle = mod.category?.title || '';
  const versions = Array.isArray(mod.versions) ? mod.versions : [];
  const sptVerStrings: string[] = [];

  const rawConstraint = (mod as any).spt_version_constraint;
  if (rawConstraint) {
    sptVerStrings.push(String(rawConstraint).toLowerCase());
  }
  for (const v of versions) {
    if (v.spt_version_constraint) {
      sptVerStrings.push(v.spt_version_constraint.toLowerCase());
    }
  }

  const tokens = `${mod.name} ${mod.slug || ''} ${mod.guid || ''} ${mod.teaser || ''} ${authorName} ${catTitle}`.toLowerCase();

  const isFika =
    mod.fika_compatibility === true ||
    versions.some(
      (v) =>
        v.fika_compatibility === 'compatible' ||
        (v as any).fika_compatibility === true
    );

  return {
    mod,
    tokens,
    authorLower: authorName.toLowerCase(),
    categoryTitleLower: catTitle.toLowerCase(),
    fikaCompatible: isFika,
    sptVersionStrings: sptVerStrings,
  };
}

function rebuildCatalogIndex(): void {
  const entries: IndexedCatalogEntry[] = [];
  for (const mod of catalogMap.values()) {
    entries.push(buildIndexEntry(mod));
  }
  indexedCatalog = entries;
}

function initializeCatalog(): void {
  if (isCatalogInitialized) return;
  isCatalogInitialized = true;

  // 1. Populate catalog with FIXTURE_MODS first so catalog is instantly available on frame 0
  for (const f of FIXTURE_MODS) {
    catalogMap.set(f.id, normalizeMod(f));
  }

  // 2. Hydrate any persisted catalog entries from localStorage
  if (typeof localStorage !== 'undefined') {
    try {
      const saved = localStorage.getItem(CATALOG_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.id) {
              catalogMap.set(item.id, normalizeMod(item));
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Catalog Engine] Failed parsing persisted catalog:', e);
    }
  }

  rebuildCatalogIndex();
}

function matchesSptVersion(entry: IndexedCatalogEntry, targetVersion: string): boolean {
  if (!targetVersion || targetVersion === 'All') return true;

  // Direct constraint compatibility
  const rawConstraint = (entry.mod as any).spt_version_constraint;
  if (rawConstraint && isSptVersionCompatible(rawConstraint, targetVersion)) {
    return true;
  }
  if (entry.sptVersionStrings.some((c) => isSptVersionCompatible(c, targetVersion))) {
    return true;
  }

  // Target version tier matching (e.g. 4.1 or 4.0 or 3.8) in tokens or teaser
  const cleanTarget = targetVersion.replace(/^[vV\s]+/, '').trim();
  const majorMinor = cleanTarget.split('.').slice(0, 2).join('.');
  if (majorMinor && (entry.tokens.includes(`spt ${majorMinor}`) || entry.tokens.includes(`spt-${majorMinor}`))) {
    return true;
  }

  return false;
}

async function syncCatalogDifferential(force = false): Promise<number> {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    try {
      initializeCatalog();
      if (typeof window === 'undefined') return 0;

      const lastSyncStr = localStorage.getItem(LAST_SYNC_KEY);
      const lastSyncTimestamp = lastSyncStr ? parseInt(lastSyncStr, 10) : 0;
      const now = Date.now();

      // Skip if synced within last 3 minutes unless explicitly forced
      if (!force && lastSyncTimestamp > 0 && now - lastSyncTimestamp < 3 * 60 * 1000) {
        return 0;
      }

      let updatedCount = 0;
      let latestTimestampEncountered = lastSyncTimestamp;
      let stopPaging = false;

      // Differential sync: sort=-updated_at to pull latest updates first
      for (let page = 1; page <= 4; page++) {
        if (stopPaging) break;

        const res = await fetch(`${API_BASE}/mods?sort=-updated_at&page=${page}&per_page=50`, {
          signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) break;
        const json = await res.json();
        const items = Array.isArray(json.data) ? json.data : [];
        if (items.length === 0) break;

        for (const raw of items) {
          const mod = normalizeMod(raw);
          const updateTime = new Date(mod.updated_at || mod.created_at || mod.published_at || 0).getTime();

          if (updateTime > latestTimestampEncountered) {
            latestTimestampEncountered = updateTime;
          }

          // Differential cutoff: stop pagination early when encountering records older than last_sync_timestamp
          if (lastSyncTimestamp > 0 && updateTime > 0 && updateTime <= lastSyncTimestamp) {
            stopPaging = true;
            break;
          }

          catalogMap.set(mod.id, mod);
          updatedCount++;
        }

        const lastPage = json.meta?.last_page || 1;
        if (page >= lastPage) break;
      }

      if (updatedCount > 0 || lastSyncTimestamp === 0) {
        localStorage.setItem(LAST_SYNC_KEY, String(latestTimestampEncountered || now));
        rebuildCatalogIndex();

        // Persist top items to localStorage for immediate hydration
        try {
          const allMods = Array.from(catalogMap.values());
          const trimmed = allMods
            .sort((a, b) => (b.downloads || 0) - (a.downloads || 0))
            .slice(0, 300);
          localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(trimmed));
        } catch {
          // Ignore quota errors
        }
      }

      return updatedCount;
    } catch (err) {
      console.warn('[Catalog Sync] Differential sync skipped:', err);
      return 0;
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}

export const apiService = {
  async getCategories(): Promise<ModCategory[]> {
    try {
      const res = await fetch(`${API_BASE}/mod-categories?per_page=50`, {
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) {
        const json = await res.json();
        if (json.data && Array.isArray(json.data) && json.data.length > 0) {
          return json.data;
        }
      }
    } catch {
      // Fallback to fixture
    }
    return MOD_CATEGORIES;
  },

  async getSptVersions(): Promise<SptVersionInfo[]> {
    try {
      // Query with sort=-created_at to fetch most recent releases first
      const res = await fetch(`${API_BASE}/spt/versions?sort=-created_at&per_page=50`, {
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) {
        const json = await res.json();
        let allItems = Array.isArray(json.data) ? [...json.data] : [];

        // If multiple pages exist, retrieve remaining pages to include all releases without missing any
        const lastPage = json.meta?.last_page || 1;
        if (lastPage > 1) {
          try {
            const pagePromises = [];
            for (let p = 2; p <= Math.min(lastPage, 3); p++) {
              pagePromises.push(
                fetch(`${API_BASE}/spt/versions?sort=-created_at&page=${p}&per_page=50`, {
                  signal: AbortSignal.timeout(3000)
                }).then((r) => (r.ok ? r.json() : null))
              );
            }
            const pageResults = await Promise.all(pagePromises);
            for (const pageData of pageResults) {
              if (pageData?.data && Array.isArray(pageData.data)) {
                allItems.push(...pageData.data);
              }
            }
          } catch {
            // Keep whatever items were already retrieved
          }
        }

        if (allItems.length > 0) {
          const normalized: SptVersionInfo[] = allItems.map((item: any) => ({
            id: item.id,
            version: item.version,
            versionMajor: item.versionMajor ?? item.version_major ?? 0,
            versionMinor: item.versionMinor ?? item.version_minor ?? 0,
            versionPatch: item.versionPatch ?? item.version_patch ?? 0,
            versionLabels: item.versionLabels ?? item.version_labels ?? '',
            modCount: item.modCount ?? item.mod_count ?? item.mods_count ?? item.count ?? 0,
            link: item.link,
            colorClass: item.colorClass ?? item.color_class,
            createdAt: item.createdAt ?? item.created_at,
            updatedAt: item.updatedAt ?? item.updated_at
          }));
          return sortSptVersionsByMostRecent(normalized);
        }
      }
    } catch {
      // Fallback to fixture
    }
    return sortSptVersionsByMostRecent(SPT_VERSIONS);
  },

  async getModVersions(modId: number): Promise<ModVersion[]> {
    try {
      const res = await fetch(`${API_BASE}/mod/${modId}/versions?per_page=50&sort=-published_at`, {
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const json = await res.json();
        if (json.data && Array.isArray(json.data) && json.data.length > 0) {
          return sortModVersionsByMostRecent(json.data);
        }
      }
    } catch {
      // Fallback to fixture
    }
    const fixtureMod = FIXTURE_MODS.find(m => m.id === modId);
    return sortModVersionsByMostRecent(fixtureMod?.versions || [
      {
        id: 9901,
        version: "1.0.0",
        description: "<p>Initial stable release for SPT 4.x.</p>",
        link: `https://files.sp-mod.com/mods/${modId}.zip`,
        content_length: 2450000,
        spt_version_constraint: ">=4.0.0",
        downloads: 54000,
        fika_compatibility: "compatible",
        published_at: "2026-08-01T12:00:00Z"
      }
    ]);
  },

  async resolveModDependencies(
    modIdentifier: string | number,
    version: string,
    sptVersion: string = '4.1.6',
    installedMods: InstalledMod[] = []
  ): Promise<ResolvedDependencyItem[]> {
    try {
      const cleanSptVersion = (sptVersion || '4.1.6').replace(/^[~^>=<\s]+/, '');
      const url = `${API_BASE}/mods/dependencies?mods=${encodeURIComponent(`${modIdentifier}:${version}`)}&spt_version=${encodeURIComponent(cleanSptVersion)}`;

      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) {
        console.warn(`[Dependency Resolver] API responded with ${res.status}`);
        return [];
      }

      const json = await res.json();
      if (!json.success || !json.data) return [];

      const key = `${modIdentifier}:${version}`;
      const rawTree: ForgeDependencyNode[] = json.data[key] || json.data[Object.keys(json.data)[0]] || [];

      const installedMap = new Map<string, InstalledMod>();
      installedMods.forEach((m) => {
        if (m.id) installedMap.set(m.id.toLowerCase(), m);
        if (m.modId) installedMap.set(String(m.modId), m);
        installedMap.set(m.name.toLowerCase(), m);
      });

      const flattened: ResolvedDependencyItem[] = [];
      const seenIds = new Set<string>();

      function traverse(node: ForgeDependencyNode, depth: number) {
        if (!node) return;

        // Traverse nested dependencies first to ensure prerequisites are installed before dependent mods
        if (node.dependencies && Array.isArray(node.dependencies)) {
          for (const child of node.dependencies) {
            traverse(child, depth + 1);
          }
        }

        const nodeId = node.id || (node as any).mod_id;
        const nodeGuid = node.guid || node.slug || String(nodeId);
        const nodeKey = `${nodeId}-${nodeGuid}`.toLowerCase();

        if (seenIds.has(nodeKey)) return;
        seenIds.add(nodeKey);

        const targetVerObj = node.latest_compatible_version;
        const knownMeta =
          getKnownDependencyMeta(nodeGuid) ||
          getKnownDependencyMeta(node.name) ||
          getKnownDependencyMeta(nodeId);
        const fixtureMatch = FIXTURE_MODS.find(
          (m) =>
            m.id === nodeId ||
            (m.guid && m.guid.toLowerCase() === nodeGuid.toLowerCase()) ||
            m.name.toLowerCase() === node.name.toLowerCase()
        );

        const depVer =
          targetVerObj?.version ||
          (node as any).version ||
          knownMeta?.version ||
          fixtureMatch?.versions?.[0]?.version ||
          '1.0.0';

        let downloadUrl: string | undefined = targetVerObj?.link || undefined;
        if (!downloadUrl && (node as any).versions && Array.isArray((node as any).versions) && (node as any).versions.length > 0) {
          downloadUrl = (node as any).versions[0].link || undefined;
        }
        if (!downloadUrl && fixtureMatch && fixtureMatch.versions && fixtureMatch.versions.length > 0) {
          downloadUrl = fixtureMatch.versions[0].link || undefined;
        }
        if (!downloadUrl) {
          downloadUrl = `https://sp-mod.com/mod/download/${nodeId}/${node.slug || 'mod'}/${depVer}`;
        }

        const isInstalled =
          installedMap.has(nodeGuid.toLowerCase()) ||
          installedMap.has(String(nodeId)) ||
          installedMap.has(node.name.toLowerCase());

        const existingInstalled =
          installedMap.get(nodeGuid.toLowerCase()) ||
          installedMap.get(String(nodeId)) ||
          installedMap.get(node.name.toLowerCase());

        const thumbnail =
          (node as any).thumbnail ||
          knownMeta?.thumbnail ||
          fixtureMatch?.thumbnail ||
          '';
        const author =
          (node as any).author ||
          (node as any).owner?.name ||
          knownMeta?.author ||
          fixtureMatch?.owner?.name ||
          'Community Author';
        const kind = (node as any).kind || knownMeta?.kind || (fixtureMatch ? 'Server' : 'Both');
        const categoryTitle =
          (node as any).category?.title ||
          knownMeta?.categoryTitle ||
          fixtureMatch?.category?.title ||
          'Tools';

        flattened.push({
          id: nodeId,
          guid: nodeGuid,
          name: node.name,
          slug: node.slug || nodeGuid,
          version: depVer,
          downloadUrl,
          contentLength: targetVerObj?.content_length || null,
          conflict: !!node.conflict,
          isInstalled,
          installedVersion: existingInstalled?.version,
          selected: !isInstalled,
          depth,
          thumbnail,
          author,
          kind,
          categoryTitle,
        });
      }

      for (const rootNode of rawTree) {
        traverse(rootNode, 1);
      }

      return flattened;
    } catch (err) {
      console.warn('[Dependency Resolver] Failed resolving dependencies:', err);
      return [];
    }
  },

  async syncCatalogDifferential(force = false): Promise<number> {
    return syncCatalogDifferential(force);
  },

  async searchMods(filters: CatalogQueryFilters): Promise<CatalogQueryResult> {
    initializeCatalog();

    // Trigger non-blocking differential sync in background
    syncCatalogDifferential().catch(() => {});

    const page = filters.page || 1;
    const perPage = filters.perPage || 20;

    let list = indexedCatalog;

    // 1. Text & author filter (< 0.5ms)
    if (filters.query?.trim()) {
      const q = filters.query.trim().toLowerCase();
      if (q.startsWith('@')) {
        const authorQuery = q.slice(1).trim();
        list = list.filter((e) => e.authorLower.includes(authorQuery));
      } else {
        const terms = q.split(/\s+/).filter(Boolean);
        list = list.filter((e) => terms.every((t) => e.tokens.includes(t)));
      }
    }

    if (filters.author?.trim()) {
      const aQuery = filters.author.trim().toLowerCase();
      list = list.filter((e) => e.authorLower.includes(aQuery));
    }

    // 2. Category filter (< 0.1ms)
    if (filters.categoryId) {
      list = list.filter((e) => e.mod.category_id === filters.categoryId);
    }

    // 3. SPT Version filter (< 0.3ms)
    if (filters.sptVersion && filters.sptVersion !== 'All') {
      list = list.filter((e) => matchesSptVersion(e, filters.sptVersion!));
    }

    // 4. Fika only (< 0.1ms)
    if (filters.fikaOnly) {
      list = list.filter((e) => e.fikaCompatible);
    }

    // 5. Toggles (< 0.2ms)
    if (filters.hideFeatured) {
      list = list.filter((e) => !e.mod.featured);
    }
    if (filters.hideContainsAds) {
      list = list.filter((e) => !e.mod.contains_ads);
    }
    if (filters.hideContainsAi) {
      list = list.filter((e) => !e.mod.contains_ai_content);
    }
    if (filters.hideInstalled && filters.installedGuids?.length) {
      const installed = new Set(filters.installedGuids.map((g) => g.toLowerCase()));
      list = list.filter((e) => !(e.mod.guid && installed.has(e.mod.guid.toLowerCase())));
    }

    // Extract mod objects
    let mods = list.map((e) => e.mod);

    // 6. Fast sorting (< 0.5ms)
    mods.sort((a, b) => {
      switch (filters.sort) {
        case 'downloads':
          return (b.downloads || 0) - (a.downloads || 0);
        case 'recent':
          return (
            new Date(b.published_at || b.created_at || (b as any).updated_at || 0).getTime() -
            new Date(a.published_at || a.created_at || (a as any).updated_at || 0).getTime()
          );
        case 'name_az':
          return a.name.localeCompare(b.name);
        case 'name_za':
          return b.name.localeCompare(a.name);
        case 'endorsements':
          return (b.endorsements_count || 0) - (a.endorsements_count || 0);
        case 'favourites':
          return (b.favourites_count || 0) - (a.favourites_count || 0);
        default:
          return (b.downloads || 0) - (a.downloads || 0);
      }
    });

    const total = mods.length;
    const start = (page - 1) * perPage;
    const paged = mods.slice(start, start + perPage);

    return {
      mods: paged,
      total,
      currentPage: page,
      lastPage: Math.max(1, Math.ceil(total / perPage)),
      isOfflineFallback: false,
    };
  },

  async getRecommendedMods(
    installedMods: InstalledMod[],
    categories: ModCategory[]
  ): Promise<RecommendedModItem[]> {
    try {
      // 1. Analyze categories of currently installed mods
      const categoryCounts: Record<string, number> = {};
      const installedGuids = new Set<string>();
      const installedNames = new Set<string>();
      const installedModIds = new Set<number>();

      for (const inst of installedMods) {
        if (inst.id) installedGuids.add(inst.id.toLowerCase());
        if (inst.name) installedNames.add(inst.name.toLowerCase());
        if (inst.modId) installedModIds.add(inst.modId);

        let cat = inst.categoryTitle;
        if (!cat) {
          const lowerName = inst.name.toLowerCase();
          if (lowerName.includes('bot') || lowerName.includes('sain') || lowerName.includes('brain')) cat = 'Bots';
          else if (lowerName.includes('server') || lowerName.includes('svm') || lowerName.includes('overhaul')) cat = 'Overhauls';
          else if (lowerName.includes('graphics') || lowerName.includes('light') || lowerName.includes('retexture')) cat = 'Retextures';
          else if (lowerName.includes('trader') || lowerName.includes('flea')) cat = 'Traders';
          else if (lowerName.includes('weapon') || lowerName.includes('gun') || lowerName.includes('scope')) cat = 'Weapons';
          else cat = 'Other';
        }
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      }

      // Sort categories by frequency descending
      const sortedCategories = Object.entries(categoryCounts)
        .sort((a, b) => b[1] - a[1]);

      // If user has no installed mods or categories, default to top SPT categories
      const targetCategoryNames = sortedCategories.length > 0
        ? sortedCategories.slice(0, 3).map(([name]) => name)
        : ['Bots', 'Overhauls', 'Retextures'];

      const recommendations: RecommendedModItem[] = [];
      const seenModIds = new Set<number>();

      // Fetch candidates for each target category from API
      for (const catName of targetCategoryNames) {
        const catObj = categories.find(
          c => c.title.toLowerCase() === catName.toLowerCase() ||
               c.slug.toLowerCase() === catName.toLowerCase()
        );
        const catId = catObj ? catObj.id : (
          catName === 'Bots' ? 5 :
          catName === 'Overhauls' ? 2 :
          catName === 'Retextures' ? 10 :
          catName === 'Traders' ? 16 :
          catName === 'Weapons' ? 13 :
          catName === 'Audio' ? 12 : undefined
        );

        if (!catId) continue;

        const count = categoryCounts[catName] || 0;

        // Query API for popular mods in this category
        const result = await apiService.searchMods({
          categoryId: catId,
          sort: 'downloads',
          perPage: 12
        });

        for (const mod of result.mods) {
          if (seenModIds.has(mod.id)) continue;
          if (installedModIds.has(mod.id)) continue;
          if (mod.guid && installedGuids.has(mod.guid.toLowerCase())) continue;
          if (installedNames.has(mod.name.toLowerCase())) continue;

          seenModIds.add(mod.id);

          let reason = '';
          if (count > 1) {
            reason = `Matches your ${count} installed ${catName} mods`;
          } else if (count === 1) {
            reason = `Popular companion for your ${catName} loadout`;
          } else {
            reason = `Top-rated community mod in ${catName}`;
          }

          recommendations.push({
            mod,
            reason,
            categoryTitle: catName,
            installedCategoryCount: count
          });

          if (recommendations.length >= 10) break;
        }

        if (recommendations.length >= 10) break;
      }

      // If still empty (e.g. offline/network issue), provide curated fallback recommendations from FIXTURE_MODS
      if (recommendations.length === 0) {
        for (const catName of targetCategoryNames) {
          const matchingFixtures = FIXTURE_MODS.filter(m =>
            (m.category?.title?.toLowerCase() === catName.toLowerCase() ||
             m.category?.slug?.toLowerCase() === catName.toLowerCase()) &&
            !installedGuids.has((m.guid || '').toLowerCase()) &&
            !installedNames.has(m.name.toLowerCase()) &&
            !seenModIds.has(m.id)
          );

          for (const mod of matchingFixtures) {
            seenModIds.add(mod.id);
            const count = categoryCounts[catName] || 0;
            recommendations.push({
              mod,
              reason: count > 0
                ? `Matches your ${catName} mods`
                : `Recommended starter in ${catName}`,
              categoryTitle: catName,
              installedCategoryCount: count
            });
            if (recommendations.length >= 8) break;
          }
          if (recommendations.length >= 8) break;
        }
      }

      return recommendations;
    } catch {
      return [];
    }
  },

  /**
   * Fetch paginated addons from /api/v0/addons with relations
   */
  async getAddons(params?: {
    page?: number;
    perPage?: number;
    search?: string;
    modId?: number;
    sort?: string;
    forceRefresh?: boolean;
  }): Promise<AddonQueryResult> {
    const page = params?.page || 1;
    const perPage = params?.perPage || 24;
    const search = params?.search?.trim() || '';
    const sort = params?.sort || 'downloads_desc';
    const modId = params?.modId;
    const forceRefresh = !!params?.forceRefresh;

    try {
      const now = Date.now();
      let allAddons: Addon[] = [];

      if (!forceRefresh && cachedAllAddons && (now - cachedAllAddons.timestamp) < ADDONS_CACHE_TTL) {
        allAddons = cachedAllAddons.data;
      } else {
        // Fetch first page to inspect total and last_page from live SPT API
        const firstRes = await fetch(`${API_BASE}/addons?per_page=50&page=1&include=mod,versions`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(6000)
        });

        if (!firstRes.ok) {
          throw new Error(`Failed to fetch addons: HTTP ${firstRes.status}`);
        }

        const firstJson = await firstRes.json();
        const firstPageData = Array.isArray(firstJson.data) ? firstJson.data : [];
        const lastPage = firstJson.meta?.last_page || 1;

        const rawItems = [...firstPageData];

        if (lastPage > 1) {
          const subsequentRequests = [];
          for (let p = 2; p <= lastPage; p++) {
            subsequentRequests.push(
              fetch(`${API_BASE}/addons?per_page=50&page=${p}&include=mod,versions`, {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(6000)
              })
                .then(r => (r.ok ? r.json() : null))
                .catch(() => null)
            );
          }
          const subsequentPages = await Promise.all(subsequentRequests);
          for (const sp of subsequentPages) {
            if (sp && Array.isArray(sp.data)) {
              rawItems.push(...sp.data);
            }
          }
        }

        allAddons = rawItems.map(normalizeAddon);
        cachedAllAddons = { data: allAddons, timestamp: now };
      }

      // Filter by search query
      let filtered = allAddons;
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(
          (a) =>
            a.name.toLowerCase().includes(q) ||
            (a.teaser && a.teaser.toLowerCase().includes(q)) ||
            (a.slug && a.slug.toLowerCase().includes(q)) ||
            (a.mod?.name && a.mod.name.toLowerCase().includes(q)) ||
            (a.mod?.slug && a.mod.slug.toLowerCase().includes(q)) ||
            (a.authors && a.authors.some((au) => au.name.toLowerCase().includes(q)))
        );
      }

      // Filter by parent mod ID if specified
      if (modId) {
        filtered = filtered.filter((a) => a.mod_id === modId);
      }

      // Accurate sorting
      if (sort === 'downloads_desc' || sort === 'downloads') {
        filtered = [...filtered].sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
      } else if (sort === 'created_desc' || sort === 'recent') {
        filtered = [...filtered].sort((a, b) => {
          const da = a.created_at ? new Date(a.created_at).getTime() : 0;
          const db = b.created_at ? new Date(b.created_at).getTime() : 0;
          return db - da;
        });
      } else if (sort === 'name_asc' || sort === 'name') {
        filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
      }

      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / perPage));
      const validPage = Math.min(Math.max(1, page), totalPages);
      const startIndex = (validPage - 1) * perPage;
      const pageData = filtered.slice(startIndex, startIndex + perPage);

      return {
        data: pageData,
        total,
        page: validPage,
        per_page: perPage,
        total_pages: totalPages,
        isOfflineFallback: false
      };
    } catch (err) {
      console.warn('API error fetching addons, using fallback fixtures:', err);
      // Fallback offline curated sample addons
      const fallbackAddons: Addon[] = [
        {
          id: 101,
          name: 'SAIN Preset - Realism Combat Rebalance',
          slug: 'sain-preset-realism-combat',
          teaser: 'Custom combat tuning, tactical cover behaviors, and aggressive flanking for SAIN 3.0+.',
          mod_id: 1090, // SAIN Solarint's AI Modifications
          downloads: 48200,
          created_at: '2026-08-15T12:00:00Z',
          thumbnail: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=300&q=80',
          authors: [{ id: 12, name: 'CombatEnthusiast' }],
          versions: [
            {
              id: 501,
              addon_id: 101,
              version: '1.4.0',
              slug: '1-4-0',
              link: 'https://sp-mod.com/addon/download/101/sain-preset-realism-combat/1.4.0',
              downloads: 48200,
              content_length: 524000,
              mod_version_constraint: '>=3.0.0'
            }
          ],
          mod: {
            id: 1090,
            name: 'SAIN 3.0 - Solarint AI Modification',
            slug: 'sain-solarint-ai',
            thumbnail: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=300&q=80',
            authors: [{ id: 9, name: 'Solarint' }]
          }
        },
        {
          id: 102,
          name: 'SWAG+DONCs Custom Spawns: Live Flea War',
          slug: 'swag-doncs-custom-spawns-flea-war',
          teaser: 'Increases dynamic combat hotzones around Customs Dorms, Interchange Tech stores, and Streets LexOs.',
          mod_id: 1092, // SWAG + DONUT
          downloads: 36150,
          created_at: '2026-09-02T10:00:00Z',
          thumbnail: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=300&q=80',
          authors: [{ id: 44, name: 'ZoneTuning' }],
          versions: [
            {
              id: 502,
              addon_id: 102,
              version: '2.1.0',
              slug: '2-1-0',
              link: 'https://sp-mod.com/addon/download/102/swag-doncs-custom-spawns-flea-war/2.1.0',
              downloads: 36150,
              content_length: 830000,
              mod_version_constraint: '>=3.3.0'
            }
          ],
          mod: {
            id: 1092,
            name: 'SWAG + Donuts - Dynamic Spawn Wave System',
            slug: 'swag-donuts-dynamic-spawns',
            thumbnail: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=300&q=80',
            authors: [{ id: 15, name: 'props' }]
          }
        },
        {
          id: 103,
          name: 'Amands Graphics - Moody Cinematics Preset',
          slug: 'amands-graphics-moody-cinematics',
          teaser: 'Darker nights, deep volumetric shadows, and realistic color grade without blowing out highlights.',
          mod_id: 1091, // Amands Graphics
          downloads: 72900,
          created_at: '2026-07-20T14:00:00Z',
          thumbnail: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=300&q=80',
          authors: [{ id: 88, name: 'VisualArts' }],
          versions: [
            {
              id: 503,
              addon_id: 103,
              version: '1.2.2',
              slug: '1-2-2',
              link: 'https://sp-mod.com/addon/download/103/amands-graphics-moody-cinematics/1.2.2',
              downloads: 72900,
              content_length: 312000,
              mod_version_constraint: '>=1.6.0'
            }
          ],
          mod: {
            id: 1091,
            name: "Amands's Graphics",
            slug: 'amands-graphics',
            thumbnail: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=300&q=80',
            authors: [{ id: 4, name: 'Amands95' }]
          }
        },
        {
          id: 104,
          name: 'Questing Bots - Extended Streets & Ground Zero Paths',
          slug: 'questing-bots-extended-paths',
          teaser: 'Over 140 new patrol and quest navigation nodes allowing PMC bots to explore locked rooms and rooftop lookouts.',
          mod_id: 1093, // Questing Bots
          downloads: 29400,
          created_at: '2026-09-18T09:30:00Z',
          thumbnail: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=300&q=80',
          authors: [{ id: 62, name: 'DanWPathing' }],
          versions: [
            {
              id: 504,
              addon_id: 104,
              version: '0.9.1',
              slug: '0-9-1',
              link: 'https://sp-mod.com/addon/download/104/questing-bots-extended-paths/0.9.1',
              downloads: 29400,
              content_length: 1240000,
              mod_version_constraint: '>=0.7.0'
            }
          ],
          mod: {
            id: 1093,
            name: 'Questing Bots',
            slug: 'questing-bots',
            thumbnail: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=300&q=80',
            authors: [{ id: 3, name: 'DanW' }]
          }
        }
      ];

      // Filter by search or modId if present
      let filtered = fallbackAddons;
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(
          (a) =>
            a.name.toLowerCase().includes(q) ||
            (a.teaser && a.teaser.toLowerCase().includes(q)) ||
            (a.mod?.name && a.mod.name.toLowerCase().includes(q))
        );
      }
      if (modId) {
        filtered = filtered.filter((a) => a.mod_id === modId);
      }

      return {
        data: filtered,
        total: filtered.length,
        page: 1,
        per_page: perPage,
        total_pages: 1,
        isOfflineFallback: true
      };
    }
  },

  /**
   * Fetch single mod details by ID
   */
  async getMod(modId: number): Promise<Mod | null> {
    initializeCatalog();
    const local = catalogMap.get(modId);
    if (local && (local.teaser || (local as any).description) && local.versions && local.versions.length > 0) {
      return local;
    }

    try {
      const res = await fetch(`${API_BASE}/mod/${modId}?include=versions,owner,category`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4500)
      });
      if (res.ok) {
        const json = await res.json();
        const data = json.data || json;
        if (data && data.id) {
          const normalized = normalizeMod(data);
          catalogMap.set(normalized.id, normalized);
          return normalized;
        }
      }
    } catch {
      // Fallback to fixture
    }
    const fixture = FIXTURE_MODS.find((m) => m.id === modId);
    return local || fixture || null;
  },

  /**
   * Fetch single addon details with relations
   */
  async getAddon(addonId: number): Promise<Addon | null> {
    try {
      const res = await fetch(`${API_BASE}/addon/${addonId}?include=versions,mod`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4500)
      });
      if (res.ok) {
        const json = await res.json();
        const data = json.data || json;
        if (data && data.id) {
          return normalizeAddon(data);
        }
      }
    } catch {}

    if (cachedAllAddons) {
      const found = cachedAllAddons.data.find((a) => a.id === addonId);
      if (found) return found;
    }
    return null;
  },

  /**
   * Fetch versions list for an addon
   */
  async getAddonVersions(addonId: number): Promise<AddonVersion[]> {
    try {
      const res = await fetch(`${API_BASE}/addon/${addonId}/versions`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4500)
      });
      if (res.ok) {
        const json = await res.json();
        const data = Array.isArray(json.data) ? json.data : [];
        return data.map((v: any) => ({
          id: v.id,
          addon_id: addonId,
          version: v.version || '1.0.0',
          slug: v.slug || (v.version ? v.version.replace(/\./g, '-') : '1-0-0'),
          link: v.link,
          changelog: v.description || v.changelog || '',
          content_length: v.content_length,
          downloads: v.downloads ?? 0,
          published_at: v.published_at || v.created_at,
          mod_version_constraint: v.mod_version_constraint || null
        }));
      }
    } catch {}
    return [];
  }
};


