import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Search,
  Puzzle,
  Layers,
  AlertTriangle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { Addon, AddonVersion, InstalledMod } from '../types';
import { apiService, isAbortError } from '../services/apiService';
import { parentModResolver } from '../services/parentModResolver';
import { AddonCard } from './addons/AddonCard';
import { AddonInspectModal } from './addons/AddonInspectModal';

interface AddonsTabProps {
  installedMods: InstalledMod[];
  onInstallAddon: (addon: Addon, version: AddonVersion) => void;
  onNavigateToMod?: (modId: number) => void;
  onShowToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const AddonsTab: React.FC<AddonsTabProps> = ({
  installedMods,
  onInstallAddon,
  onNavigateToMod,
  onShowToast,
}) => {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<'downloads_desc' | 'created_desc' | 'name_asc'>('downloads_desc');
  const [installedParentFilter, setInstalledParentFilter] = useState<
    'all' | 'installed_parent_only' | 'missing_parent_only'
  >('all');
  const [selectedParentModId, setSelectedParentModId] = useState<number | null>(null);
  const [selectedParentModName, setSelectedParentModName] = useState<string | null>(null);

  const [addons, setAddons] = useState<Addon[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isOfflineFallback, setIsOfflineFallback] = useState<boolean>(false);

  // Modal inspection state
  const [inspectAddon, setInspectAddon] = useState<Addon | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Debounce search input by 260ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 260);
    return () => clearTimeout(timer);
  }, [search]);

  // Set of installed mod names and IDs for fast relationship matching
  const installedModLookup = useMemo(() => {
    const nameMap = new Map<string, InstalledMod>();
    for (const m of installedMods) {
      nameMap.set(m.name.toLowerCase().trim(), m);
      nameMap.set(m.id.toLowerCase().trim(), m);
      if (m.modId) {
        nameMap.set(String(m.modId), m);
      }
    }
    return nameMap;
  }, [installedMods]);

  // Precompute O(1) lookup map for the current addons batch
  const addonStatusMap = useMemo(() => {
    const map = new Map<number, { parentInstalled: boolean; alreadyInstalled: boolean }>();
    const lookupKeys = Array.from(installedModLookup.keys());

    for (const addon of addons) {
      let parentInstalled = false;
      if (addon.mod_id && installedModLookup.has(String(addon.mod_id))) {
        parentInstalled = true;
      } else if (addon.mod) {
        const pName = addon.mod.name.toLowerCase().trim();
        const pSlug = addon.mod.slug?.toLowerCase().trim();
        if (installedModLookup.has(pName)) {
          parentInstalled = true;
        } else {
          for (const key of lookupKeys) {
            if (pSlug && (key.includes(pSlug) || pSlug.includes(key))) {
              parentInstalled = true;
              break;
            }
            if (key.includes(pName) || pName.includes(key)) {
              parentInstalled = true;
              break;
            }
          }
        }
      }

      const aName = addon.name.toLowerCase().trim();
      let alreadyInstalled = installedModLookup.has(aName);
      if (!alreadyInstalled) {
        for (const key of lookupKeys) {
          if (key.includes(aName) || aName.includes(key)) {
            alreadyInstalled = true;
            break;
          }
        }
      }

      map.set(addon.id, { parentInstalled, alreadyInstalled });
    }
    return map;
  }, [addons, installedModLookup]);

  // Load addons from API with AbortController support
  const fetchAddons = useCallback(
    async (forceRefresh = false) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setLoading(true);
      setError(null);
      try {
        const res = await apiService.getAddons({
          page,
          perPage: 24,
          search: debouncedSearch,
          sort,
          modId: selectedParentModId || undefined,
          forceRefresh,
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        setAddons(res.data);
        setTotalCount(res.total);
        setTotalPages(res.total_pages);
        setIsOfflineFallback(!!res.isOfflineFallback);

        if (res.data && res.data.length > 0) {
          const parentIds = res.data
            .filter((a) => !a.mod?.thumbnail && a.mod_id)
            .map((a) => a.mod_id);
          if (parentIds.length > 0) {
            const installedIds = new Set(installedMods.map((m) => m.modId).filter(Boolean) as number[]);
            parentModResolver
              .prefetchParentBatch(parentIds, installedIds, (ids) => apiService.getModsByIds(ids))
              .catch(() => {});
          }
        }
      } catch (err: any) {
        if (isAbortError(err)) return;
        console.error('Failed to load addons from SPT API:', err);
        setError(err?.message || 'Failed to retrieve addons catalog.');
      } finally {
        if (abortControllerRef.current === controller) {
          setLoading(false);
        }
      }
    },
    [page, debouncedSearch, sort, selectedParentModId, installedMods]
  );

  useEffect(() => {
    fetchAddons(false);
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [fetchAddons]);

  // Filter addons locally if installed-parent filter is active
  const filteredAddons = useMemo(() => {
    if (installedParentFilter === 'all') return addons;

    return addons.filter((addon) => {
      const status = addonStatusMap.get(addon.id);
      const installed = status?.parentInstalled ?? false;
      if (installedParentFilter === 'installed_parent_only') return installed;
      if (installedParentFilter === 'missing_parent_only') return !installed;
      return true;
    });
  }, [addons, installedParentFilter, addonStatusMap]);

  const handleInstallClick = useCallback(
    (addon: Addon, specifiedVersion?: AddonVersion) => {
      const targetVersion =
        specifiedVersion ||
        (addon.versions && addon.versions.length > 0
          ? addon.versions[0]
          : {
              id: addon.id * 10,
              addon_id: addon.id,
              version: '1.0.0',
              slug: '1-0-0',
              link: `https://sp-mod.com/addon/download/${addon.id}/${addon.slug || 'addon'}/1.0.0`,
            });

      onInstallAddon(addon, targetVersion);
    },
    [onInstallAddon]
  );

  const handleFilterByParentMod = useCallback(
    (modId: number, modName: string) => {
      setSelectedParentModId(modId);
      setSelectedParentModName(modName);
      setPage(1);
      onShowToast('Addon Filter', `Filtering addons for parent mod "${modName}"`, 'info');
    },
    [onShowToast]
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-[#121418] overflow-hidden text-[#E8EAEE]">
      {/* Top Banner & Filter Controls */}
      <div className="bg-[#181B20] border-b border-[#23272E] p-4 shrink-0 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#EA580C]/10 border border-[#EA580C]/20 flex items-center justify-center text-[#EA580C] shrink-0">
              <Puzzle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-bold text-[#E8EAEE]">Addon Modules & Presets</h1>
                <span className="px-2 py-0.5 text-[11px] font-mono tabular-nums bg-[#20252D] text-[#9AA3AF] rounded border border-[#2A303C]">
                  {totalCount} Addons
                </span>
                {isOfflineFallback ? (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] text-[11px]">
                    <AlertTriangle className="w-3 h-3" />
                    <span>Offline Fallback</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#10B981]/10 border border-[#10B981]/30 text-[#10B981] text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse"></span>
                    <span>Live SPT API (sp-mod.com)</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-[#9AA3AF] mt-0.5">
                Community presets, custom spawn configs, audio overhauls, and modular expansions synced directly from the official SPT Forge repository.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => fetchAddons(true)}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[#20252D] hover:bg-[#282E38] text-[#E8EAEE] border border-[#2A303C] flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              title="Force Refresh from SPT API"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#EA580C]' : ''}`} />
              <span>Refresh API</span>
            </button>
          </div>
        </div>

        {/* Search and Filter Row */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          {/* Search input */}
          <div className="relative md:col-span-5">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9AA3AF]" />
            <input
              ref={searchInputRef}
              data-global-search="true"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search addons, configs, authors, or parent mods..."
              className="w-full bg-[#121418] border border-[#2A303C] rounded pl-9 pr-14 py-1.5 text-xs text-[#E8EAEE] placeholder-[#6B7280] focus:outline-none focus:border-[#EA580C] transition-colors"
            />
            {search ? (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  searchInputRef.current?.focus();
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[#9AA3AF] hover:text-[#E8EAEE] cursor-pointer"
              >
                Clear
              </button>
            ) : (
              <kbd
                onClick={() => searchInputRef.current?.focus()}
                className="hidden sm:inline-block absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-mono text-[#6B7480] bg-[#181B20] border border-[#2A303C] rounded cursor-pointer hover:border-[#EA580C]"
                title="Press Ctrl+K or '/' to focus search"
              >
                Ctrl K
              </kbd>
            )}
          </div>

          {/* Sort selection */}
          <div className="md:col-span-3 flex items-center gap-2">
            <span className="text-xs text-[#9AA3AF] shrink-0">Sort:</span>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as 'downloads_desc' | 'created_desc' | 'name_asc');
                setPage(1);
              }}
              className="flex-1 bg-[#121418] border border-[#2A303C] rounded px-2.5 py-1.5 text-xs text-[#E8EAEE] focus:outline-none focus:border-[#EA580C]"
            >
              <option value="downloads_desc">Most Downloaded</option>
              <option value="created_desc">Recently Created</option>
              <option value="name_asc">Alphabetical (A-Z)</option>
            </select>
          </div>

          {/* Installed Parent Mod Filter */}
          <div className="md:col-span-4 flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-[#9AA3AF] shrink-0" />
            <select
              value={installedParentFilter}
              onChange={(e) =>
                setInstalledParentFilter(
                  e.target.value as 'all' | 'installed_parent_only' | 'missing_parent_only'
                )
              }
              className="flex-1 bg-[#121418] border border-[#2A303C] rounded px-2.5 py-1.5 text-xs text-[#E8EAEE] focus:outline-none focus:border-[#EA580C]"
            >
              <option value="all">All Addons</option>
              <option value="installed_parent_only">Parent Mod Installed In Loadout</option>
              <option value="missing_parent_only">Missing Parent Mod Only</option>
            </select>
          </div>
        </div>

        {selectedParentModId && (
          <div className="flex items-center justify-between p-2 rounded bg-[#EA580C]/10 border border-[#EA580C]/30 text-xs text-[#EA580C]">
            <div className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              <span>
                Filtering addons for parent mod: <strong>{selectedParentModName || `ID ${selectedParentModId}`}</strong>
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedParentModId(null);
                setSelectedParentModName(null);
                setPage(1);
              }}
              className="text-[11px] font-semibold underline hover:text-white cursor-pointer"
            >
              Show all parent mods
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {loading ? (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-[#9AA3AF]">
            <RefreshCw className="w-6 h-6 animate-spin text-[#EA580C]" />
            <p className="text-sm font-medium text-[#E8EAEE]">Fetching Live SPT Forge Addons...</p>
            <p className="text-xs text-[#9AA3AF]">Connecting to sp-mod.com repository</p>
          </div>
        ) : error ? (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-[#EF4444]/10 border border-[#EF4444]/20 flex items-center justify-center text-[#EF4444]">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-[#E8EAEE]">{error}</p>
            <button
              type="button"
              onClick={() => fetchAddons(true)}
              className="px-3 py-1.5 bg-[#20252D] hover:bg-[#282E38] text-xs font-medium rounded border border-[#2A303C] text-[#E8EAEE] cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        ) : filteredAddons.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center gap-2 text-center text-[#9AA3AF]">
            <Puzzle className="w-10 h-10 opacity-30 text-[#EA580C]" />
            <p className="text-sm font-medium text-[#E8EAEE]">No Addons Found</p>
            <p className="text-xs max-w-sm">
              {debouncedSearch
                ? `No addons matching "${debouncedSearch}". Try clearing search keywords.`
                : 'No addons found for the active filter.'}
            </p>
            {(debouncedSearch || installedParentFilter !== 'all' || selectedParentModId) && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setInstalledParentFilter('all');
                  setSelectedParentModId(null);
                  setSelectedParentModName(null);
                  setPage(1);
                }}
                className="mt-2 text-xs text-[#EA580C] hover:underline cursor-pointer font-medium"
              >
                Reset All Filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredAddons.map((addon) => {
              const status = addonStatusMap.get(addon.id);
              return (
                <AddonCard
                  key={addon.id}
                  addon={addon}
                  parentInstalled={status?.parentInstalled ?? false}
                  alreadyInstalled={status?.alreadyInstalled ?? false}
                  onInspect={setInspectAddon}
                  onInstall={handleInstallClick}
                  onFilterByParentMod={handleFilterByParentMod}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      {!loading && totalPages > 1 && (
        <div className="bg-[#181B20] border-t border-[#23272E] px-4 py-2.5 flex items-center justify-between shrink-0">
          <div className="text-xs text-[#9AA3AF] tabular-nums">
            Page <span className="font-mono text-[#E8EAEE]">{page}</span> of{' '}
            <span className="font-mono text-[#E8EAEE]">{totalPages}</span>
            <span className="ml-2 font-mono text-[#6B7280]">({totalCount} total addons)</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (page > 1) {
                  setPage((p) => p - 1);
                  scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }}
              disabled={page <= 1}
              className="px-2.5 py-1 text-xs rounded bg-[#20252D] hover:bg-[#282E38] text-[#E8EAEE] border border-[#2A303C] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Previous</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (page < totalPages) {
                  setPage((p) => p + 1);
                  scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }}
              disabled={page >= totalPages}
              className="px-2.5 py-1 text-xs rounded bg-[#20252D] hover:bg-[#282E38] text-[#E8EAEE] border border-[#2A303C] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition-colors cursor-pointer"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Addon Details & Versions Modal */}
      <AddonInspectModal
        addon={inspectAddon}
        parentInstalled={
          inspectAddon ? addonStatusMap.get(inspectAddon.id)?.parentInstalled ?? false : false
        }
        onClose={() => setInspectAddon(null)}
        onInstallVersion={handleInstallClick}
        onNavigateToMod={onNavigateToMod}
      />
    </div>
  );
};
