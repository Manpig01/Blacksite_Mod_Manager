import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, RotateCw, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Download, Check, ExternalLink, Flame, ShieldAlert, X } from 'lucide-react';
import { Mod, ModCategory, InstalledMod, RecommendedModItem } from '../types';
import { apiService } from '../services/apiService';
import { ModThumbnail } from './ModThumbnail';

interface RecommendedModsSectionProps {
  installedMods: InstalledMod[];
  categories: ModCategory[];
  installedGuids: string[];
  onInstallMod: (mod: Mod, version?: string) => void;
  onOpenVersions: (mod: Mod) => void;
  onHide?: () => void;
}

export const RecommendedModsSection: React.FC<RecommendedModsSectionProps> = ({
  installedMods,
  categories,
  installedGuids,
  onInstallMod,
  onOpenVersions,
  onHide,
}) => {
  const [recommendations, setRecommendations] = useState<RecommendedModItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [selectedFilterCategory, setSelectedFilterCategory] = useState<string>('all');
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Compute category statistics from installed mods
  const categoryStats = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const inst of installedMods) {
      let cat = inst.categoryTitle;
      if (!cat) {
        const lower = inst.name.toLowerCase();
        if (lower.includes('bot') || lower.includes('sain') || lower.includes('brain')) cat = 'Bots';
        else if (lower.includes('server') || lower.includes('svm') || lower.includes('overhaul')) cat = 'Overhauls';
        else if (lower.includes('graphics') || lower.includes('light') || lower.includes('retexture')) cat = 'Retextures';
        else if (lower.includes('trader') || lower.includes('flea')) cat = 'Traders';
        else if (lower.includes('weapon') || lower.includes('gun') || lower.includes('scope')) cat = 'Weapons';
        else cat = 'Other';
      }
      counts[cat] = (counts[cat] || 0) + 1;
    }

    const total = installedMods.length || 1;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return {
      counts,
      sorted,
      totalInstalled: installedMods.length,
      topCategoryNames: sorted.slice(0, 3).map(([name]) => name),
    };
  }, [installedMods]);

  const fetchRecommendations = async () => {
    setLoading(true);
    try {
      const items = await apiService.getRecommendedMods(installedMods, categories);
      setRecommendations(items);
    } catch {
      setRecommendations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecommendations();
  }, [installedMods.length]);

  const handleScroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const offset = direction === 'left' ? -380 : 380;
      scrollContainerRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  // Filter recommendations based on user-selected category pill
  const filteredRecs = selectedFilterCategory === 'all'
    ? recommendations
    : recommendations.filter(
        (r) => r.categoryTitle.toLowerCase() === selectedFilterCategory.toLowerCase()
      );

  return (
    <div className="bg-[#181B20] border border-[#23272E] hover:border-[#EA580C]/40 rounded-lg p-3 shrink-0 mb-3 shadow-sm transition-colors">
      {/* Top Header Row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-[#2A180E] border border-[#EA580C]/40 flex items-center justify-center text-[#EA580C]">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[13px] font-bold text-[#E8EAEE] tracking-wide uppercase font-mono">
                Recommended For You
              </h2>
              <span className="text-[10px] bg-[#2A180E] text-[#EA580C] px-1.5 py-0.2 rounded font-semibold border border-[#EA580C]/30">
                LIVE FORGE SUGGESTIONS
              </span>
            </div>
            <p className="text-[11.5px] text-[#9AA3AF] mt-0.5">
              {categoryStats.totalInstalled > 0 ? (
                <span>
                  Analyzed your {categoryStats.totalInstalled} installed mods · Top playstyle:{' '}
                  {categoryStats.sorted.slice(0, 3).map(([cat, cnt], idx) => (
                    <span key={cat} className="text-[#E8EAEE] font-medium">
                      {idx > 0 && ', '}
                      {cat} ({cnt})
                    </span>
                  ))}
                </span>
              ) : (
                <span>Essential community starter pack for SPT 4.x</span>
              )}
            </p>
          </div>
        </div>

        {/* Right Action Controls */}
        <div className="flex items-center gap-2">
          {/* Category Filter Pills (if multiple categories found) */}
          {!isCollapsed && categoryStats.sorted.length > 0 && (
            <div className="hidden md:flex items-center gap-1 bg-[#121418] p-0.5 rounded-md border border-[#23272E] text-[11px]">
              <button
                type="button"
                onClick={() => setSelectedFilterCategory('all')}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                  selectedFilterCategory === 'all'
                    ? 'bg-[#20252D] text-[#E8EAEE] font-semibold'
                    : 'text-[#9AA3AF] hover:text-[#E8EAEE]'
                }`}
              >
                All ({recommendations.length})
              </button>
              {categoryStats.sorted.slice(0, 3).map(([cat]) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedFilterCategory(cat.toLowerCase())}
                  className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                    selectedFilterCategory === cat.toLowerCase()
                      ? 'bg-[#20252D] text-[#EA580C] font-semibold'
                      : 'text-[#9AA3AF] hover:text-[#E8EAEE]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {/* Carousel Left / Right Buttons */}
          {!isCollapsed && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleScroll('left')}
                className="w-6 h-6 rounded bg-[#20252D] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-[#E8EAEE] border border-[#2A2F38] flex items-center justify-center transition-colors cursor-pointer"
                title="Scroll recommendations left"
                aria-label="Scroll left"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleScroll('right')}
                className="w-6 h-6 rounded bg-[#20252D] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-[#E8EAEE] border border-[#2A2F38] flex items-center justify-center transition-colors cursor-pointer"
                title="Scroll recommendations right"
                aria-label="Scroll right"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Refresh Button */}
          <button
            type="button"
            onClick={fetchRecommendations}
            className="w-6 h-6 rounded bg-[#20252D] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-[#E8EAEE] border border-[#2A2F38] flex items-center justify-center transition-colors cursor-pointer"
            title="Refresh recommendations from API"
            aria-label="Refresh recommendations"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* Collapse/Expand Toggle */}
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="w-6 h-6 rounded bg-[#20252D] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-[#E8EAEE] border border-[#2A2F38] flex items-center justify-center transition-colors cursor-pointer"
            title={isCollapsed ? 'Expand recommendations' : 'Collapse recommendations'}
            aria-label={isCollapsed ? 'Expand recommendations' : 'Collapse recommendations'}
          >
            {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>

          {/* Dismiss / Hide Section */}
          {onHide && (
            <button
              type="button"
              onClick={onHide}
              className="w-6 h-6 rounded bg-[#20252D] hover:bg-[#DC2626] text-[#9AA3AF] hover:text-white border border-[#2A2F38] flex items-center justify-center transition-colors cursor-pointer"
              title="Hide Recommended section (can be re-enabled in filters or Settings)"
              aria-label="Hide Recommended section"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Recommendations Carousel Tray */}
      {!isCollapsed && (
        <div className="mt-3">
          {loading ? (
            <div className="flex gap-3 overflow-hidden">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="w-[320px] shrink-0 h-[150px] bg-[#121418] border border-[#23272E] rounded-lg p-2.5 flex gap-2.5 animate-pulse"
                >
                  <div className="w-[100px] h-[100px] bg-[#1F242C] rounded-md shrink-0" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-3 bg-[#282E38] rounded w-3/4" />
                    <div className="h-2.5 bg-[#20252D] rounded w-1/2" />
                    <div className="h-8 bg-[#181B20] rounded w-full mt-3" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredRecs.length > 0 ? (
            <div
              ref={scrollContainerRef}
              className="flex gap-3 overflow-x-auto pb-1.5 scrollbar-thin scrollbar-thumb-[#2A2F38] scrollbar-track-[#121418] scroll-smooth"
            >
              {filteredRecs.map((rec) => {
                const mod = rec.mod;
                const isInstalled = mod.guid ? installedGuids.includes(mod.guid) : false;
                const latestVersion = mod.versions?.[0]?.version || '1.0.0';

                return (
                  <div
                    key={mod.id}
                    className="w-[320px] shrink-0 h-[162px] bg-[#121418] border border-[#23272E] hover:border-[#EA580C] rounded-lg p-2.5 flex gap-2.5 relative group transition-all duration-200 hover:shadow-md"
                  >
                    {/* Left Thumbnail (105x105) */}
                    <div className="w-[105px] h-[105px] shrink-0">
                      <ModThumbnail mod={mod} className="w-[105px] h-[105px] rounded-md" />
                    </div>

                    {/* Right Details Column */}
                    <div className="flex-1 flex flex-col justify-between overflow-hidden min-w-0">
                      <div>
                        {/* Recommendation Reason Pill */}
                        <div className="flex items-center gap-1 mb-1">
                          <span className="text-[10px] font-mono text-[#EA580C] bg-[#2A180E] px-1.5 py-0.5 rounded truncate border border-[#EA580C]/30 font-medium">
                            ⚡ {rec.reason}
                          </span>
                        </div>

                        {/* Mod Title */}
                        <h3
                          className="text-[13px] font-bold text-[#E8EAEE] truncate tracking-tight group-hover:text-white"
                          title={mod.name}
                        >
                          {mod.name}
                        </h3>

                        {/* Author & Version */}
                        <div className="text-[11px] text-[#9AA3AF] truncate mt-0.5">
                          v{latestVersion} · by{' '}
                          <span className="text-[#CBD5E1]">{mod.owner?.name || 'Unknown'}</span>
                        </div>

                        {/* Teaser 1-line clamp */}
                        <p className="text-[11px] text-[#6B7480] line-clamp-1 mt-1" title={mod.teaser || ''}>
                          {mod.teaser || 'High-performance community modification for SPT.'}
                        </p>
                      </div>

                      {/* Bottom Action Buttons */}
                      <div className="flex items-center justify-between gap-1.5 pt-1.5 border-t border-[#1C2026]">
                        <div className="text-[10.5px] font-mono text-[#9AA3AF] tabular-nums">
                          {mod.downloads > 1000 ? `${(mod.downloads / 1000).toFixed(0)}k dl` : `${mod.downloads} dl`}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onOpenVersions(mod)}
                            className="bg-[#1C2026] hover:bg-[#252B33] text-[#9AA3AF] hover:text-[#E8EAEE] text-[11px] px-2 py-1 rounded border border-[#2A2F38] transition-colors cursor-pointer"
                            title="View all versions"
                          >
                            Versions
                          </button>

                          <button
                            type="button"
                            onClick={() => onInstallMod(mod)}
                            disabled={isInstalled}
                            className={`text-[11px] px-2.5 py-1 rounded font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                              isInstalled
                                ? 'bg-[#0E2A18] text-[#22C55E] border border-[#16A34A]/50 cursor-default'
                                : 'bg-[#EA580C] hover:bg-[#F97316] text-white shadow-sm'
                            }`}
                            title={isInstalled ? 'Already installed' : `Install ${mod.name}`}
                          >
                            {isInstalled ? (
                              <>
                                <Check className="w-3 h-3" />
                                <span>Installed</span>
                              </>
                            ) : (
                              <>
                                <Download className="w-3 h-3" />
                                <span>Install</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-4 text-center text-[#9AA3AF] text-[12px] bg-[#121418] rounded-md border border-[#23272E]">
              All top recommended mods for your frequent categories are currently installed in your loadout!
            </div>
          )}
        </div>
      )}
    </div>
  );
};
