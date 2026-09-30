import React, { useState, useEffect } from 'react';
import { Search, RotateCw, ChevronLeft, ChevronRight, Upload, History, ExternalLink, Download, Check, Sparkles } from 'lucide-react';
import { Mod, ModCategory, SptVersionInfo, CatalogSortOption, InstalledMod } from '../types';
import { apiService, CatalogQueryResult } from '../services/apiService';

interface BrowseModsTabProps {
  sptVersion: string;
  categories: ModCategory[];
  sptVersions: SptVersionInfo[];
  installedMods: InstalledMod[];
  onInstallMod: (mod: Mod, version?: string) => void;
  onOpenVersions: (mod: Mod) => void;
  onInstallFromFile: (file: File) => void;
  onShowToast: (title: string, message: string, type: 'success' | 'info' | 'warning' | 'error') => void;
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
}) => {
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [selectedSptVersion, setSelectedSptVersion] = useState<string>('All');
  const [selectedSort, setSelectedSort] = useState<CatalogSortOption>('downloads');
  const [perPage, setPerPage] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const [hideFeatured, setHideFeatured] = useState<boolean>(false);
  const [hideContainsAds, setHideContainsAds] = useState<boolean>(false);
  const [hideContainsAi, setHideContainsAi] = useState<boolean>(false);
  const [hideInstalled, setHideInstalled] = useState<boolean>(false);
  const [fikaOnly, setFikaOnly] = useState<boolean>(false);

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
      setQueryResult(res);
    } catch (err) {
      console.error(err);
      onShowToast('Catalog Query Error', 'Failed to retrieve mods from catalog.', 'error');
    } finally {
      setLoading(false);
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

          <div className="ml-auto flex items-center gap-4 text-[12.5px] text-[#9AA3AF]">
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-[#E8EAEE]">
              <input
                type="checkbox"
                checked={hideFeatured}
                onChange={(e) => setHideFeatured(e.target.checked)}
                className="accent-[#EA580C]"
              />
              <span>Hide Featured</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-[#E8EAEE]">
              <input
                type="checkbox"
                checked={hideContainsAds}
                onChange={(e) => setHideContainsAds(e.target.checked)}
                className="accent-[#EA580C]"
              />
              <span>Hide Contains Ads</span>
            </label>
          </div>
        </div>

        {/* Row 2: Dropdowns · Toggles · Pagination · Install from file */}
        <div className="flex items-center gap-2.5 flex-wrap text-[12.5px]">
          {/* SPT Version Filter */}
          <select
            value={selectedSptVersion}
            onChange={(e) => {
              setSelectedSptVersion(e.target.value);
              setCurrentPage(1);
            }}
            className="bg-[#0E1013] border border-[#23272E] rounded-md px-2.5 py-1.5 text-[#E8EAEE] focus:outline-none focus:border-[#EA580C] cursor-pointer"
            title="Only show mods compatible with the selected SPT release"
          >
            <option value="All">All SPT Versions</option>
            {sptVersions.map((v) => (
              <option key={v.id} value={v.version}>
                SPT {v.version} ({v.modCount} mods)
              </option>
            ))}
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
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-[#E8EAEE] text-[#9AA3AF]">
            <input
              type="checkbox"
              checked={hideContainsAi}
              onChange={(e) => setHideContainsAi(e.target.checked)}
              className="accent-[#EA580C]"
            />
            <span>Hide Contains AI</span>
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer hover:text-[#E8EAEE] text-[#9AA3AF]">
            <input
              type="checkbox"
              checked={hideInstalled}
              onChange={(e) => setHideInstalled(e.target.checked)}
              className="accent-[#EA580C]"
            />
            <span>Hide Installed</span>
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer hover:text-[#E8EAEE] text-[#9AA3AF]">
            <input
              type="checkbox"
              checked={fikaOnly}
              onChange={(e) => setFikaOnly(e.target.checked)}
              className="accent-[#EA580C]"
            />
            <span>Fika Comp Only</span>
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
      <div className="flex-1 overflow-y-auto pr-1">
        {loading && queryResult.mods.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-[#9AA3AF]">
            <div className="w-8 h-8 border-2 border-[#EA580C] border-t-transparent rounded-full animate-spin mb-3"></div>
            <p>Loading mods catalog...</p>
          </div>
        ) : queryResult.mods.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-[#9AA3AF]">
            <span className="text-4xl opacity-50 mb-2">🐉</span>
            <p className="text-base font-medium text-[#E8EAEE]">No mods found matching your query</p>
            <p className="text-sm">Try broadening your search term or resetting active filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pb-6">
            {queryResult.mods.map((mod) => {
              const isInstalled = mod.guid ? installedGuids.includes(mod.guid) : false;
              const hasThumbnail = Boolean(mod.thumbnail);
              const authorName = mod.owner?.name || 'Unknown';
              const packageId = mod.guid || mod.slug || `id-${mod.id}`;

              return (
                <div
                  key={mod.id}
                  className="h-[220px] bg-[#181B20] border border-[#23272E] hover:border-[#EA580C] rounded-lg p-3 transition-colors flex gap-3 relative group"
                >
                  {/* Thumbnail column (135x135) with overlays */}
                  <div className="w-[135px] h-[135px] shrink-0 relative bg-[#20252D] rounded-md overflow-hidden self-center border border-[#23272E]">
                    {hasThumbnail ? (
                      <img
                        src={mod.thumbnail}
                        alt={mod.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : null}

                    {/* Placeholder fallback initial */}
                    <div className="absolute inset-0 flex items-center justify-center text-4xl font-bold text-[#3A4150] -z-10 select-none">
                      {mod.name.charAt(0).toUpperCase()}
                    </div>

                    {/* Top-left: green SPT version badge */}
                    <div className="absolute top-1 left-1 bg-[#16A34A] rounded px-1.5 py-0.5 text-[9.5px] font-semibold text-white tracking-tight shadow">
                      SPT 4.x
                    </div>

                    {/* Bottom-left: Fika Compatible overlay */}
                    {mod.fika_compatibility && (
                      <div className="absolute bottom-1 left-1 bg-[#0E2A18] border border-[#16A34A] rounded px-1.5 py-0.5 text-[9.5px] font-semibold text-[#22C55E] tracking-tight shadow">
                        Fika Compatible
                      </div>
                    )}
                  </div>

                  {/* Content area right */}
                  <div className="flex-1 flex flex-col justify-between overflow-hidden min-w-0">
                    <div>
                      {/* Title */}
                      <h3
                        className="text-[14px] font-bold text-[#E8EAEE] truncate tracking-tight"
                        title={mod.name}
                      >
                        {mod.name}
                      </h3>

                      {/* Package ID in Consolas */}
                      <p
                        className="font-mono text-[10.5px] text-[#6B7480] truncate mt-0.5"
                        title={packageId}
                      >
                        {packageId}
                      </p>

                      {/* Tag pills: Orange Author pill + Category pill */}
                      <div className="flex items-center gap-1.5 mt-1.5 overflow-hidden flex-wrap max-h-6">
                        <span
                          className="bg-[#3A2415] border border-[#EA580C] text-[#F97316] text-[11px] font-semibold px-2 py-0.5 rounded-full truncate max-w-[120px]"
                          title={authorName}
                        >
                          {authorName}
                        </span>

                        {mod.category?.title && (
                          <span className="bg-[#20252D] border border-[#23272E] text-[#9AA3AF] text-[11px] px-2 py-0.5 rounded-full truncate">
                            {mod.category.title}
                          </span>
                        )}

                        {mod.featured && (
                          <span className="bg-[#EA580C]/20 border border-[#EA580C]/50 text-[#EA580C] text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                            <Sparkles className="w-2.5 h-2.5" /> Featured
                          </span>
                        )}
                      </div>

                      {/* Stats row */}
                      <div className="text-[11.5px] text-[#9AA3AF] mt-1.5 truncate">
                        <span>{mod.downloads.toLocaleString()} downloads</span>
                        <span className="mx-1.5">·</span>
                        <span>⭐ {mod.favourites_count}</span>
                        {mod.endorsements_count > 0 && (
                          <>
                            <span className="mx-1.5">·</span>
                            <span>👍 {mod.endorsements_count}</span>
                          </>
                        )}
                      </div>

                      {/* 2-line teaser description with word ellipsis */}
                      <p
                        className="text-[11px] text-[#6B7480] mt-1 line-clamp-2 leading-[14px]"
                        title={mod.teaser || ''}
                      >
                        {mod.teaser || 'No description provided.'}
                      </p>
                    </div>

                    {/* Action row at bottom */}
                    <div className="flex items-center justify-between pt-1 border-t border-[#23272E]/50">
                      {isInstalled ? (
                        <div className="flex items-center gap-1 text-[11px] text-[#16A34A] font-semibold">
                          <Check className="w-3.5 h-3.5" />
                          <span>Installed</span>
                        </div>
                      ) : (
                        <div className="text-[11px] text-[#6B7480]">Available</div>
                      )}

                      <div className="flex items-center gap-1.5">
                        {/* Versions button (task 6.2) */}
                        <button
                          onClick={() => onOpenVersions(mod)}
                          className="h-7 px-2 bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] rounded text-xs flex items-center justify-center transition-colors cursor-pointer"
                          title="Pick a specific release — full version list with changelogs"
                          type="button"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>

                        {/* Mod page link */}
                        {mod.detail_url && (
                          <a
                            href={mod.detail_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="h-7 px-2.5 bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] rounded text-xs flex items-center gap-1 transition-colors"
                            title="Open the mod page on sp-mod.com"
                          >
                            <span>Mod Page</span>
                            <ExternalLink className="w-3 h-3 text-[#9AA3AF]" />
                          </a>
                        )}

                        {/* Install button */}
                        <button
                          onClick={() => onInstallMod(mod)}
                          className="h-7 px-3 bg-[#16A34A] hover:bg-[#22C55E] text-white rounded text-xs font-semibold flex items-center gap-1 transition-colors shadow-sm cursor-pointer"
                          title="Download the latest compatible release and extract it into your SPT folder"
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
      </div>
    </div>
  );
};
