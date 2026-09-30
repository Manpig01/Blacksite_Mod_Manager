import { Mod, ModCategory, SptVersionInfo, ModVersion, CatalogSortOption } from '../types';
import { FIXTURE_MODS, MOD_CATEGORIES, SPT_VERSIONS } from '../data/fixtureCatalog';

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
      const res = await fetch(`${API_BASE}/spt/versions?per_page=50`, {
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
    return SPT_VERSIONS;
  },

  async getModVersions(modId: number): Promise<ModVersion[]> {
    try {
      const res = await fetch(`${API_BASE}/mod/${modId}/versions?per_page=50`, {
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) {
        const json = await res.json();
        if (json.data && Array.isArray(json.data)) {
          return json.data;
        }
      }
    } catch {
      // Fallback to fixture
    }
    const fixtureMod = FIXTURE_MODS.find(m => m.id === modId);
    return fixtureMod?.versions || [
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
    ];
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
          let list: Mod[] = json.data;

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
  }
};
