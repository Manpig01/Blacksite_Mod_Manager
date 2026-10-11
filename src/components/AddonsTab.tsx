import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  Puzzle,
  Download,
  ExternalLink,
  Layers,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Clock,
  Sparkles,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Filter,
  Check,
  Info,
  X,
  FileCode,
  Calendar,
  HardDrive
} from 'lucide-react';
import { Addon, AddonVersion, InstalledMod, Mod } from '../types';
import { apiService } from '../services/apiService';
import { AddonThumbnail } from './AddonThumbnail';

interface AddonsTabProps {
  installedMods: InstalledMod[];
  onInstallAddon: (addon: Addon, version: AddonVersion) => void;
  onNavigateToMod?: (modId: number) => void;
  onShowToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const [installedParentFilter, setInstalledParentFilter] = useState<'all' | 'installed_parent_only' | 'missing_parent_only'>('all');
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

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
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

  // Helper to determine if a parent mod is installed
  const isParentModInstalled = (addon: Addon): { installed: boolean; installedMod?: InstalledMod } => {
    if (!addon.mod && !addon.mod_id) return { installed: false };
    
    // Check by ID first
    if (addon.mod_id && installedModLookup.has(String(addon.mod_id))) {
      return { installed: true, installedMod: installedModLookup.get(String(addon.mod_id)) };
    }

    if (!addon.mod) return { installed: false };

    const pName = addon.mod.name.toLowerCase().trim();
    const pSlug = addon.mod.slug?.toLowerCase().trim();

    // Check direct name match
    if (installedModLookup.has(pName)) {
      return { installed: true, installedMod: installedModLookup.get(pName) };
    }

    // Check loose name or prefix match
    for (const [key, im] of installedModLookup.entries()) {
      if (pSlug && (key.includes(pSlug) || pSlug.includes(key))) {
        return { installed: true, installedMod: im };
      }
      if (key.includes(pName) || pName.includes(key)) {
        return { installed: true, installedMod: im };
      }
    }

    return { installed: false };
  };

  // Helper to check if this addon is already installed
  const isAddonInstalled = (addon: Addon): boolean => {
    const aName = addon.name.toLowerCase().trim();
    for (const [key] of installedModLookup.entries()) {
      if (key === aName || key.includes(aName) || aName.includes(key)) {
        return true;
      }
    }
    return false;
  };

  // Load addons from API
  const fetchAddons = async (forceRefresh = false) => {
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
      });

      setAddons(res.data);
      setTotalCount(res.total);
      setTotalPages(res.total_pages);
      setIsOfflineFallback(!!res.isOfflineFallback);
    } catch (err: any) {
      console.error('Failed to load addons from SPT API:', err);
      setError(err?.message || 'Failed to retrieve addons catalog.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAddons();
  }, [page, debouncedSearch, sort, selectedParentModId]);

  // Filter addons locally if installed-parent filter is active
  const filteredAddons = useMemo(() => {
    if (installedParentFilter === 'all') return addons;

    return addons.filter((addon) => {
      const { installed } = isParentModInstalled(addon);
      if (installedParentFilter === 'installed_parent_only') return installed;
      if (installedParentFilter === 'missing_parent_only') return !installed;
      return true;
    });
  }, [addons, installedParentFilter, installedModLookup]);

  // Handle direct install button click
  const handleInstallClick = (addon: Addon, specifiedVersion?: AddonVersion) => {
    const targetVersion = specifiedVersion || (addon.versions && addon.versions.length > 0
      ? addon.versions[0]
      : {
          id: addon.id * 10,
          addon_id: addon.id,
          version: '1.0.0',
          slug: '1-0-0',
          link: `https://sp-mod.com/addon/download/${addon.id}/${addon.slug || 'addon'}/1.0.0`,
        });

    onInstallAddon(addon, targetVersion);
  };

  const handleFilterByParentMod = (modId: number, modName: string) => {
    setSelectedParentModId(modId);
    setSelectedParentModName(modName);
    setPage(1);
    onShowToast('Addon Filter', `Filtering addons for parent mod "${modName}"`, 'info');
  };

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
                <span className="px-2 py-0.5 text-[11px] font-mono bg-[#20252D] text-[#9AA3AF] rounded border border-[#2A303C]">
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
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search addons, configs, authors, or parent mods..."
              className="w-full bg-[#121418] border border-[#2A303C] rounded pl-9 pr-3 py-1.5 text-xs text-[#E8EAEE] placeholder-[#6B7280] focus:outline-none focus:border-[#EA580C] transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[#9AA3AF] hover:text-[#E8EAEE] cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>

          {/* Sort selection */}
          <div className="md:col-span-3 flex items-center gap-2">
            <span className="text-xs text-[#9AA3AF] shrink-0">Sort:</span>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as any);
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
              onChange={(e) => setInstalledParentFilter(e.target.value as any)}
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
              const { installed: parentInstalled } = isParentModInstalled(addon);
              const alreadyInstalled = isAddonInstalled(addon);
              const latestVer = addon.versions && addon.versions.length > 0 ? addon.versions[0] : null;

              return (
                <div
                  key={addon.id}
                  className="bg-[#181B20] border border-[#23272E] hover:border-[#2A303C] rounded-lg overflow-hidden flex flex-col transition-all group hover:shadow-lg"
                >
                  {/* Thumbnail / Header Preview */}
                  <div
                    onClick={() => setInspectAddon(addon)}
                    className="h-28 bg-[#101216] relative overflow-hidden flex items-center justify-center border-b border-[#23272E] cursor-pointer"
                  >
                    <AddonThumbnail
                      addon={addon}
                      className="group-hover:scale-105 transition-transform duration-300"
                    />

                    {/* Version Badge */}
                    {latestVer && (
                      <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-[#121418]/90 backdrop-blur-xs border border-[#2A303C] text-[10px] font-mono rounded text-[#9AA3AF]">
                        v{latestVer.version}
                      </div>
                    )}

                    {/* Installed Status Overlay */}
                    {alreadyInstalled && (
                      <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-[#10B981]/20 border border-[#10B981]/40 text-[#10B981] text-[10px] font-semibold rounded flex items-center gap-1 backdrop-blur-xs">
                        <Check className="w-2.5 h-2.5" />
                        <span>Installed</span>
                      </div>
                    )}

                    {/* Quick Inspect Hover Overlay */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 text-white text-xs font-semibold backdrop-blur-[1px]">
                      <Info className="w-4 h-4 text-[#EA580C]" />
                      <span>View Details & Versions</span>
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="p-3.5 flex-1 flex flex-col justify-between space-y-3">
                    <div>
                      {/* Title & Author */}
                      <h3
                        onClick={() => setInspectAddon(addon)}
                        className="text-sm font-semibold text-[#E8EAEE] line-clamp-1 group-hover:text-[#EA580C] transition-colors cursor-pointer"
                        title={addon.name}
                      >
                        {addon.name}
                      </h3>
                      <div className="text-[11px] text-[#9AA3AF] mt-0.5 flex items-center gap-1.5">
                        <span>by {addon.authors?.[0]?.name || 'Community'}</span>
                        {addon.downloads !== undefined && (
                          <>
                            <span>•</span>
                            <span className="font-mono">{addon.downloads.toLocaleString()} DLs</span>
                          </>
                        )}
                      </div>

                      {/* Teaser Description */}
                      <p className="text-xs text-[#9AA3AF] mt-2 line-clamp-2 leading-relaxed">
                        {addon.teaser || (addon.description ? addon.description.replace(/<[^>]*>/g, '') : '') || 'Modular preset configuration for SPT.'}
                      </p>
                    </div>

                    {/* Parent Mod Relationship Box */}
                    <div className="space-y-2 pt-2 border-t border-[#23272E]">
                      {addon.mod ? (
                        <div
                          className={`p-2 rounded border text-xs flex items-center justify-between gap-2 ${
                            parentInstalled
                              ? 'bg-[#10B981]/10 border-[#10B981]/25 text-[#10B981]'
                              : 'bg-[#F59E0B]/10 border-[#F59E0B]/25 text-[#F59E0B]'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            {parentInstalled ? (
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-[#10B981]" />
                            ) : (
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[#F59E0B]" />
                            )}
                            <span className="truncate text-[11px]" title={`Parent Mod: ${addon.mod.name}`}>
                              Parent: <strong>{addon.mod.name}</strong>
                            </span>
                          </div>

                          <div className="shrink-0 flex items-center gap-1.5">
                            {parentInstalled ? (
                              <span className="text-[10px] uppercase font-mono font-bold bg-[#10B981]/20 px-1 py-0.5 rounded">
                                Ready
                              </span>
                            ) : (
                              <span className="text-[10px] uppercase font-mono font-bold bg-[#F59E0B]/20 px-1 py-0.5 rounded">
                                Missing
                              </span>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleFilterByParentMod(addon.mod!.id, addon.mod!.name);
                              }}
                              className="text-[10px] px-1 py-0.5 bg-[#20252D] hover:bg-[#282E38] text-[#E8EAEE] rounded border border-[#2A303C] cursor-pointer"
                              title="Filter all addons for this mod"
                            >
                              Filter
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-[11px] text-[#9AA3AF] italic">
                          Standalone / General Mod Component
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => handleInstallClick(addon)}
                          className={`flex-1 py-1.5 px-3 rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                            parentInstalled
                              ? 'bg-[#EA580C] hover:bg-[#EA580C]/90 text-white shadow-sm'
                              : 'bg-[#20252D] hover:bg-[#282E38] text-[#E8EAEE] border border-[#2A303C]'
                          }`}
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>{alreadyInstalled ? 'Reinstall' : 'Install Addon'}</span>
                        </button>

                        <button
                          onClick={() => setInspectAddon(addon)}
                          className="p-1.5 bg-[#20252D] hover:bg-[#282E38] text-[#9AA3AF] hover:text-[#E8EAEE] border border-[#2A303C] rounded transition-colors cursor-pointer"
                          title="Inspect Details & Versions"
                        >
                          <Info className="w-3.5 h-3.5" />
                        </button>

                        <a
                          href={`https://sp-mod.com/addon/${addon.id}/${addon.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 bg-[#20252D] hover:bg-[#282E38] text-[#9AA3AF] hover:text-[#E8EAEE] border border-[#2A303C] rounded transition-colors"
                          title="View on sp-mod.com"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      {!loading && totalPages > 1 && (
        <div className="bg-[#181B20] border-t border-[#23272E] px-4 py-2.5 flex items-center justify-between shrink-0">
          <div className="text-xs text-[#9AA3AF]">
            Page <span className="font-mono text-[#E8EAEE]">{page}</span> of{' '}
            <span className="font-mono text-[#E8EAEE]">{totalPages}</span>
            <span className="ml-2 font-mono text-[#6B7280]">({totalCount} total addons)</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
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
      {inspectAddon && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-[#181B20] border border-[#23272E] rounded-xl w-full max-w-2xl max-h-[85vh] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="px-5 py-4 border-b border-[#23272E] flex items-center justify-between bg-[#1C2026]">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg overflow-hidden border border-[#2A303C] shrink-0 bg-[#121418]">
                  <AddonThumbnail addon={inspectAddon} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-[#E8EAEE]">{inspectAddon.name}</h2>
                  <p className="text-xs text-[#9AA3AF]">
                    by {inspectAddon.authors?.[0]?.name || 'Community Author'} • {inspectAddon.downloads?.toLocaleString() || 0} downloads
                  </p>
                </div>
              </div>
              <button
                onClick={() => setInspectAddon(null)}
                className="p-1.5 rounded-lg text-[#9AA3AF] hover:text-[#E8EAEE] hover:bg-[#282E38] transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4 custom-scrollbar text-xs">
              {/* Parent Mod Banner */}
              {inspectAddon.mod && (
                <div className="p-3 rounded-lg border bg-[#121418] border-[#2A303C] flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Layers className="w-4 h-4 text-[#EA580C]" />
                    <div>
                      <div className="font-semibold text-[#E8EAEE]">
                        Parent Mod: {inspectAddon.mod.name}
                      </div>
                      <div className="text-[11px] text-[#9AA3AF]">
                        {isParentModInstalled(inspectAddon).installed
                          ? '✓ Base mod is currently installed in your loadout'
                          : '⚠️ Base mod is not installed. You will be prompted to install it together.'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {onNavigateToMod && inspectAddon.mod_id && (
                      <button
                        onClick={() => {
                          setInspectAddon(null);
                          onNavigateToMod(inspectAddon.mod_id);
                        }}
                        className="px-2.5 py-1 bg-[#20252D] hover:bg-[#282E38] text-white rounded border border-[#2A303C] text-[11px] font-medium cursor-pointer"
                      >
                        View Mod
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Description */}
              <div>
                <h4 className="font-bold text-[#E8EAEE] uppercase tracking-wider text-[11px] mb-1.5">Description</h4>
                <div
                  className="p-3 rounded bg-[#121418] border border-[#23272E] text-[#9AA3AF] leading-relaxed max-h-48 overflow-y-auto prose prose-invert prose-xs"
                  dangerouslySetInnerHTML={{
                    __html: inspectAddon.description || inspectAddon.teaser || 'No detailed description provided.'
                  }}
                />
              </div>

              {/* Available Versions */}
              <div>
                <h4 className="font-bold text-[#E8EAEE] uppercase tracking-wider text-[11px] mb-2 flex items-center justify-between">
                  <span>Available Releases ({inspectAddon.versions?.length || 0})</span>
                  <span className="text-[10px] text-[#9AA3AF] font-normal">Choose version to install</span>
                </h4>

                {(!inspectAddon.versions || inspectAddon.versions.length === 0) ? (
                  <div className="p-3 rounded bg-[#121418] border border-[#23272E] text-center text-[#9AA3AF]">
                    No versions listed. You can install the default package.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {inspectAddon.versions.map((ver) => (
                      <div
                        key={ver.id}
                        className="p-3 rounded bg-[#121418] border border-[#23272E] hover:border-[#2A303C] flex items-center justify-between gap-3 transition-colors"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-[#E8EAEE] text-xs">
                              v{ver.version}
                            </span>
                            {ver.mod_version_constraint && (
                              <span className="px-1.5 py-0.5 rounded bg-[#20252D] border border-[#2A303C] text-[10px] font-mono text-[#9AA3AF]" title="Requires Base Mod Version">
                                Requires {ver.mod_version_constraint}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-[#9AA3AF]">
                            <span>{ver.downloads?.toLocaleString() || 0} downloads</span>
                            <span>•</span>
                            <span>{formatBytes(ver.content_length)}</span>
                            {ver.published_at && (
                              <>
                                <span>•</span>
                                <span>{new Date(ver.published_at).toLocaleDateString()}</span>
                              </>
                            )}
                          </div>
                          {ver.changelog && (
                            <p className="text-[11px] text-[#6B7280] line-clamp-1">
                              {ver.changelog.replace(/<[^>]*>/g, '')}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => {
                              handleInstallClick(inspectAddon, ver);
                              setInspectAddon(null);
                            }}
                            className="px-3 py-1.5 bg-[#EA580C] hover:bg-[#EA580C]/90 text-white rounded font-medium text-xs flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Install v{ver.version}</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-[#23272E] bg-[#1C2026] flex items-center justify-between">
              <a
                href={`https://sp-mod.com/addon/${inspectAddon.id}/${inspectAddon.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#9AA3AF] hover:text-[#E8EAEE] flex items-center gap-1.5 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open on sp-mod.com</span>
              </a>

              <button
                onClick={() => setInspectAddon(null)}
                className="px-4 py-1.5 bg-[#20252D] hover:bg-[#282E38] text-xs font-medium rounded border border-[#2A303C] text-[#E8EAEE] cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
