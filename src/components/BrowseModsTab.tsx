import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Upload } from 'lucide-react';
import { Mod, ModCategory, SptVersionInfo, CatalogSortOption, InstalledMod, ModVersion } from '../types';
import { apiService, CatalogQueryResult, isAbortError } from '../services/apiService';
import { storageService } from '../services/storageService';
import {
  sortSptVersionsByMostRecent,
  findMatchingModVersion,
} from '../utils/versionUtils';
import { RecommendedModsSection } from './RecommendedModsSection';
import { BrowseFilterBar } from './browse/BrowseFilterBar';
import { BrowseModCard } from './browse/BrowseModCard';

interface BrowseModsTabProps {
  sptVersion: string;
  categories: ModCategory[];
  sptVersions: SptVersionInfo[];
  installedMods: InstalledMod[];
  onInstallMod: (mod: Mod, version?: string, targetSptVersion?: string) => void;
  onOpenVersions: (mod: Mod) => void;
  onInstallFromFile: (file: File) => void;
  onShowToast: (title: string, message: string, type: 'success' | 'info' | 'warning' | 'error') => void;
  showRecommendedMods?: boolean;
  onToggleShowRecommended?: (show: boolean) => void;
}

export const BrowseModsTab: React.FC<BrowseModsTabProps> = ({
  sptVersion,
  categories,
  sptVersions,
  installedMods,
  onInstallMod,
  onOpenVersions,
  onInstallFromFile,
  onShowToast,
  showRecommendedMods = true,
  onToggleShowRecommended,
}) => {
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [selectedSptVersion, setSelectedSptVersion] = useState<string>('All');
  const [selectedSort, setSelectedSort] = useState<CatalogSortOption>('recent');
  const [perPage, setPerPage] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const [hideFeatured, setHideFeatured] = useState<boolean>(false);
  const [hideContainsAds, setHideContainsAds] = useState<boolean>(false);
  const [hideContainsAi, setHideContainsAi] = useState<boolean>(false);
  const [hideInstalled, setHideInstalled] = useState<boolean>(false);
  const [fikaOnly, setFikaOnly] = useState<boolean>(false);
  const [favoritesOnly, setFavoritesOnly] = useState<boolean>(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(() => new Set(storageService.loadFavoriteModIds()));

  const [queryResult, setQueryResult] = useState<CatalogQueryResult>({
    mods: [],
    total: 0,
    currentPage: 1,
    lastPage: 1,
    isOfflineFallback: false,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  // Precomputed O(1) Set and array of installed GUIDs/IDs
  const { installedGuids, installedGuidSet, installedModIdSet } = useMemo(() => {
    const guids: string[] = [];
    const guidSet = new Set<string>();
    const modIdSet = new Set<number>();
    for (const m of installedMods) {
      guids.push(m.id);
      guidSet.add(m.id.toLowerCase());
      if (m.inferredGuid) guidSet.add(m.inferredGuid.toLowerCase());
      if (m.modId) modIdSet.add(m.modId);
    }
    return {
      installedGuids: guids,
      installedGuidSet: guidSet,
      installedModIdSet: modIdSet,
    };
  }, [installedMods]);

  // SPT versions sorted strictly in order of most recent releases
  const sortedSptVersions = useMemo(() => sortSptVersionsByMostRecent(sptVersions), [sptVersions]);

  // Active target SPT version
  const activeTargetSptVersion = selectedSptVersion !== 'All' ? selectedSptVersion : sptVersion;

  // Cache for mod versions to dynamically display and install the matching release
  const [modVersionsCache, setModVersionsCache] = useState<Record<number, ModVersion[]>>({});

  // Scroll container ref for smooth scroll-to-top on page change
  const catalogScrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    catalogScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentPage]);

  // Seed embedded versions and lazy-fetch only when genuinely missing
  useEffect(() => {
    const immediateSeeds: Record<number, ModVersion[]> = {};
    for (const m of queryResult.mods) {
      if (m.id && Array.isArray(m.versions) && m.versions.length > 0 && !modVersionsCache[m.id]) {
        immediateSeeds[m.id] = m.versions;
      }
    }
    if (Object.keys(immediateSeeds).length > 0) {
      setModVersionsCache((prev) => ({ ...prev, ...immediateSeeds }));
    }

    const modsToFetch = queryResult.mods.filter(
      (m) => m.id && !modVersionsCache[m.id] && (!m.versions || m.versions.length === 0)
    );
    if (modsToFetch.length === 0) return;

    let isMounted = true;
    const fetchPromises = modsToFetch.slice(0, 5).map(async (m) => {
      try {
        const verList = await apiService.getModVersions(m.id);
        return { id: m.id, versions: verList };
      } catch {
        return null;
      }
    });

    Promise.all(fetchPromises).then((results) => {
      if (!isMounted) return;
      const newEntries: Record<number, ModVersion[]> = {};
      for (const res of results) {
        if (res && res.versions.length > 0) {
          newEntries[res.id] = res.versions;
        }
      }
      if (Object.keys(newEntries).length > 0) {
        setModVersionsCache((prev) => ({ ...prev, ...newEntries }));
      }
    });

    return () => {
      isMounted = false;
    };
  }, [queryResult.mods]);

  const loadMods = useCallback(
    async (forceRefresh = false) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setLoading(true);
      try {
        const res = await apiService.searchMods({
          query: searchText,
          categoryId: selectedCategory,
          sptVersion: selectedSptVersion,
          sort: selectedSort,
          page: currentPage,
          perPage: perPage,
          hideFeatured,
          hideContainsAds,
          hideContainsAi,
          hideInstalled,
          fikaOnly,
          installedGuids,
          signal: controller.signal,
          forceRefresh,
        });

        if (controller.signal.aborted) return;

        const currentFavs = new Set(storageService.loadFavoriteModIds());
        setFavoriteIds(currentFavs);
        const modsWithFavorites: Mod[] = res.mods.map((m) => ({
          ...m,
          favorite: currentFavs.has(m.id),
        }));

        setQueryResult({
          ...res,
          mods: modsWithFavorites,
        });
      } catch (err) {
        if (isAbortError(err)) return;
        console.error(err);
        onShowToast('Catalog Query Error', 'Failed to retrieve mods from catalog.', 'error');
      } finally {
        if (abortControllerRef.current === controller) {
          setLoading(false);
        }
      }
    },
    [
      searchText,
      selectedCategory,
      selectedSptVersion,
      selectedSort,
      currentPage,
      perPage,
      hideFeatured,
      hideContainsAds,
      hideContainsAi,
      hideInstalled,
      fikaOnly,
      installedGuids,
      onShowToast,
    ]
  );

  // Debounced search query with cleanup abort
  useEffect(() => {
    const handler = setTimeout(() => {
      loadMods(false);
    }, 240);
    return () => {
      clearTimeout(handler);
      abortControllerRef.current?.abort();
    };
  }, [loadMods]);

  const handleToggleFavorite = useCallback(
    (mod: Mod, e?: React.MouseEvent) => {
      e?.stopPropagation();
      const isNowFavorite = storageService.toggleFavoriteMod(mod.id);
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (isNowFavorite) {
          next.add(mod.id);
        } else {
          next.delete(mod.id);
        }
        return next;
      });

      setQueryResult((prev) => ({
        ...prev,
        mods: prev.mods.map((m) => (m.id === mod.id ? { ...m, favorite: isNowFavorite } : m)),
      }));

      onShowToast(
        isNowFavorite ? 'Added to Favorites' : 'Removed from Favorites',
        `"${mod.name}" was ${isNowFavorite ? 'added to' : 'removed from'} your favorites.`,
        isNowFavorite ? 'success' : 'info'
      );
    },
    [onShowToast]
  );

  const handleClearFilters = useCallback(() => {
    setSearchText('');
    setSelectedCategory(null);
    setSelectedSptVersion('All');
    setSelectedSort('downloads');
    setHideFeatured(false);
    setHideContainsAds(false);
    setHideContainsAi(false);
    setHideInstalled(false);
    setFikaOnly(false);
    setFavoritesOnly(false);
    setCurrentPage(1);
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.zip') || file.name.endsWith('.7z') || file.name.endsWith('.rar')) {
        onInstallFromFile(file);
      } else {
        onShowToast('Unsupported Archive', 'Only .zip, .7z, or .rar files are supported.', 'warning');
      }
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      onInstallFromFile(file);
      e.target.value = '';
    }
  };

  const visibleMods = useMemo(
    () =>
      favoritesOnly
        ? queryResult.mods.filter((m) => favoriteIds.has(m.id))
        : queryResult.mods,
    [queryResult.mods, favoritesOnly, favoriteIds]
  );

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden p-2 relative"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Drag & drop overlay indicator */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-[#181B20]/90 border-2 border-dashed border-[#EA580C] rounded-lg flex flex-col items-center justify-center pointer-events-none">
          <Upload className="w-12 h-12 text-[#EA580C] animate-bounce mb-2" />
          <p className="text-lg font-bold text-[#E8EAEE]">Drop mod archive (.zip, .7z, .rar) to queue install</p>
          <p className="text-sm text-[#9AA3AF]">Archive will be staged and routed through Blacksite extraction engine</p>
        </div>
      )}

      {/* Filter Bar */}
      <BrowseFilterBar
        searchText={searchText}
        onSearchChange={(val) => {
          setSearchText(val);
          setCurrentPage(1);
        }}
        selectedSptVersion={selectedSptVersion}
        onSptVersionChange={(val) => {
          setSelectedSptVersion(val);
          setCurrentPage(1);
        }}
        sortedSptVersions={sortedSptVersions}
        selectedCategory={selectedCategory}
        onCategoryChange={(val) => {
          setSelectedCategory(val);
          setCurrentPage(1);
        }}
        categories={categories}
        selectedSort={selectedSort}
        onSortChange={(val) => {
          setSelectedSort(val);
          setCurrentPage(1);
        }}
        perPage={perPage}
        onPerPageChange={(val) => {
          setPerPage(val);
          setCurrentPage(1);
        }}
        hideFeatured={hideFeatured}
        onToggleHideFeatured={setHideFeatured}
        hideContainsAds={hideContainsAds}
        onToggleHideContainsAds={setHideContainsAds}
        hideContainsAi={hideContainsAi}
        onToggleHideContainsAi={setHideContainsAi}
        hideInstalled={hideInstalled}
        onToggleHideInstalled={setHideInstalled}
        fikaOnly={fikaOnly}
        onToggleFikaOnly={setFikaOnly}
        favoritesOnly={favoritesOnly}
        onToggleFavoritesOnly={setFavoritesOnly}
        favoritesCount={favoriteIds.size}
        showRecommendedMods={showRecommendedMods}
        onToggleShowRecommended={onToggleShowRecommended}
        currentPage={currentPage}
        lastPage={queryResult.lastPage}
        totalMods={queryResult.total}
        visibleModsCount={visibleMods.length}
        isOfflineFallback={queryResult.isOfflineFallback}
        loading={loading}
        onPrevPage={() => setCurrentPage((p) => Math.max(1, p - 1))}
        onNextPage={() => setCurrentPage((p) => Math.min(queryResult.lastPage, p + 1))}
        onClearFilters={handleClearFilters}
        onRefresh={() => loadMods(true)}
        onFileInput={handleFileInput}
      />

      {/* Catalog Mod Grid */}
      <div ref={catalogScrollRef} className="flex-1 overflow-y-auto pr-1">
        {showRecommendedMods && (
          <RecommendedModsSection
            installedMods={installedMods}
            categories={categories}
            installedGuids={installedGuids}
            onInstallMod={(m, v) => onInstallMod(m, v, activeTargetSptVersion)}
            onOpenVersions={onOpenVersions}
            onHide={() => onToggleShowRecommended?.(false)}
          />
        )}

        {loading && queryResult.mods.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-[#9AA3AF]">
            <div className="w-8 h-8 border-2 border-[#EA580C] border-t-transparent rounded-full animate-spin mb-3"></div>
            <p>Loading mods catalog...</p>
          </div>
        ) : visibleMods.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-[#9AA3AF]">
            <span className="text-4xl opacity-50 mb-2">{favoritesOnly ? '❤️' : '🐉'}</span>
            <p className="text-base font-medium text-[#E8EAEE]">
              {favoritesOnly ? 'No favorite mods found' : 'No mods found matching your query'}
            </p>
            <p className="text-sm">
              {favoritesOnly
                ? 'Click the heart icon on any mod card to save it to your favorites.'
                : 'Try broadening your search term or resetting active filters.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pb-6">
            {visibleMods.map((mod) => {
              const isInstalled =
                installedModIdSet.has(mod.id) ||
                Boolean(mod.guid && installedGuidSet.has(mod.guid.toLowerCase()));
              const isFavorite = Boolean(mod.favorite ?? favoriteIds.has(mod.id));

              const versions = modVersionsCache[mod.id] || mod.versions || [];
              const matchingRelease = findMatchingModVersion(versions, activeTargetSptVersion);
              const displayVersion = matchingRelease?.version
                ? `v${matchingRelease.version.replace(/^v/i, '')}`
                : mod.versions?.[0]?.version
                ? `v${mod.versions[0].version.replace(/^v/i, '')}`
                : '';

              return (
                <BrowseModCard
                  key={mod.id}
                  mod={mod}
                  isInstalled={isInstalled}
                  isFavorite={isFavorite}
                  displayVersion={displayVersion}
                  matchingVersion={matchingRelease?.version}
                  activeTargetSptVersion={activeTargetSptVersion}
                  onToggleFavorite={handleToggleFavorite}
                  onOpenVersions={onOpenVersions}
                  onInstallMod={onInstallMod}
                />
              );
            })}
          </div>
        )}

        {/* Bottom Pagination Bar */}
        {queryResult.mods.length > 0 && (queryResult.lastPage || 1) > 1 && (
          <div className="flex items-center justify-between py-3 px-3 border-t border-[#23272E] my-3 bg-[#181B20]/40 rounded-lg">
            <span className="text-xs text-[#9AA3AF] font-mono tabular-nums">
              Page {queryResult.currentPage} of {queryResult.lastPage} ({queryResult.total.toLocaleString()} total mods)
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="bg-[#20252D] hover:bg-[#2A2F38] disabled:opacity-40 text-[#E8EAEE] px-3 py-1.5 rounded-md border border-[#2A2F38] flex items-center gap-1.5 text-xs font-semibold cursor-pointer disabled:cursor-not-allowed transition-colors"
                type="button"
                title="Previous page (smoothly scrolls to top)"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Previous Page</span>
              </button>
              <span className="text-[#E8EAEE] font-mono tabular-nums text-xs px-2 font-medium">
                {queryResult.currentPage} / {queryResult.lastPage}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(queryResult.lastPage || 1, p + 1))}
                disabled={currentPage >= (queryResult.lastPage || 1)}
                className="bg-[#20252D] hover:bg-[#2A2F38] disabled:opacity-40 text-[#E8EAEE] px-3 py-1.5 rounded-md border border-[#2A2F38] flex items-center gap-1.5 text-xs font-semibold cursor-pointer disabled:cursor-not-allowed transition-colors"
                type="button"
                title="Next page (smoothly scrolls to top)"
              >
                <span>Next Page</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
