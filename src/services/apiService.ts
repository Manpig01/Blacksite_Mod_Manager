import {
  Mod,
  ModCategory,
  SptVersionInfo,
  ModVersion,
  CatalogSortOption,
  RecommendedModItem,
  InstalledMod,
  ForgeDependencyNode,
  ResolvedDependencyItem,
  Addon,
  AddonVersion,
  AddonQueryResult,
  CheckModUpdatesResult,
} from '../types';
import { FIXTURE_MODS, MOD_CATEGORIES, SPT_VERSIONS } from '../data/fixtureCatalog';
import { getKnownDependencyMeta } from '../data/knownDependencies';
import {
  sortSptVersionsByMostRecent,
  sortModVersionsByMostRecent,
  isSptVersionCompatible,
  findMatchingModVersion,
} from '../utils/versionUtils';

const API_BASE = 'https://sp-mod.com/api/v0';

/**
 * Concurrency limiter, in-flight request deduplicator, and 5-minute TTL response cache
 * for SP-Mod Forge API. Enforces max 5 concurrent requests and Cloudflare 429 backoff.
 */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T = any> {
  data: T;
  expiresAt: number;
}

function combineSignals(userSignal?: AbortSignal, timeoutMs = 5000): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!userSignal) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([userSignal, timeoutSignal]);
  }
  return userSignal;
}

export function isAbortError(err: unknown): boolean {
  return (
    err instanceof DOMException && err.name === 'AbortError' ||
    (typeof err === 'object' && err !== null && (err as any).name === 'AbortError')
  );
}

function parseRetryAfterMs(retryAfterHeader: string | null, defaultMs = 2500, maxDelayMs = 30000): number {
  if (!retryAfterHeader) return defaultMs;
  const trimmed = retryAfterHeader.trim();
  if (!trimmed) return defaultMs;

  // 1. Try integer seconds
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(maxDelayMs, Math.max(500, seconds * 1000));
    }
  }

  // 2. Try HTTP-date format (e.g. "Wed, 21 Oct 2026 07:28:00 GMT")
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const deltaMs = dateMs - Date.now();
    if (deltaMs <= 0) return 500;
    return Math.min(maxDelayMs, Math.max(500, deltaMs));
  }

  return defaultMs;
}

function sleepWithSignal(delayMs: number, signal?: AbortSignal | null): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Request aborted', 'AbortError'));
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Request aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

interface QueuedWaiter {
  activate: () => void;
  cleanup: () => void;
}

export class RateLimitedClient {
  private activeCount = 0;
  private queue: QueuedWaiter[] = [];
  private maxConcurrent = 5;
  private rateLimitResetUntil = 0;
  private ttlCache = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<any>>();

  getCached<T>(key: string): T | null {
    const entry = this.ttlCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.ttlCache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  setCached<T>(key: string, data: T, ttlMs = DEFAULT_CACHE_TTL_MS): void {
    // Bound cache size to 200 entries
    if (this.ttlCache.size >= 200) {
      const oldestKey = this.ttlCache.keys().next().value;
      if (oldestKey) this.ttlCache.delete(oldestKey);
    }
    this.ttlCache.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    });
  }

  clearCache(prefix?: string): void {
    if (!prefix) {
      this.ttlCache.clear();
      return;
    }
    for (const key of this.ttlCache.keys()) {
      if (key.startsWith(prefix)) {
        this.ttlCache.delete(key);
      }
    }
  }

  async deduplicatedJson<T>(
    cacheKey: string,
    fetcher: () => Promise<T>,
    options?: { ttlMs?: number; forceRefresh?: boolean; signal?: AbortSignal }
  ): Promise<T> {
    if (options?.signal?.aborted) {
      throw new DOMException('Request aborted', 'AbortError');
    }

    if (!options?.forceRefresh) {
      const cached = this.getCached<T>(cacheKey);
      if (cached !== null) {
        return cached;
      }
      const existing = this.inFlight.get(cacheKey);
      if (existing && !options?.signal) {
        return existing as Promise<T>;
      }
    }

    const promise = (async () => {
      try {
        const result = await fetcher();
        this.setCached(cacheKey, result, options?.ttlMs ?? DEFAULT_CACHE_TTL_MS);
        return result;
      } finally {
        this.inFlight.delete(cacheKey);
      }
    })();

    if (!options?.signal) {
      this.inFlight.set(cacheKey, promise);
    }
    return promise;
  }

  async request(url: string, options: RequestInit = {}, retries = 3): Promise<Response> {
    if (options.signal?.aborted) {
      throw new DOMException('Request aborted', 'AbortError');
    }

    await this.acquireSlot(options.signal || undefined);
    let slotReleased = false;
    const releaseOnce = () => {
      if (!slotReleased) {
        slotReleased = true;
        this.releaseSlot();
      }
    };

    try {
      if (options.signal?.aborted) {
        throw new DOMException('Request aborted', 'AbortError');
      }

      const now = Date.now();
      if (now < this.rateLimitResetUntil) {
        const waitMs = Math.min(30000, this.rateLimitResetUntil - now);
        await sleepWithSignal(waitMs, options.signal);
      }

      const headers = new Headers(options.headers || {});
      if (!headers.has('Accept')) {
        headers.set('Accept', 'application/json');
      }

      // Check for user-configured Forge API key in localStorage or env
      if (!headers.has('Authorization')) {
        let key: string | null = null;
        if (typeof localStorage !== 'undefined') {
          key = localStorage.getItem('blacksite_forge_api_key');
        }
        if (!key && typeof process !== 'undefined' && process.env?.FORGE_API_KEY) {
          key = process.env.FORGE_API_KEY;
        }
        if (key && key.trim()) {
          headers.set('Authorization', `Bearer ${key.trim()}`);
        }
      }

      const res = await fetch(url, { ...options, headers });

      if (res.status === 429 && retries > 0) {
        const retryAfterHeader = res.headers.get('Retry-After');
        const delayMs = parseRetryAfterMs(retryAfterHeader, 2500, 30000);
        this.rateLimitResetUntil = Date.now() + delayMs;
        console.warn(`[SP-Mod API] Cloudflare Rate Limited (429). Retrying after ${(delayMs / 1000).toFixed(1)}s...`);
        // Release active slot while waiting on retry backoff so queued requests aren't deadlocked
        releaseOnce();
        await sleepWithSignal(delayMs, options.signal);
        return this.request(url, options, retries - 1);
      }

      return res;
    } finally {
      releaseOnce();
    }
  }

  private async acquireSlot(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new DOMException('Request aborted', 'AbortError');
    }
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: QueuedWaiter = {
        activate: () => {
          waiter.cleanup();
          if (signal?.aborted) {
            reject(new DOMException('Request aborted', 'AbortError'));
            // Immediately pass the slot to the next non-aborted waiter if any
            if (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
              const next = this.queue.shift();
              next?.activate();
            }
            return;
          }
          this.activeCount++;
          resolve();
        },
        cleanup: () => {
          if (signal) {
            signal.removeEventListener('abort', onAbort);
          }
        },
      };

      const onAbort = () => {
        waiter.cleanup();
        const idx = this.queue.indexOf(waiter);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
        }
        reject(new DOMException('Request aborted', 'AbortError'));
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.queue.push(waiter);
    });
  }

  private releaseSlot(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    while (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
      const next = this.queue.shift();
      if (next) {
        next.activate();
      }
    }
  }
}

export const apiClient = new RateLimitedClient();

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
  signal?: AbortSignal;
  forceRefresh?: boolean;
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

  let normCategory = m.category;
  if (m.category && typeof m.category === 'object') {
    const catTitle = m.category.title || m.category.name || 'General';
    normCategory = {
      ...m.category,
      id: m.category.id,
      title: catTitle,
      name: catTitle,
      slug: m.category.slug || '',
    };
  }

  let normVersions: ModVersion[] = [];
  if (Array.isArray(m.versions)) {
    normVersions = m.versions.map((v: any) => ({
      id: v.id,
      version: v.version || '1.0.0',
      description: v.description || v.changelog || '',
      link: v.link || `https://sp-mod.com/mod/download/${m.id}/${m.slug || 'mod'}/${v.version || '1.0.0'}`,
      content_length: v.content_length,
      spt_version_constraint: v.spt_version_constraint || null,
      downloads: v.downloads ?? 0,
      fika_compatibility: v.fika_compatibility || 'compatible',
      published_at: v.published_at || v.created_at,
    }));
  }

  return {
    ...m,
    thumbnail: normThumbnail,
    owner: normOwner,
    category: normCategory,
    versions: normVersions.length > 0 ? normVersions : m.versions,
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

        const res = await apiClient.request(`${API_BASE}/mods?sort=-updated_at&page=${page}&per_page=50&include=versions,category`, {
          signal: AbortSignal.timeout(6000),
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

  clearCache(prefix?: string): void {
    apiClient.clearCache(prefix);
  },

  async getModVersions(modId: number, options?: { signal?: AbortSignal; forceRefresh?: boolean }): Promise<ModVersion[]> {
    const cacheKey = `mod-versions:${modId}`;
    if (!options?.forceRefresh) {
      const cached = apiClient.getCached<ModVersion[]>(cacheKey);
      if (cached) return cached;
    }

    try {
      const versions = await apiClient.deduplicatedJson<ModVersion[]>(
        cacheKey,
        async () => {
          const res = await apiClient.request(
            `${API_BASE}/mod/${modId}/versions?per_page=50&sort=-published_at`,
            { signal: combineSignals(options?.signal, 5000) }
          );
          if (res.ok) {
            const json = await res.json();
            if (json.data && Array.isArray(json.data) && json.data.length > 0) {
              return sortModVersionsByMostRecent(json.data);
            }
          }
          throw new Error('Empty versions response');
        },
        { forceRefresh: options?.forceRefresh, signal: options?.signal }
      );
      return versions;
    } catch (err) {
      if (options?.signal?.aborted && isAbortError(err)) {
        throw err;
      }
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

    // Map CatalogSortOption to Forge API v0 format
    let apiSort = '-downloads';
    switch (filters.sort) {
      case 'downloads':
        apiSort = '-downloads';
        break;
      case 'recent':
        apiSort = '-published_at';
        break;
      case 'name_az':
        apiSort = 'name';
        break;
      case 'name_za':
        apiSort = '-name';
        break;
      case 'endorsements':
        apiSort = '-endorsements_count';
        break;
      case 'favourites':
        apiSort = '-favourites_count';
        break;
    }

    const cleanSpt = filters.sptVersion && filters.sptVersion !== 'All'
      ? filters.sptVersion.replace(/^[vV\s]+/, '').trim()
      : '';

    // 1. Attempt Live Server-Side Search via Forge API v0
    try {
      const queryParams = new URLSearchParams();
      queryParams.set('page', String(page));
      queryParams.set('per_page', String(perPage));
      queryParams.set('include', 'versions,category');
      queryParams.set('sort', apiSort);

      if (filters.query?.trim()) {
        queryParams.set('query', filters.query.trim());
      }
      if (cleanSpt) {
        queryParams.set('filter[spt_version]', cleanSpt);
      }
      if (filters.categoryId) {
        queryParams.set('filter[category_id]', String(filters.categoryId));
      }
      if (filters.fikaOnly) {
        queryParams.set('filter[fika_compatibility]', 'compatible');
      }

      const queryString = queryParams.toString();
      const cacheKey = `mods-search:${queryString}`;

      if (filters.forceRefresh) {
        apiClient.clearCache(cacheKey);
      }

      const livePayload = await apiClient.deduplicatedJson<{
        normalizedMods: Mod[];
        total: number;
        currentPage: number;
        lastPage: number;
      }>(
        cacheKey,
        async () => {
          const res = await apiClient.request(`${API_BASE}/mods?${queryString}`, {
            signal: combineSignals(filters.signal, 5000),
          });
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const json = await res.json();
          if (!json || !Array.isArray(json.data) || json.data.length === 0) {
            throw new Error('Empty live catalog result');
          }
          const normalizedMods: Mod[] = [];
          for (const raw of json.data) {
            const m = normalizeMod(raw);
            catalogMap.set(m.id, m);
            normalizedMods.push(m);
          }
          rebuildCatalogIndex();

          const total = json.meta?.total ?? normalizedMods.length;
          const lastPage = json.meta?.last_page ?? Math.max(1, Math.ceil(total / perPage));
          return {
            normalizedMods,
            total,
            currentPage: json.meta?.current_page ?? page,
            lastPage,
          };
        },
        { forceRefresh: filters.forceRefresh, signal: filters.signal }
      );

      let filtered = livePayload.normalizedMods;
      if (filters.hideFeatured) {
        filtered = filtered.filter((m) => !m.featured);
      }
      if (filters.hideContainsAds) {
        filtered = filtered.filter((m) => !m.contains_ads);
      }
      if (filters.hideContainsAi) {
        filtered = filtered.filter((m) => !m.contains_ai_content);
      }
      if (filters.hideInstalled && filters.installedGuids?.length) {
        const installed = new Set(filters.installedGuids.map((g) => g.toLowerCase()));
        filtered = filtered.filter((m) => !(m.guid && installed.has(m.guid.toLowerCase())));
      }

      return {
        mods: filtered,
        total: livePayload.total,
        currentPage: livePayload.currentPage,
        lastPage: livePayload.lastPage,
        isOfflineFallback: false,
      };
    } catch (err) {
      if (filters.signal?.aborted && isAbortError(err)) {
        throw err;
      }
      // Live search failed or offline - fall through cleanly to local index
    }

    // 2. Offline / Cached Catalog Fallback
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
    signal?: AbortSignal;
  }): Promise<AddonQueryResult> {
    const page = params?.page || 1;
    const perPage = params?.perPage || 24;
    const search = params?.search?.trim() || '';
    const sort = params?.sort || 'downloads_desc';
    const modId = params?.modId;
    const forceRefresh = !!params?.forceRefresh;
    const signal = params?.signal;

    let apiSort = '-downloads';
    if (sort === 'created_desc' || sort === 'recent') apiSort = '-created_at';
    else if (sort === 'name_asc' || sort === 'name') apiSort = 'name';

    try {
      const queryParams = new URLSearchParams();
      queryParams.set('page', String(page));
      queryParams.set('per_page', String(perPage));
      queryParams.set('include', 'mod,versions');
      queryParams.set('sort', apiSort);
      if (search) queryParams.set('query', search);
      if (modId) queryParams.set('filter[mod_id]', String(modId));

      const queryString = queryParams.toString();
      const cacheKey = `addons:${queryString}`;

      if (forceRefresh) {
        apiClient.clearCache(cacheKey);
      }

      return await apiClient.deduplicatedJson<AddonQueryResult>(
        cacheKey,
        async () => {
          const res = await apiClient.request(`${API_BASE}/addons?${queryString}`, {
            signal: combineSignals(signal, 6000),
          });
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const json = await res.json();
          const rawItems = Array.isArray(json.data) ? json.data : [];
          const addonsList = rawItems.map(normalizeAddon);
          const total = json.meta?.total ?? addonsList.length;
          const totalPages = json.meta?.last_page ?? Math.max(1, Math.ceil(total / perPage));

          return {
            data: addonsList,
            total,
            page: json.meta?.current_page ?? page,
            per_page: perPage,
            total_pages: totalPages,
            isOfflineFallback: false,
          };
        },
        { forceRefresh, signal }
      );
    } catch (err) {
      if (signal?.aborted && isAbortError(err)) {
        throw err;
      }
      console.warn('API error fetching addons, using fallback fixtures:', err);
    }
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
   * Batch fetch parent mods by IDs to eliminate N+1 stampedes
   */
  async getModsByIds(modIds: number[]): Promise<Array<{ id: number; name: string; thumbnail?: string; version: string }>> {
    initializeCatalog();
    const uniqueIds = [...new Set(modIds)];
    const results: Array<{ id: number; name: string; thumbnail?: string; version: string }> = [];
    const missingIds: number[] = [];

    for (const id of uniqueIds) {
      const cached = catalogMap.get(id) || FIXTURE_MODS.find((m) => m.id === id);
      if (cached) {
        results.push({
          id: cached.id,
          name: cached.name,
          thumbnail: cached.thumbnail,
          version: cached.versions?.[0]?.version || '1.0.0',
        });
      } else {
        missingIds.push(id);
      }
    }

    if (missingIds.length > 0) {
      const fetched = await Promise.allSettled(missingIds.map((id) => this.getMod(id)));
      for (const res of fetched) {
        if (res.status === 'fulfilled' && res.value) {
          const m = res.value;
          results.push({
            id: m.id,
            name: m.name,
            thumbnail: m.thumbnail,
            version: m.versions?.[0]?.version || '1.0.0',
          });
        }
      }
    }

    return results;
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
      const cache = cachedAllAddons as { data: Addon[]; timestamp: number };
      const found = cache.data.find((a: Addon) => a.id === addonId);
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
  },

  /**
   * Resolve dependencies for an addon (GET /api/v0/addons/dependencies?addons={id:version})
   */
  async resolveAddonDependencies(
    addonId: number | string,
    version: string = '1.0.0'
  ): Promise<any[]> {
    try {
      const url = `${API_BASE}/addons/dependencies?addons=${encodeURIComponent(`${addonId}:${version}`)}`;
      const res = await apiClient.request(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const json = await res.json();
        return json.data || [];
      }
    } catch (err) {
      console.warn('Failed resolving addon dependencies:', err);
    }
    return [];
  },

  /**
   * Query the official SP-Mod Forge updates endpoint for installed mods:
   * GET /api/v0/mods/updates?mods={identifier:version,...}&spt_version={sptVersion}
   * Accepts up to 75 mods per batch, returns updates, blocked_updates, up_to_date, and incompatible_with_spt.
   * Includes robust local catalog and fixture fallback.
   */
  async checkModUpdates(
    installedMods: InstalledMod[],
    sptVersion: string = '4.1.6'
  ): Promise<CheckModUpdatesResult> {
    initializeCatalog();
    const cleanSpt = (sptVersion || '4.1.6').replace(/^[vV\s]+/, '').trim();

    if (!installedMods || installedMods.length === 0) {
      return {
        hasUpdates: false,
        updatesCount: 0,
        updatedMods: [],
        upToDateCount: 0,
        incompatibleCount: 0,
      };
    }

    const updatedModsMap = new Map<string, any>();
    const checkedModIds = new Set<string>();

    // Chunk mods into batches of 50 (well within max 75 allowed by API)
    const BATCH_SIZE = 50;
    for (let i = 0; i < installedMods.length; i += BATCH_SIZE) {
      const batch = installedMods.slice(i, i + BATCH_SIZE);
      const queryTokens: string[] = [];
      const tokenToModMap = new Map<string, InstalledMod>();

      for (const m of batch) {
        const ver = m.version || '1.0.0';
        let identifier = '';
        if (m.modId) {
          identifier = String(m.modId);
        } else if (m.inferredGuid) {
          identifier = m.inferredGuid;
        } else {
          identifier = m.id.replace(/^disk\.(server|client)\./, '');
        }

        if (identifier) {
          const token = `${identifier}:${ver}`;
          queryTokens.push(token);
          tokenToModMap.set(token, m);
          tokenToModMap.set(identifier.toLowerCase(), m);
          if (m.modId) tokenToModMap.set(String(m.modId), m);
          if (m.inferredGuid) tokenToModMap.set(m.inferredGuid.toLowerCase(), m);
        }
      }

      if (queryTokens.length > 0) {
        try {
          const url = `${API_BASE}/mods/updates?mods=${encodeURIComponent(queryTokens.join(','))}&spt_version=${encodeURIComponent(cleanSpt)}`;
          const res = await apiClient.request(url, { signal: AbortSignal.timeout(6000) });
          if (res.ok) {
            const json = await res.json();
            const data = json.data || {};

            const updatesList = Array.isArray(data.updates) ? data.updates : [];
            for (const item of updatesList) {
              const matchedMod =
                tokenToModMap.get(String(item.id)) ||
                tokenToModMap.get((item.guid || '').toLowerCase()) ||
                tokenToModMap.get((item.slug || '').toLowerCase()) ||
                batch.find((b) => b.modId === item.id || b.name.toLowerCase() === item.name?.toLowerCase());

              if (matchedMod && item.recommended_version) {
                const rec = item.recommended_version;
                updatedModsMap.set(matchedMod.id, {
                  installedModId: matchedMod.id,
                  modId: item.id || matchedMod.modId,
                  guid: item.guid || matchedMod.inferredGuid,
                  currentVersion: matchedMod.version,
                  latestVersion: rec.version,
                  downloadUrl: rec.link || `https://sp-mod.com/mod/download/${item.id}/${item.slug || 'mod'}/${rec.version}`,
                  versionId: rec.id,
                  contentLength: rec.content_length,
                  fikaCompatibility: rec.fika_compatibility === 'compatible' || rec.fika_compatibility === true,
                  changeSummary: rec.changelog || rec.description || `Update to v${rec.version}`,
                });
                checkedModIds.add(matchedMod.id);
              }
            }

            const upToDateList = Array.isArray(data.up_to_date) ? data.up_to_date : [];
            for (const item of upToDateList) {
              const matchedMod =
                tokenToModMap.get(String(item.id)) ||
                tokenToModMap.get((item.guid || '').toLowerCase()) ||
                tokenToModMap.get((item.slug || '').toLowerCase());
              if (matchedMod) {
                checkedModIds.add(matchedMod.id);
              }
            }
          }
        } catch (apiErr) {
          console.warn('[Updates API] Batch check failed, falling back to catalog:', apiErr);
        }
      }
    }

    // Local catalog / fixture fallback check for any mods not verified by live API or offline
    for (const m of installedMods) {
      if (checkedModIds.has(m.id)) continue;

      let catalogMod = m.modId ? catalogMap.get(m.modId) : null;
      if (!catalogMod) {
        catalogMod = FIXTURE_MODS.find(
          (f) =>
            (m.modId && f.id === m.modId) ||
            (m.inferredGuid && f.guid?.toLowerCase() === m.inferredGuid.toLowerCase()) ||
            f.name.toLowerCase() === m.name.toLowerCase()
        ) || null;
      }

      if (catalogMod && catalogMod.versions && catalogMod.versions.length > 0) {
        const matchingVer = findMatchingModVersion(catalogMod.versions, cleanSpt) || catalogMod.versions[0];
        if (matchingVer && matchingVer.version && matchingVer.version !== m.version) {
          updatedModsMap.set(m.id, {
            installedModId: m.id,
            modId: catalogMod.id,
            guid: catalogMod.guid || m.inferredGuid,
            currentVersion: m.version,
            latestVersion: matchingVer.version,
            downloadUrl: matchingVer.link || `https://sp-mod.com/mod/download/${catalogMod.id}/${catalogMod.slug || 'mod'}/${matchingVer.version}`,
            versionId: matchingVer.id,
            contentLength: matchingVer.content_length,
            fikaCompatibility: matchingVer.fika_compatibility === 'compatible' || (matchingVer as any).fika_compatibility === true,
            changeSummary: matchingVer.description || `Update available: v${matchingVer.version}`,
          });
        }
      }
    }

    const updatedMods = Array.from(updatedModsMap.values());
    return {
      hasUpdates: updatedMods.length > 0,
      updatesCount: updatedMods.length,
      updatedMods,
      upToDateCount: Math.max(0, installedMods.length - updatedMods.length),
      incompatibleCount: 0,
    };
  }
};


