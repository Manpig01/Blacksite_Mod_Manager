import React, { useRef } from 'react';
import { Search, RotateCw, ChevronLeft, ChevronRight, Upload, Heart, X } from 'lucide-react';
import { ModCategory, SptVersionInfo, CatalogSortOption } from '../../types';

interface BrowseFilterBarProps {
  searchText: string;
  onSearchChange: (val: string) => void;
  selectedSptVersion: string;
  onSptVersionChange: (val: string) => void;
  sortedSptVersions: SptVersionInfo[];
  selectedCategory: number | null;
  onCategoryChange: (val: number | null) => void;
  categories: ModCategory[];
  selectedSort: CatalogSortOption;
  onSortChange: (val: CatalogSortOption) => void;
  perPage: number;
  onPerPageChange: (val: number) => void;
  hideFeatured: boolean;
  onToggleHideFeatured: (val: boolean) => void;
  hideContainsAds: boolean;
  onToggleHideContainsAds: (val: boolean) => void;
  hideContainsAi: boolean;
  onToggleHideContainsAi: (val: boolean) => void;
  hideInstalled: boolean;
  onToggleHideInstalled: (val: boolean) => void;
  fikaOnly: boolean;
  onToggleFikaOnly: (val: boolean) => void;
  favoritesOnly: boolean;
  onToggleFavoritesOnly: (val: boolean) => void;
  favoritesCount: number;
  showRecommendedMods: boolean;
  onToggleShowRecommended?: (show: boolean) => void;
  currentPage: number;
  lastPage: number;
  totalMods: number;
  visibleModsCount: number;
  isOfflineFallback: boolean;
  loading: boolean;
  onPrevPage: () => void;
  onNextPage: () => void;
  onClearFilters: () => void;
  onRefresh: () => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const BrowseFilterBar: React.FC<BrowseFilterBarProps> = ({
  searchText,
  onSearchChange,
  selectedSptVersion,
  onSptVersionChange,
  sortedSptVersions,
  selectedCategory,
  onCategoryChange,
  categories,
  selectedSort,
  onSortChange,
  perPage,
  onPerPageChange,
  hideFeatured,
  onToggleHideFeatured,
  hideContainsAds,
  onToggleHideContainsAds,
  hideContainsAi,
  onToggleHideContainsAi,
  hideInstalled,
  onToggleHideInstalled,
  fikaOnly,
  onToggleFikaOnly,
  favoritesOnly,
  onToggleFavoritesOnly,
  favoritesCount,
  showRecommendedMods,
  onToggleShowRecommended,
  currentPage,
  lastPage,
  totalMods,
  visibleModsCount,
  isOfflineFallback,
  loading,
  onPrevPage,
  onNextPage,
  onClearFilters,
  onRefresh,
  onFileInput,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-3 shrink-0 mb-2 shadow-sm space-y-2.5">
      {/* Row 1: Search · Clear · Refresh · Counter · Featured / Ads Toggles */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="relative w-[320px]">
          <Search className="w-4 h-4 text-[#6B7480] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={searchInputRef}
            data-global-search="true"
            type="text"
            value={searchText}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search mods or type @Author..."
            className="w-full bg-[#0E1013] border border-[#23272E] rounded-md pl-8 pr-14 py-1.5 text-[13px] text-[#E8EAEE] placeholder-[#6B7480] focus:outline-none focus:border-[#EA580C]"
          />
          {searchText ? (
            <button
              type="button"
              onClick={() => {
                onSearchChange('');
                searchInputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-[#9AA3AF] hover:text-[#E8EAEE] cursor-pointer"
              title="Clear search (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <kbd
              onClick={() => searchInputRef.current?.focus()}
              className="hidden sm:inline-block absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-mono text-[#6B7480] bg-[#181B20] border border-[#2A2F38] rounded cursor-pointer hover:border-[#EA580C]"
              title="Press Ctrl+K or '/' to focus search"
            >
              Ctrl K
            </kbd>
          )}
        </div>

        <button
          onClick={onClearFilters}
          className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] text-[13px] px-3.5 py-1.5 rounded-md border border-[#2A2F38] transition-colors cursor-pointer"
          title="Reset all filters and sorting parameters back to their default states"
          type="button"
        >
          Clear
        </button>

        <button
          onClick={onRefresh}
          className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] text-[13px] px-3.5 py-1.5 rounded-md border border-[#2A2F38] flex items-center gap-1.5 transition-colors cursor-pointer"
          title="Force refresh current catalog query against sp-mod.com API"
          type="button"
        >
          <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>

        <div className="text-[12.5px] text-[#9AA3AF] px-1 tabular-nums">
          Showing {visibleModsCount} of {totalMods.toLocaleString()} mods
          {isOfflineFallback && (
            <span className="ml-2 text-[11px] text-[#F59E0B] bg-[#3A2A10] px-1.5 py-0.5 rounded border border-[#F59E0B]/30">
              Offline / Fixture Cache
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2 text-[12px] text-[#9AA3AF]">
          <label
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[12px] cursor-pointer transition-all select-none ${
              hideFeatured
                ? 'bg-[#EA580C]/10 border-[#EA580C]/40 text-[#EA580C]'
                : 'bg-[#0E1013] border-[#23272E] text-[#9AA3AF] hover:text-[#E8EAEE] hover:border-[#2E343E]'
            }`}
          >
            <input
              type="checkbox"
              checked={hideFeatured}
              onChange={(e) => onToggleHideFeatured(e.target.checked)}
              className="w-3.5 h-3.5 rounded border border-[#2E343E] bg-[#0E1013] accent-[#EA580C] cursor-pointer"
            />
            <span className="font-medium">Hide Featured</span>
          </label>
          <label
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[12px] cursor-pointer transition-all select-none ${
              hideContainsAds
                ? 'bg-[#EA580C]/10 border-[#EA580C]/40 text-[#EA580C]'
                : 'bg-[#0E1013] border-[#23272E] text-[#9AA3AF] hover:text-[#E8EAEE] hover:border-[#2E343E]'
            }`}
          >
            <input
              type="checkbox"
              checked={hideContainsAds}
              onChange={(e) => onToggleHideContainsAds(e.target.checked)}
              className="w-3.5 h-3.5 rounded border border-[#2E343E] bg-[#0E1013] accent-[#EA580C] cursor-pointer"
            />
            <span className="font-medium">Hide Contains Ads</span>
          </label>
        </div>
      </div>

      {/* Row 2: Dropdowns · Toggles · Pagination · Install from file */}
      <div className="flex items-center gap-2.5 flex-wrap text-[12.5px]">
        <select
          value={selectedSptVersion}
          onChange={(e) => onSptVersionChange(e.target.value)}
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

        <select
          value={selectedCategory || ''}
          onChange={(e) => onCategoryChange(e.target.value ? Number(e.target.value) : null)}
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

        <select
          value={selectedSort}
          onChange={(e) => onSortChange(e.target.value as CatalogSortOption)}
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

        <select
          value={perPage}
          onChange={(e) => onPerPageChange(Number(e.target.value))}
          className="bg-[#0E1013] border border-[#23272E] rounded-md px-2 py-1.5 text-[#E8EAEE] focus:outline-none focus:border-[#EA580C] cursor-pointer"
        >
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
        </select>

        <label
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[12px] cursor-pointer transition-all select-none ${
            hideContainsAi
              ? 'bg-[#EA580C]/10 border-[#EA580C]/40 text-[#EA580C]'
              : 'bg-[#0E1013] border-[#23272E] text-[#9AA3AF] hover:text-[#E8EAEE] hover:border-[#2E343E]'
          }`}
        >
          <input
            type="checkbox"
            checked={hideContainsAi}
            onChange={(e) => onToggleHideContainsAi(e.target.checked)}
            className="w-3.5 h-3.5 rounded border border-[#2E343E] bg-[#0E1013] accent-[#EA580C] cursor-pointer"
          />
          <span className="font-medium">Hide Contains AI</span>
        </label>

        <label
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[12px] cursor-pointer transition-all select-none ${
            hideInstalled
              ? 'bg-[#EA580C]/10 border-[#EA580C]/40 text-[#EA580C]'
              : 'bg-[#0E1013] border-[#23272E] text-[#9AA3AF] hover:text-[#E8EAEE] hover:border-[#2E343E]'
          }`}
        >
          <input
            type="checkbox"
            checked={hideInstalled}
            onChange={(e) => onToggleHideInstalled(e.target.checked)}
            className="w-3.5 h-3.5 rounded border border-[#2E343E] bg-[#0E1013] accent-[#EA580C] cursor-pointer"
          />
          <span className="font-medium">Hide Installed</span>
        </label>

        <label
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[12px] cursor-pointer transition-all select-none ${
            fikaOnly
              ? 'bg-[#EA580C]/10 border-[#EA580C]/40 text-[#EA580C]'
              : 'bg-[#0E1013] border-[#23272E] text-[#9AA3AF] hover:text-[#E8EAEE] hover:border-[#2E343E]'
          }`}
        >
          <input
            type="checkbox"
            checked={fikaOnly}
            onChange={(e) => onToggleFikaOnly(e.target.checked)}
            className="w-3.5 h-3.5 rounded border border-[#2E343E] bg-[#0E1013] accent-[#EA580C] cursor-pointer"
          />
          <span className="font-medium">Fika Comp Only</span>
        </label>

        <label
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[12px] cursor-pointer transition-all select-none ${
            favoritesOnly
              ? 'bg-[#EF4444]/10 border-[#EF4444]/40 text-[#EF4444]'
              : 'bg-[#0E1013] border-[#23272E] text-[#9AA3AF] hover:text-[#E8EAEE] hover:border-[#2E343E]'
          }`}
        >
          <input
            type="checkbox"
            checked={favoritesOnly}
            onChange={(e) => onToggleFavoritesOnly(e.target.checked)}
            className="w-3.5 h-3.5 rounded border border-[#2E343E] bg-[#0E1013] accent-[#EF4444] cursor-pointer"
          />
          <span className="flex items-center gap-1.5 font-medium tabular-nums">
            <Heart
              className={`w-3.5 h-3.5 ${
                favoritesOnly || favoritesCount > 0 ? 'text-[#EF4444] fill-[#EF4444]' : 'text-[#9AA3AF]'
              }`}
            />
            <span>Favorites ({favoritesCount})</span>
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
            onClick={onPrevPage}
            disabled={currentPage <= 1}
            className="bg-[#20252D] hover:bg-[#2A2F38] disabled:opacity-40 text-[#E8EAEE] px-2.5 py-1 rounded border border-[#2A2F38] flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
            type="button"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Prev</span>
          </button>

          <span className="text-[#9AA3AF] px-1 font-mono tabular-nums">
            Page {currentPage} of {lastPage}
          </span>

          <button
            onClick={onNextPage}
            disabled={currentPage >= lastPage}
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
              onChange={onFileInput}
              className="hidden"
            />
          </label>
        </div>
      </div>
    </div>
  );
};
