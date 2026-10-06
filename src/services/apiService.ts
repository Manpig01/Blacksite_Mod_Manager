import { Mod, ModCategory, SptVersionInfo, ModVersion, CatalogSortOption, RecommendedModItem, InstalledMod, ForgeDependencyNode, ResolvedDependencyItem } from '../types';
import { FIXTURE_MODS, MOD_CATEGORIES, SPT_VERSIONS } from '../data/fixtureCatalog';
import { getKnownDependencyMeta } from '../data/knownDependencies';
import { sortSptVersionsByMostRecent, sortModVersionsByMostRecent } from '../utils/versionUtils';

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
        const depVer = targetVerObj?.version || '1.0.0';
        const downloadUrl =
          targetVerObj?.link ||
          `https://sp-mod.com/mod/download/${nodeId}/${node.slug || 'mod'}/${depVer}`;

        const isInstalled =
          installedMap.has(nodeGuid.toLowerCase()) ||
          installedMap.has(String(nodeId)) ||
          installedMap.has(node.name.toLowerCase());

        const existingInstalled =
          installedMap.get(nodeGuid.toLowerCase()) ||
          installedMap.get(String(nodeId)) ||
          installedMap.get(node.name.toLowerCase());

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

  async searchMods(filters: CatalogQueryFilters): Promise<CatalogQueryResult> {
    const page = filters.page || 1;
    const perPage = filters.perPage || 20;

    // Try live API first if query permits
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('per_page', String(perPage));

      if (filters.query?.trim()) {
        params.set('query', filters.query.trim());
      }
      if (filters.categoryId) {
        params.set('filter[category_id]', String(filters.categoryId));
      }
      if (filters.sptVersion && filters.sptVersion !== 'All') {
        params.set('filter[spt_version]', filters.sptVersion);
      }
      if (filters.fikaOnly) {
        params.set('filter[fika_compatibility]', '1');
      }

      // Sort mapping
      switch (filters.sort) {
        case 'downloads':
          params.set('sort', '-downloads');
          break;
        case 'recent':
          params.set('sort', '-published_at');
          break;
        case 'name_az':
          params.set('sort', 'name');
          break;
        case 'name_za':
          params.set('sort', '-name');
          break;
        case 'endorsements':
          params.set('sort', '-endorsements_count');
          break;
        case 'favourites':
          params.set('sort', '-favourites_count');
          break;
        default:
          params.set('sort', '-downloads');
      }

      const res = await fetch(`${API_BASE}/mods?${params.toString()}`, {
        signal: AbortSignal.timeout(4500)
      });

      if (res.ok) {
        const json = await res.json();
        if (json.data && Array.isArray(json.data)) {
          let list: Mod[] = json.data.map((m: Mod) => ({
            ...m,
            thumbnail:
              normalizeForgeImageUrl(m.thumbnail) ||
              (m.hub_id ? `https://files.sp-mod.com/mods/${m.hub_id}.png` : ''),
            owner: m.owner
              ? {
                  ...m.owner,
                  profile_photo_url: normalizeForgeImageUrl(m.owner.profile_photo_url),
                }
              : m.owner,
          }));

          if (filters.hideFeatured) {
            list = list.filter(m => !m.featured);
          }
          if (filters.hideContainsAds) {
            list = list.filter(m => !m.contains_ads);
          }
          if (filters.hideContainsAi) {
            list = list.filter(m => !m.contains_ai_content);
          }
          if (filters.hideInstalled && filters.installedGuids?.length) {
            const installed = new Set(filters.installedGuids);
            list = list.filter(m => !(m.guid && installed.has(m.guid)));
          }

          return {
            mods: list,
            total: json.meta?.total || list.length,
            currentPage: json.meta?.current_page || page,
            lastPage: json.meta?.last_page || 1,
            isOfflineFallback: false
          };
        }
      }
    } catch {
      // Fall back to robust client-side filter
    }

    // Local fixture filter fallback
    let list = [...FIXTURE_MODS];

    // Filter text / author
    if (filters.query?.trim()) {
      const q = filters.query.trim().toLowerCase();
      if (q.startsWith('@')) {
        const authorQuery = q.slice(1).trim();
        list = list.filter(m => m.owner?.name.toLowerCase().includes(authorQuery));
      } else {
        list = list.filter(m =>
          m.name.toLowerCase().includes(q) ||
          (m.guid && m.guid.toLowerCase().includes(q)) ||
          (m.teaser && m.teaser.toLowerCase().includes(q)) ||
          (m.owner?.name && m.owner.name.toLowerCase().includes(q))
        );
      }
    }

    // Category
    if (filters.categoryId) {
      list = list.filter(m => m.category_id === filters.categoryId);
    }

    // Fika only
    if (filters.fikaOnly) {
      list = list.filter(m => m.fika_compatibility === true);
    }

    // Toggles
    if (filters.hideFeatured) {
      list = list.filter(m => !m.featured);
    }
    if (filters.hideContainsAds) {
      list = list.filter(m => !m.contains_ads);
    }
    if (filters.hideContainsAi) {
      list = list.filter(m => !m.contains_ai_content);
    }
    if (filters.hideInstalled && filters.installedGuids?.length) {
      const installed = new Set(filters.installedGuids);
      list = list.filter(m => !(m.guid && installed.has(m.guid)));
    }

    // Sorting
    list.sort((a, b) => {
      switch (filters.sort) {
        case 'downloads':
          return b.downloads - a.downloads;
        case 'recent':
          return new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime();
        case 'name_az':
          return a.name.localeCompare(b.name);
        case 'name_za':
          return b.name.localeCompare(a.name);
        case 'endorsements':
          return b.endorsements_count - a.endorsements_count;
        case 'favourites':
          return b.favourites_count - a.favourites_count;
        default:
          return b.downloads - a.downloads;
      }
    });

    const total = list.length;
    const start = (page - 1) * perPage;
    const paged = list.slice(start, start + perPage);

    return {
      mods: paged,
      total,
      currentPage: page,
      lastPage: Math.max(1, Math.ceil(total / perPage)),
      isOfflineFallback: true
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
  }
};
