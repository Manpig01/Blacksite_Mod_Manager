import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, RotateCw, ChevronLeft, ChevronRight, Upload, History, ExternalLink, Download, Check, Sparkles, Heart, Calendar, ThumbsUp } from 'lucide-react';
import { Mod, ModCategory, SptVersionInfo, CatalogSortOption, InstalledMod, ModVersion } from '../types';
import { apiService, CatalogQueryResult } from '../services/apiService';
import { storageService } from '../services/storageService';
import {
  sortSptVersionsByMostRecent,
  getSptBadgeClass,
  findMatchingModVersion,
} from '../utils/versionUtils';
import { ModThumbnail } from './ModThumbnail';
import { RecommendedModsSection } from './RecommendedModsSection';

function formatForgeDate(dateString?: string | null): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

  if (diffHours < 24 && date.getDate() === now.getDate()) {
    return `Today at ${timeStr}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.getDate() === yesterday.getDate() && date.getMonth() === yesterday.getMonth()) {
    return `Yesterday at ${timeStr}`;
  }
  if (diffDays < 7) {
    const dayName = date.toLocaleDateString([], { weekday: 'long' });
    return `${dayName} at ${timeStr}`;
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

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

  const installedGuids = installedMods.map((m) => m.id);

  // SPT versions sorted strictly in order of most recent releases
  const sortedSptVersions = useMemo(() => sortSptVersionsByMostRecent(sptVersions), [sptVersions]);

  // Active target SPT version: if user selected a specific version from dropdown, use that; otherwise use their installed sptVersion
  const activeTargetSptVersion = selectedSptVersion !== 'All' ? selectedSptVersion : sptVersion;

  // Cache for mod versions to dynamically display and install the matching release
  const [modVersionsCache, setModVersionsCache] = useState<Record<number, ModVersion[]>>({});

  // Scroll container ref for smooth scroll-to-top on page change
  const catalogScrollRef = useRef<HTMLDivElement>(null);

  // Smoothly scroll to the top of the catalog when changing pages
  useEffect(() => {
    if (catalogScrollRef.current) {
      catalogScrollRef.current.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    }
    if (typeof window !== 'undefined') {
      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    }
  }, [currentPage]);

  // Background fetch versions for visible mods to resolve their exact matching version
  useEffect(() => {
    const modsToFetch = queryResult.mods.filter((m) => m.id && !modVersionsCache[m.id]);
    if (modsToFetch.length === 0) return;

    let isMounted = true;
    const fetchPromises = modsToFetch.slice(0, 20).map(async (m) => {
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

  // Debounced search query
  useEffect(() => {
    const handler = setTimeout(() => {
      loadMods();
    }, 280);
    return () => clearTimeout(handler);
  }, [
    searchText,
    selectedCategory,
    selectedSptVersion,
    selectedSort,
    perPage,
    currentPage,
    hideFeatured,
    hideContainsAds,
    hideContainsAi,
    hideInstalled,
    fikaOnly,
  ]);

  const loadMods = async () => {
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
      });

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
      console.error(err);
      onShowToast('Catalog Query Error', 'Failed to retrieve mods from catalog.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleFavorite = (mod: Mod, e?: React.MouseEvent) => {
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
      mods: prev.mods.map((m) =>
        m.id === mod.id ? { ...m, favorite: isNowFavorite } : m
      ),
    }));

    if (isNowFavorite) {
      onShowToast(
        'Added to Favorites',
        `"${mod.name}" was added to your favorites.`,
        'success'
      );
    } else {
      onShowToast(
        'Removed from Favorites',
        `"${mod.name}" was removed from your favorites.`,
        'info'
      );
    }
  };

  const handleClearFilters = () => {
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
  };

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

      {/* Filter panel */}
      <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-3 shrink-0 mb-2 shadow-sm space-y-2.5">
        {/* Row 1: Search · Clear · Refresh · Counter · Featured / Ads Toggles */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="relative w-[320px]">
            <Search className="w-4 h-4 text-[#6B7480] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search mods or type @Author..."
              className="w-full bg-[#0E1013] border border-[#23272E] rounded-md pl-8 pr-3 py-1.5 text-[13px] text-[#E8EAEE] placeholder-[#6B7480] focus:outline-none focus:border-[#EA580C]"
            />
          </div>

          <button
            onClick={handleClearFilters}
            className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] text-[13px] px-3.5 py-1.5 rounded-md border border-[#2A2F38] transition-colors cursor-pointer"
            title="Reset all filters and sorting parameters back to their default states"
            type="button"
          >
            Clear
          </button>

          <button
            onClick={() => loadMods()}
            className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] text-[13px] px-3.5 py-1.5 rounded-md border border-[#2A2F38] flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Re-run the current catalog query against the sp-mod.com API"
            type="button"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <div className="text-[12.5px] text-[#9AA3AF] px-1">
            Showing {queryResult.mods.length} of {queryResult.total} mods
            {queryResult.isOfflineFallback && (
              <span className="ml-2 text-[11px] text-[#F59E0B] bg-[#3A2A10] px-1.5 py-0.5 rounded border border-[#F59E0B]/30">
                Offline / Fixture Cache
              </span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2 text-[12px] text-[#9AA3AF]">
            <label className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[12px] cursor-pointer transition-all select-none ${
              hideFeatured
                ? 'bg-[#EA580C]/10 border-[#EA580C]/40 text-[#EA580C]'
                : 'bg-[#0E1013] border-[#23272E] text-[#9AA3AF] hover:text-[#E8EAEE] hover:border-[#2E343E]'
            }`}>
              <input
                type="checkbox"
                checked={hideFeatured}
                onChange={(e) => setHideFeatured(e.target.checked)}
                className="w-3.5 h-3.5 rounded border border-[#2E343E] bg-[#0E1013] accent-[#EA580C] cursor-pointer"
              />
              <span className="font-medium">Hide Featured</span>
            </label>
            <label className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[12px] cursor-pointer transition-all select-none ${
              hideContainsAds
                ? 'bg-[#EA580C]/10 border-[#EA580C]/40 text-[#EA580C]'
                : 'bg-[#0E1013] border-[#23272E] text-[#9AA3AF] hover:text-[#E8EAEE] hover:border-[#2E343E]'
            }`}>
              <input
                type="checkbox"
                checked={hideContainsAds}
                onChange={(e) => setHideContainsAds(e.target.checked)}
                className="w-3.5 h-3.5 rounded border border-[#2E343E] bg-[#0E1013] accent-[#EA580C] cursor-pointer"
              />
              <span className="font-medium">Hide Contains Ads</span>
            </label>
          </div>
        </div>

        {/* Row 2: Dropdowns · Toggles · Pagination · Install from file */}
        <div className="flex items-center gap-2.5 flex-wrap text-[12.5px]">
          {/* SPT Version Filter (Ordered by Most Recent Release) */}
          <select
            value={selectedSptVersion}
            onChange={(e) => {
              setSelectedSptVersion(e.target.value);
              setCurrentPage(1);
            }}
            className="bg-[#0E1013] border border-[#23272E] rounded-md px-2.5 py-1.5 text-[#E8EAEE] focus:outline-none focus:border-[#EA580C] cursor-pointer"
            title="Filter mods by SPT release (ordered from most recent to oldest)"
          >
            <option value="All">All SPT Versions</option>
            {sortedSptVersions.map((v) => {
              const count = v.modCount ?? (v as any).mods_count ?? (v as any).count;
              return (
                <option key={v.id || v.version} value={v.version}>
                  {count && count > 0 ? `SPT ${v.version} (${count} mods)` : `SPT ${v.version}`}
                </option>
              );
            })}
          </select>

          {/* Category Filter */}
          <select
            value={selectedCategory || ''}
            onChange={(e) => {
              setSelectedCategory(e.target.value ? Number(e.target.value) : null);
              setCurrentPage(1);
            }}
            className="bg-[#0E1013] border border-[#23272E] rounded-md px-2.5 py-1.5 text-[#E8EAEE] focus:outline-none focus:border-[#EA580C] cursor-pointer"
            title="Category filter live from GET /mod-categories"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>

          {/* Sort Filter */}
          <select
            value={selectedSort}
            onChange={(e) => {
              setSelectedSort(e.target.value as CatalogSortOption);
              setCurrentPage(1);
            }}
            className="bg-[#0E1013] border border-[#23272E] rounded-md px-2.5 py-1.5 text-[#E8EAEE] focus:outline-none focus:border-[#EA580C] cursor-pointer"
            title="Changes the order of the returned catalog dataset"
          >
            <option value="downloads">Most Downloaded</option>
            <option value="recent">Most Recent</option>
            <option value="name_az">Alphabetical (A→Z)</option>
            <option value="name_za">Alphabetical (Z→A)</option>
            <option value="endorsements">Most Endorsed</option>
            <option value="favourites">Most Favourited</option>
          </select>

          {/* Per Page */}
          <select
            value={perPage}
            onChange={(e) => {
              setPerPage(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="bg-[#0E1013] border border-[#23272E] rounded-md px-2 py-1.5 text-[#E8EAEE] focus:outline-none focus:border-[#EA580C] cursor-pointer"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>

          {/* Additional checkbox toggles */}
          <label className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[12px] cursor-pointer transition-all select-none ${
            hideContainsAi
              ? 'bg-[#EA580C]/10 border-[#EA580C]/40 text-[#EA580C]'
              : 'bg-[#0E1013] border-[#23272E] text-[#9AA3AF] hover:text-[#E8EAEE] hover:border-[#2E343E]'
          }`}>
            <input
              type="checkbox"
              checked={hideContainsAi}
              onChange={(e) => setHideContainsAi(e.target.checked)}
              className="w-3.5 h-3.5 rounded border border-[#2E343E] bg-[#0E1013] accent-[#EA580C] cursor-pointer"
            />
            <span className="font-medium">Hide Contains AI</span>
          </label>

          <label className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[12px] cursor-pointer transition-all select-none ${
            hideInstalled
              ? 'bg-[#EA580C]/10 border-[#EA580C]/40 text-[#EA580C]'
              : 'bg-[#0E1013] border-[#23272E] text-[#9AA3AF] hover:text-[#E8EAEE] hover:border-[#2E343E]'
          }`}>
            <input
              type="checkbox"
              checked={hideInstalled}
              onChange={(e) => setHideInstalled(e.target.checked)}
              className="w-3.5 h-3.5 rounded border border-[#2E343E] bg-[#0E1013] accent-[#EA580C] cursor-pointer"
            />
            <span className="font-medium">Hide Installed</span>
          </label>

          <label className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[12px] cursor-pointer transition-all select-none ${
            fikaOnly
              ? 'bg-[#EA580C]/10 border-[#EA580C]/40 text-[#EA580C]'
              : 'bg-[#0E1013] border-[#23272E] text-[#9AA3AF] hover:text-[#E8EAEE] hover:border-[#2E343E]'
          }`}>
            <input
              type="checkbox"
              checked={fikaOnly}
              onChange={(e) => setFikaOnly(e.target.checked)}
              className="w-3.5 h-3.5 rounded border border-[#2E343E] bg-[#0E1013] accent-[#EA580C] cursor-pointer"
            />
            <span className="font-medium">Fika Comp Only</span>
          </label>

          <label className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[12px] cursor-pointer transition-all select-none ${
            favoritesOnly
              ? 'bg-[#EF4444]/10 border-[#EF4444]/40 text-[#EF4444]'
              : 'bg-[#0E1013] border-[#23272E] text-[#9AA3AF] hover:text-[#E8EAEE] hover:border-[#2E343E]'
          }`}>
            <input
              type="checkbox"
              checked={favoritesOnly}
              onChange={(e) => setFavoritesOnly(e.target.checked)}
              className="w-3.5 h-3.5 rounded border border-[#2E343E] bg-[#0E1013] accent-[#EF4444] cursor-pointer"
            />
            <span className="flex items-center gap-1.5 font-medium">
              <Heart
                className={`w-3.5 h-3.5 ${
                  favoritesOnly || favoriteIds.size > 0 ? 'text-[#EF4444] fill-[#EF4444]' : 'text-[#9AA3AF]'
                }`}
              />
              <span>Favorites ({favoriteIds.size})</span>
            </span>
          </label>

          <label
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[12px] cursor-pointer transition-all select-none ${
              showRecommendedMods
                ? 'bg-[#EA580C]/10 border-[#EA580C]/40 text-[#EA580C]'
                : 'bg-[#0E1013] border-[#23272E] text-[#9AA3AF] hover:text-[#E8EAEE] hover:border-[#2E343E]'
            }`}
            title="Toggle the Recommended For You section above the mod catalog"
          >
            <input
              type="checkbox"
              checked={showRecommendedMods}
              onChange={(e) => onToggleShowRecommended?.(e.target.checked)}
              className="w-3.5 h-3.5 rounded border border-[#2E343E] bg-[#0E1013] accent-[#EA580C] cursor-pointer"
            />
            <span className="font-medium">Show Recommendations</span>
          </label>

          {/* Pagination controls */}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="bg-[#20252D] hover:bg-[#2A2F38] disabled:opacity-40 text-[#E8EAEE] px-2.5 py-1 rounded border border-[#2A2F38] flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
              type="button"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Prev</span>
            </button>

            <span className="text-[#9AA3AF] px-1 font-mono">
              Page {currentPage} of {queryResult.lastPage}
            </span>

            <button
              onClick={() => setCurrentPage((p) => Math.min(queryResult.lastPage, p + 1))}
              disabled={currentPage >= queryResult.lastPage}
              className="bg-[#20252D] hover:bg-[#2A2F38] disabled:opacity-40 text-[#E8EAEE] px-2.5 py-1 rounded border border-[#2A2F38] flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
              type="button"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>

            {/* Install from file button */}
            <label className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] text-[12.5px] px-3 py-1 rounded border border-[#2A2F38] flex items-center gap-1.5 transition-colors cursor-pointer ml-2">
              <Upload className="w-3.5 h-3.5 text-[#EA580C]" />
              <span>📂 Install from file...</span>
              <input
                type="file"
                accept=".zip,.7z,.rar"
                onChange={handleFileInput}
                className="hidden"
              />
            </label>
          </div>
        </div>
      </div>

      {/* Catalog Mod Grid (Virtualizing 3-column compact 220px cards) */}
      <div ref={catalogScrollRef} className="flex-1 overflow-y-auto pr-1">
        {/* Recommended for You Section based on installed mod categories */}
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
        ) : (favoritesOnly ? queryResult.mods.filter((m) => favoriteIds.has(m.id)) : queryResult.mods).length === 0 ? (
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
            {(favoritesOnly ? queryResult.mods.filter((m) => favoriteIds.has(m.id)) : queryResult.mods).map((mod) => {
              const isInstalled = mod.guid ? installedGuids.includes(mod.guid) : false;
              const authorName = mod.owner?.name || 'Unknown';
              const isFavorite = Boolean(mod.favorite ?? favoriteIds.has(mod.id));
              const formattedDate = formatForgeDate(mod.published_at);

              // Dynamically resolve mod version tailored to selected SPT release
              const versions = modVersionsCache[mod.id] || mod.versions || [];
              const matchingRelease = findMatchingModVersion(versions, activeTargetSptVersion);
              const displayVersion = matchingRelease?.version
                ? `v${matchingRelease.version.replace(/^v/i, '')}`
                : (mod.versions?.[0]?.version ? `v${mod.versions[0].version.replace(/^v/i, '')}` : '');

              return (
                <div
                  key={mod.id}
                  className="h-[210px] bg-[#181B20] border border-[#23272E] hover:border-[#EA580C] rounded-lg p-3 transition-colors flex gap-3 relative group"
                >
                  {/* Top-Right Favorite Heart Toggle Button */}
                  <button
                    type="button"
                    onClick={(e) => handleToggleFavorite(mod, e)}
                    className={`absolute top-2.5 right-2.5 z-10 p-1.5 rounded-full transition-all cursor-pointer ${
                      isFavorite
                        ? 'bg-[#2A1015] border border-[#EF4444] text-[#EF4444] shadow-[0_0_8px_rgba(239,68,68,0.35)] scale-105'
                        : 'bg-[#20252D]/85 hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-[#EF4444] border border-[#2A2F38] hover:border-[#EF4444]/40 opacity-80 group-hover:opacity-100'
                    }`}
                    title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    aria-label={isFavorite ? `Remove ${mod.name} from favorites` : `Add ${mod.name} to favorites`}
                  >
                    <Heart
                      className={`w-3.5 h-3.5 transition-transform active:scale-125 ${
                        isFavorite ? 'fill-[#EF4444] text-[#EF4444]' : ''
                      }`}
                    />
                  </button>

                  {/* Thumbnail column (135x135) with Forge hotlink proxy image */}
                  <ModThumbnail mod={mod} />

                  {/* Content area right */}
                  <div className="flex-1 flex flex-col justify-between overflow-hidden min-w-0 pr-6">
                    <div>
                      {/* Title + Version */}
                      <div className="flex items-baseline gap-2 truncate pr-2">
                        <h3
                          className="text-[14px] font-bold text-[#E8EAEE] tracking-tight truncate"
                          title={mod.name}
                        >
                          {mod.name}
                        </h3>
                        {displayVersion && (
                          <span className="text-[11.5px] font-normal text-[#9AA3AF] shrink-0 font-mono">
                            {displayVersion}
                          </span>
                        )}
                      </div>

                      {/* Author */}
                      <p className="text-[11.5px] text-[#9AA3AF] mt-0.5 truncate">
                        Created by <span className="text-[#C2C9D6] font-medium">{authorName}</span>
                      </p>

                      {/* Badges row */}
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <span
                          className={`${getSptBadgeClass(activeTargetSptVersion)} text-[10px] font-bold px-2 py-0.5 rounded shadow-sm`}
                          title={`Engineered / compatible with SPT ${activeTargetSptVersion}`}
                        >
                          SPT {activeTargetSptVersion}
                        </span>
                        {mod.fika_compatibility && (
                          <span className="bg-[#0E2A18] text-[#4ADE80] border border-[#16A34A]/40 text-[10px] font-semibold px-2 py-0.5 rounded">
                            Fika
                          </span>
                        )}
                        {mod.category?.title && (
                          <span className="bg-[#20252D] border border-[#23272E] text-[#9AA3AF] text-[10px] px-2 py-0.5 rounded">
                            {mod.category.title}
                          </span>
                        )}
                        {mod.featured && (
                          <span className="bg-[#EA580C]/20 border border-[#EA580C]/50 text-[#EA580C] text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5">
                            <Sparkles className="w-2.5 h-2.5" /> Featured
                          </span>
                        )}
                      </div>

                      {/* 2-line teaser description with word ellipsis */}
                      <p
                        className="text-[11.5px] text-[#9AA3AF] mt-1.5 line-clamp-2 leading-[16px]"
                        title={mod.teaser || ''}
                      >
                        {mod.teaser || 'No description provided.'}
                      </p>
                    </div>

                    {/* Bottom metadata row matching Forge website */}
                    <div className="flex items-center justify-between pt-1.5 border-t border-[#23272E]/60 gap-1.5">
                      <div className="flex items-center gap-2 text-[11px] text-[#9AA3AF] truncate">
                        {formattedDate && (
                          <span className="flex items-center gap-1 text-[#848E9C]" title={mod.published_at || ''}>
                            <Calendar className="w-3 h-3 text-[#6B7480]" />
                            <span className="truncate">{formattedDate}</span>
                          </span>
                        )}
                        {mod.favourites_count > 0 && (
                          <span className="flex items-center gap-0.5 text-[#F87171]" title={`${mod.favourites_count} favorites`}>
                            <span>❤️</span>
                            <span className="font-mono text-[10.5px]">{mod.favourites_count}</span>
                          </span>
                        )}
                        {mod.endorsements_count > 0 && (
                          <span className="flex items-center gap-0.5 text-[#FBBF24]" title={`${mod.endorsements_count} endorsements`}>
                            <ThumbsUp className="w-3 h-3 text-[#FBBF24]" />
                            <span className="font-mono text-[10.5px]">{mod.endorsements_count}</span>
                          </span>
                        )}
                        <span className="flex items-center gap-0.5 text-[#9AA3AF]" title={`${mod.downloads.toLocaleString()} downloads`}>
                          <Download className="w-3 h-3 text-[#6B7480]" />
                          <span className="font-mono text-[10.5px]">{mod.downloads.toLocaleString()}</span>
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => onOpenVersions(mod)}
                          className="h-6 px-2 bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] rounded text-[10.5px] flex items-center gap-1 transition-colors cursor-pointer"
                          title="Pick a specific release"
                          type="button"
                        >
                          <History className="w-3 h-3 text-[#9AA3AF]" />
                          <span>Versions</span>
                        </button>

                        {mod.detail_url && (
                          <a
                            href={mod.detail_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="h-6 px-1.5 bg-[#20252D] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-[#E8EAEE] rounded text-[10.5px] flex items-center transition-colors"
                            title="Open on sp-mod.com"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}

                        <button
                          onClick={() => {
                            const ver = matchingRelease?.version || (displayVersion ? displayVersion.replace(/^v/i, '') : undefined);
                            onInstallMod(mod, ver, activeTargetSptVersion);
                          }}
                          className="h-6 px-2.5 bg-[#16A34A] hover:bg-[#22C55E] text-white rounded text-[10.5px] font-semibold flex items-center gap-1 transition-colors shadow-sm cursor-pointer"
                          title={`Download and install ${mod.name} ${displayVersion} for SPT ${activeTargetSptVersion}`}
                          type="button"
                        >
                          <Download className="w-3 h-3" />
                          <span>{isInstalled ? 'Reinstall' : 'Install'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom Pagination Bar */}
        {queryResult.mods.length > 0 && (queryResult.lastPage || 1) > 1 && (
          <div className="flex items-center justify-between py-3 px-3 border-t border-[#23272E] my-3 bg-[#181B20]/40 rounded-lg">
            <span className="text-xs text-[#9AA3AF] font-mono">
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
              <span className="text-[#E8EAEE] font-mono text-xs px-2 font-medium">
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
