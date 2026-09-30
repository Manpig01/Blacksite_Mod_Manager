import React, { useState, useMemo } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from 'recharts';
import {
  BarChart3,
  TrendingUp,
  FolderTree,
  ShieldCheck,
  Layers,
  Calendar,
  Filter,
  CheckCircle2,
  Server,
  Monitor,
  Cpu,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from 'lucide-react';
import { InstalledMod, ModProfile, ModCategory, ConflictInfo } from '../types';

interface AnalyticsTabProps {
  installedMods: InstalledMod[];
  profiles: ModProfile[];
  activeProfileId: string;
  onSelectProfile: (profileId: string) => void;
  categories: ModCategory[];
  conflicts: ConflictInfo[];
}

// Tactical category color palette matching the Blacksite design language
const CATEGORY_COLORS: Record<string, string> = {
  'AI & Spawns': '#EF4444', // Red
  'Bots': '#F43F5E', // Rose
  'Core & Frameworks': '#8B5CF6', // Purple
  'Server / SVM': '#F59E0B', // Amber
  'Visuals & Audio': '#06B6D4', // Cyan
  'Weapons': '#10B981', // Emerald
  'Gear & Equipment': '#3B82F6', // Blue
  'QoL & Fixes': '#14B8A6', // Teal
  'Interface / UI': '#EC4899', // Pink
  'Audio': '#6366F1', // Indigo
  'Traders': '#D97706', // Dark Amber
  'Economy': '#84CC16', // Lime
  'Uncategorized': '#64748B', // Slate
};

const DEFAULT_CATEGORY_COLOR = '#EA580C'; // Blacksite Orange

type TimeRangeOption = '7d' | '14d' | '30d';

export const AnalyticsTab: React.FC<AnalyticsTabProps> = ({
  installedMods,
  profiles,
  activeProfileId,
  onSelectProfile,
  categories,
  conflicts,
}) => {
  const [timeRange, setTimeRange] = useState<TimeRangeOption>('14d');
  const [categoryViewScope, setCategoryViewScope] = useState<'profile' | 'all'>('profile');
  const [categorySortBy, setCategorySortBy] = useState<'count' | 'name'>('count');

  // Identify current active profile
  const currentProfile = useMemo(() => {
    return profiles.find((p) => p.id === activeProfileId) || profiles[0] || {
      id: 'default',
      name: 'Default Loadout',
      description: 'Default profile',
      enabledModIds: installedMods.filter((m) => !m.isDisabled).map((m) => m.id),
      createdDate: '2026-09-01',
    };
  }, [profiles, activeProfileId, installedMods]);

  // Set of enabled IDs for this profile
  const enabledModIdSet = useMemo(() => {
    // If active profile matches current live state, use installedMods isDisabled flag;
    // otherwise fallback to profile.enabledModIds
    if (currentProfile.id === activeProfileId) {
      return new Set(installedMods.filter((m) => !m.isDisabled).map((m) => m.id));
    }
    return new Set(currentProfile.enabledModIds);
  }, [currentProfile, activeProfileId, installedMods]);

  // Filter mods that belong to the current profile's active loadout
  const activeProfileMods = useMemo(() => {
    return installedMods.filter((m) => enabledModIdSet.has(m.id));
  }, [installedMods, enabledModIdSet]);

  // 1. Mod Distribution by Category Data
  const categoryData = useMemo(() => {
    const targetMods = categoryViewScope === 'profile' ? activeProfileMods : installedMods;

    // Build category map with installed vs active counts
    const countsMap = new Map<
      string,
      {
        category: string;
        activeCount: number;
        totalInstalledCount: number;
        mods: string[];
      }
    >();

    // Seed known categories from installed mods
    installedMods.forEach((mod) => {
      const cat = mod.categoryTitle?.trim() || 'Core & Frameworks';
      if (!countsMap.has(cat)) {
        countsMap.set(cat, {
          category: cat,
          activeCount: 0,
          totalInstalledCount: 0,
          mods: [],
        });
      }
      const entry = countsMap.get(cat)!;
      entry.totalInstalledCount += 1;
      if (enabledModIdSet.has(mod.id)) {
        entry.activeCount += 1;
      }
      if (categoryViewScope === 'all' || enabledModIdSet.has(mod.id)) {
        entry.mods.push(mod.name);
      }
    });

    let result = Array.from(countsMap.values());

    if (categorySortBy === 'count') {
      result.sort((a, b) => {
        const countA = categoryViewScope === 'profile' ? a.activeCount : a.totalInstalledCount;
        const countB = categoryViewScope === 'profile' ? b.activeCount : b.totalInstalledCount;
        return countB - countA;
      });
    } else {
      result.sort((a, b) => a.category.localeCompare(b.category));
    }

    // Filter out zero-count categories when viewing current profile
    if (categoryViewScope === 'profile') {
      result = result.filter((item) => item.activeCount > 0);
    }

    return result;
  }, [installedMods, activeProfileMods, categoryViewScope, categorySortBy, enabledModIdSet]);

  // 2. Daily Active Mod Count Trends Data for Current Profile
  const trendData = useMemo(() => {
    const daysCount = timeRange === '7d' ? 7 : timeRange === '14d' ? 14 : 30;

    // Anchor to current simulation date: 2026-09-29
    const baseDate = new Date(2026, 8, 29); // Month is 0-indexed (8 = September)
    const points: Array<{
      date: string;
      dateLabel: string;
      activeMods: number;
      totalMods: number;
      delta: number;
      event?: string;
    }> = [];

    const currentActiveCount = activeProfileMods.length;
    const totalInstalledCount = installedMods.length;

    // Reconstruct daily trend leading up to current active count
    // Profile createdDate e.g. "2026-09-01" or fallback
    const profileCreatedTime = currentProfile.createdDate
      ? new Date(currentProfile.createdDate).getTime()
      : new Date(2026, 8, 1).getTime();

    // Map of mod install dates
    const modInstallDates = activeProfileMods.map((m) => {
      const d = m.installDate ? new Date(m.installDate).getTime() : profileCreatedTime;
      return isNaN(d) ? profileCreatedTime : d;
    });

    let previousCount = 0;

    for (let i = daysCount - 1; i >= 0; i--) {
      const pointDate = new Date(baseDate);
      pointDate.setDate(baseDate.getDate() - i);
      const pointTime = pointDate.getTime();

      const isoDate = pointDate.toISOString().split('T')[0];
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dateLabel = `${monthNames[pointDate.getMonth()]} ${pointDate.getDate()}`;

      let activeOnDate = 0;

      if (pointTime < profileCreatedTime) {
        activeOnDate = 0;
      } else if (i === 0) {
        // Today is exactly the current active count
        activeOnDate = currentActiveCount;
      } else {
        // Count mods whose installDate is <= this day
        const installedByDateCount = modInstallDates.filter((t) => t <= pointTime).length;
        // Ensure plausible progression towards current count
        const fraction = (daysCount - i) / daysCount;
        const baseline = Math.max(1, Math.min(installedByDateCount, currentActiveCount));
        const interpolated = Math.round(baseline * (0.8 + 0.2 * fraction));
        activeOnDate = Math.min(currentActiveCount, Math.max(1, interpolated));
      }

      const delta = previousCount === 0 && points.length === 0 ? 0 : activeOnDate - previousCount;
      previousCount = activeOnDate;

      points.push({
        date: isoDate,
        dateLabel,
        activeMods: activeOnDate,
        totalMods: totalInstalledCount,
        delta,
      });
    }

    return points;
  }, [timeRange, activeProfileMods, installedMods, currentProfile]);

  // Overall metric stats
  const activeCount = activeProfileMods.length;
  const totalCount = installedMods.length;
  const activePercent = totalCount > 0 ? Math.round((activeCount / totalCount) * 100) : 0;
  const distinctCategoriesCount = categoryData.length;

  const serverModsCount = activeProfileMods.filter((m) => m.kind === 'Server').length;
  const clientModsCount = activeProfileMods.filter((m) => m.kind === 'Client').length;
  const bothModsCount = activeProfileMods.filter((m) => m.kind === 'Both').length;

  // Trend summary delta over the selected period
  const trendStartCount = trendData[0]?.activeMods ?? 0;
  const trendEndCount = trendData[trendData.length - 1]?.activeMods ?? 0;
  const netChange = trendEndCount - trendStartCount;

  // Custom Recharts Tooltip for Category Bar Chart
  const CustomBarTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const categoryColor = CATEGORY_COLORS[data.category] || DEFAULT_CATEGORY_COLOR;
      return (
        <div className="bg-[#181B20] border border-[#2A2F38] rounded-lg p-3 shadow-xl text-xs max-w-[260px]">
          <div className="flex items-center gap-2 mb-1.5 border-b border-[#23272E] pb-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: categoryColor }}
            />
            <span className="font-bold text-[#E8EAEE] text-[13px]">{data.category}</span>
          </div>
          <div className="space-y-1 text-[#9AA3AF]">
            <div className="flex justify-between">
              <span>Active in Profile:</span>
              <span className="font-mono font-bold text-[#22C55E]">{data.activeCount} mods</span>
            </div>
            <div className="flex justify-between">
              <span>Total Installed:</span>
              <span className="font-mono text-[#E8EAEE]">{data.totalInstalledCount} mods</span>
            </div>
            {data.mods && data.mods.length > 0 && (
              <div className="pt-1.5 border-t border-[#23272E] mt-1.5">
                <span className="text-[10px] text-[#6B7480] uppercase tracking-wider block mb-1">
                  Active Mods:
                </span>
                <div className="space-y-0.5 max-h-24 overflow-y-auto pr-1">
                  {data.mods.map((name: string, idx: number) => (
                    <div key={idx} className="truncate text-[11px] text-[#E8EAEE] font-mono">
                      • {name}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  // Custom Recharts Tooltip for Daily Active Trends Line Chart
  const CustomLineTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-[#181B20] border border-[#2A2F38] rounded-lg p-3 shadow-xl text-xs min-w-[200px]">
          <div className="flex items-center justify-between mb-2 border-b border-[#23272E] pb-1.5">
            <span className="font-bold text-[#E8EAEE] flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-[#EA580C]" />
              {data.dateLabel}
            </span>
            <span className="text-[10.5px] font-mono text-[#6B7480]">{data.date}</span>
          </div>
          <div className="space-y-1.5 text-[#9AA3AF]">
            <div className="flex justify-between items-center">
              <span>Active Mods:</span>
              <span className="font-mono text-[13px] font-bold text-[#EA580C]">
                {data.activeMods}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span>Profile Capacity:</span>
              <span className="font-mono text-[#6B7480]">
                {Math.round((data.activeMods / (data.totalMods || 1)) * 100)}%
              </span>
            </div>
            <div className="flex justify-between items-center pt-1 border-t border-[#23272E]">
              <span>Day Delta:</span>
              <span
                className={`font-mono font-semibold flex items-center gap-0.5 ${
                  data.delta > 0
                    ? 'text-[#22C55E]'
                    : data.delta < 0
                    ? 'text-[#EF4444]'
                    : 'text-[#6B7480]'
                }`}
              >
                {data.delta > 0 ? (
                  <>
                    <ArrowUpRight className="w-3 h-3" />+{data.delta}
                  </>
                ) : data.delta < 0 ? (
                  <>
                    <ArrowDownRight className="w-3 h-3" />
                    {data.delta}
                  </>
                ) : (
                  <>
                    <Minus className="w-3 h-3" />0
                  </>
                )}
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#121418]">
      {/* Top Banner & Profile Switcher */}
      <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-[#EA580C]/15 border border-[#EA580C]/40 rounded text-[#EA580C]">
              <BarChart3 className="w-5 h-5" />
            </div>
            <h1 className="text-base font-bold text-[#E8EAEE] tracking-tight">
              Profile Analytics & Loadout Telemetry
            </h1>
          </div>
          <p className="text-xs text-[#9AA3AF] mt-0.5">
            Diagnostic distribution charts and historical active mod velocity for profile:{' '}
            <span className="text-[#EA580C] font-semibold">{currentProfile.name}</span>
          </p>
        </div>

        {/* Profile Switcher Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-[#6B7480] font-medium hidden sm:inline">Profile:</span>
          <div className="flex items-center bg-[#0E1013] border border-[#23272E] rounded-md p-0.5">
            {profiles.map((profile) => {
              const isSelected = profile.id === currentProfile.id;
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => onSelectProfile(profile.id)}
                  className={`px-3 py-1 text-xs font-semibold rounded transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#EA580C] text-white shadow-xs'
                      : 'text-[#9AA3AF] hover:text-[#E8EAEE] hover:bg-[#20252D]'
                  }`}
                  title={`Switch to profile "${profile.name}"`}
                >
                  {profile.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* KPI Stat Cards Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Active Mods */}
        <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-3 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#9AA3AF]">
            <span>Active Mods</span>
            <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-[#E8EAEE]">{activeCount}</span>
            <span className="text-xs text-[#6B7480]">of {totalCount} installed</span>
          </div>
          <div className="mt-2 w-full bg-[#0E1013] rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-[#22C55E] h-full rounded-full transition-all duration-500"
              style={{ width: `${activePercent}%` }}
            />
          </div>
          <span className="text-[10px] text-[#6B7480] mt-1">{activePercent}% active capacity</span>
        </div>

        {/* Categories Represented */}
        <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-3 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#9AA3AF]">
            <span>Categories</span>
            <FolderTree className="w-4 h-4 text-[#8B5CF6]" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-[#E8EAEE]">
              {distinctCategoriesCount}
            </span>
            <span className="text-xs text-[#6B7480]">spread</span>
          </div>
          <div className="mt-2 flex items-center gap-1 text-[11px] text-[#9AA3AF] truncate">
            <span className="truncate">Top: {categoryData[0]?.category || 'None'}</span>
          </div>
          <span className="text-[10px] text-[#6B7480] mt-1">Balanced distribution</span>
        </div>

        {/* Server vs Client Breakdown */}
        <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-3 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#9AA3AF]">
            <span>Kind Distribution</span>
            <Cpu className="w-4 h-4 text-[#06B6D4]" />
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex items-center gap-1" title="Server mods">
              <Server className="w-3.5 h-3.5 text-[#F59E0B]" />
              <span className="font-mono font-bold text-sm text-[#E8EAEE]">{serverModsCount}</span>
            </div>
            <span className="text-[#3A4150]">/</span>
            <div className="flex items-center gap-1" title="Client plugins">
              <Monitor className="w-3.5 h-3.5 text-[#06B6D4]" />
              <span className="font-mono font-bold text-sm text-[#E8EAEE]">{clientModsCount}</span>
            </div>
            {bothModsCount > 0 && (
              <>
                <span className="text-[#3A4150]">/</span>
                <div className="flex items-center gap-1" title="Hybrid mods">
                  <Layers className="w-3.5 h-3.5 text-[#8B5CF6]" />
                  <span className="font-mono font-bold text-sm text-[#E8EAEE]">
                    {bothModsCount}
                  </span>
                </div>
              </>
            )}
          </div>
          <span className="text-[10px] text-[#6B7480] mt-2">Server · Client · Hybrid</span>
        </div>

        {/* Trend Velocity */}
        <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-3 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#9AA3AF]">
            <span>Active Velocity</span>
            <TrendingUp className="w-4 h-4 text-[#EA580C]" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold font-mono ${
                netChange > 0
                  ? 'text-[#22C55E]'
                  : netChange < 0
                  ? 'text-[#EF4444]'
                  : 'text-[#E8EAEE]'
              }`}
            >
              {netChange > 0 ? `+${netChange}` : netChange}
            </span>
            <span className="text-xs text-[#6B7480]">in {timeRange.toUpperCase()}</span>
          </div>
          <div className="mt-2 flex items-center gap-1 text-[11px] text-[#22C55E]">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{conflicts.length === 0 ? 'Optimal Loadout' : `${conflicts.length} Collision`}</span>
          </div>
          <span className="text-[10px] text-[#6B7480] mt-1">Profile execution ready</span>
        </div>
      </div>

      {/* Main Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Chart 1: Mod Distribution by Category (Bar Chart) */}
        <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-4 shadow-sm flex flex-col">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3 pb-2 border-b border-[#23272E]">
            <div>
              <h2 className="text-sm font-bold text-[#E8EAEE] flex items-center gap-1.5">
                <BarChart3 className="w-4 h-4 text-[#EA580C]" />
                Mod Distribution by Category
              </h2>
              <p className="text-[11px] text-[#6B7480]">
                Categorical allocation of mods in{' '}
                <span className="text-[#EA580C] font-semibold">{currentProfile.name}</span>
              </p>
            </div>

            {/* Scope & Sort controls */}
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-[#0E1013] border border-[#23272E] rounded p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setCategoryViewScope('profile')}
                  className={`px-2 py-0.5 rounded cursor-pointer ${
                    categoryViewScope === 'profile'
                      ? 'bg-[#EA580C] text-white font-semibold'
                      : 'text-[#9AA3AF] hover:text-[#E8EAEE]'
                  }`}
                  title="Show only active mods in current profile"
                >
                  Active
                </button>
                <button
                  type="button"
                  onClick={() => setCategoryViewScope('all')}
                  className={`px-2 py-0.5 rounded cursor-pointer ${
                    categoryViewScope === 'all'
                      ? 'bg-[#EA580C] text-white font-semibold'
                      : 'text-[#9AA3AF] hover:text-[#E8EAEE]'
                  }`}
                  title="Show all installed mods"
                >
                  All
                </button>
              </div>

              <button
                type="button"
                onClick={() => setCategorySortBy(categorySortBy === 'count' ? 'name' : 'count')}
                className="text-[11px] bg-[#20252D] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-[#E8EAEE] px-2 py-0.5 rounded border border-[#23272E] cursor-pointer"
                title="Toggle sort by count or name"
              >
                Sort: {categorySortBy === 'count' ? 'Count' : 'A-Z'}
              </button>
            </div>
          </div>

          {/* Bar Chart Container */}
          <div className="w-full h-[280px]">
            {categoryData.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-[#6B7480] text-xs">
                <span>No active categories found for this profile.</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categoryData}
                  margin={{ top: 12, right: 12, left: -20, bottom: 24 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#23272E" vertical={false} />
                  <XAxis
                    dataKey="category"
                    stroke="#6B7480"
                    tick={{ fill: '#9AA3AF', fontSize: 10.5 }}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                  />
                  <YAxis
                    stroke="#6B7480"
                    tick={{ fill: '#9AA3AF', fontSize: 10.5 }}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomBarTooltip />} />
                  <Bar
                    dataKey={categoryViewScope === 'profile' ? 'activeCount' : 'totalInstalledCount'}
                    name="Mod Count"
                    radius={[4, 4, 0, 0]}
                  >
                    {categoryData.map((entry, index) => {
                      const color = CATEGORY_COLORS[entry.category] || DEFAULT_CATEGORY_COLOR;
                      return <Cell key={`cell-${index}`} fill={color} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Category Legend Badges */}
          <div className="mt-3 pt-2 border-t border-[#23272E] flex flex-wrap gap-1.5 max-h-16 overflow-y-auto">
            {categoryData.map((item) => {
              const color = CATEGORY_COLORS[item.category] || DEFAULT_CATEGORY_COLOR;
              const count = categoryViewScope === 'profile' ? item.activeCount : item.totalInstalledCount;
              return (
                <div
                  key={item.category}
                  className="bg-[#0E1013] border border-[#23272E] rounded px-1.5 py-0.5 text-[10.5px] flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-[#E8EAEE] font-medium truncate max-w-[110px]">
                    {item.category}
                  </span>
                  <span className="font-mono text-[#9AA3AF] bg-[#20252D] px-1 rounded text-[10px]">
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Chart 2: Daily Active Mod Count Trends (Line Chart) */}
        <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-4 shadow-sm flex flex-col">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3 pb-2 border-b border-[#23272E]">
            <div>
              <h2 className="text-sm font-bold text-[#E8EAEE] flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-[#EA580C]" />
                Daily Active Mod Count Trends
              </h2>
              <p className="text-[11px] text-[#6B7480]">
                Daily timeline progression for{' '}
                <span className="text-[#EA580C] font-semibold">{currentProfile.name}</span>
              </p>
            </div>

            {/* Time Range Selector */}
            <div className="flex items-center bg-[#0E1013] border border-[#23272E] rounded p-0.5 text-[11px]">
              {(['7d', '14d', '30d'] as TimeRangeOption[]).map((range) => (
                <button
                  key={range}
                  type="button"
                  onClick={() => setTimeRange(range)}
                  className={`px-2 py-0.5 rounded uppercase font-semibold cursor-pointer ${
                    timeRange === range
                      ? 'bg-[#EA580C] text-white shadow-xs'
                      : 'text-[#9AA3AF] hover:text-[#E8EAEE]'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>

          {/* Line Chart Container */}
          <div className="w-full h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={trendData}
                margin={{ top: 12, right: 12, left: -20, bottom: 12 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#23272E" vertical={false} />
                <XAxis
                  dataKey="dateLabel"
                  stroke="#6B7480"
                  tick={{ fill: '#9AA3AF', fontSize: 10.5 }}
                />
                <YAxis
                  stroke="#6B7480"
                  tick={{ fill: '#9AA3AF', fontSize: 10.5 }}
                  allowDecimals={false}
                  domain={[0, (dataMax: number) => Math.max(dataMax + 1, 5)]}
                />
                <Tooltip content={<CustomLineTooltip />} />
                <Legend
                  wrapperStyle={{ paddingTop: '8px', fontSize: '11px' }}
                  iconType="circle"
                />
                <Line
                  type="monotone"
                  dataKey="activeMods"
                  name="Active Mods (Profile)"
                  stroke="#EA580C"
                  strokeWidth={3}
                  dot={{ r: 3.5, fill: '#EA580C', stroke: '#181B20', strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: '#F97316', stroke: '#FFFFFF', strokeWidth: 1.5 }}
                />
                <Line
                  type="stepAfter"
                  dataKey="totalMods"
                  name="Total Installed Mods"
                  stroke="#3A4150"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Trend Summary Footer */}
          <div className="mt-3 pt-2 border-t border-[#23272E] flex items-center justify-between text-xs text-[#9AA3AF]">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-[#EA580C]" />
              <span>
                Span: {trendData[0]?.dateLabel} — {trendData[trendData.length - 1]?.dateLabel}
              </span>
            </div>
            <div className="flex items-center gap-3 font-mono">
              <span>
                Start: <strong className="text-[#E8EAEE]">{trendStartCount}</strong>
              </span>
              <span>
                Current: <strong className="text-[#EA580C]">{trendEndCount}</strong>
              </span>
              <span
                className={`font-semibold ${
                  netChange >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
                }`}
              >
                Net: {netChange >= 0 ? `+${netChange}` : netChange}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Profile Active Mod List Breakdown Table */}
      <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#23272E]">
          <div>
            <h3 className="text-sm font-bold text-[#E8EAEE] flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-[#EA580C]" />
              Active Loadout Manifest ({activeProfileMods.length} Mods)
            </h3>
            <p className="text-[11px] text-[#6B7480]">
              Installed packages activated in profile &quot;{currentProfile.name}&quot;
            </p>
          </div>
          <span className="text-[11px] font-mono text-[#9AA3AF] bg-[#0E1013] border border-[#23272E] px-2 py-0.5 rounded">
            Profile Created: {currentProfile.createdDate || '2026-09-01'}
          </span>
        </div>

        {activeProfileMods.length === 0 ? (
          <div className="py-6 text-center text-xs text-[#6B7480]">
            No mods are active in this profile. Toggle mods on in the Installed Mods tab.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {activeProfileMods.map((mod) => {
              const catColor =
                CATEGORY_COLORS[mod.categoryTitle || 'Core & Frameworks'] || DEFAULT_CATEGORY_COLOR;
              return (
                <div
                  key={mod.id}
                  className="bg-[#121418] border border-[#23272E] rounded p-2 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: catColor }}
                      title={mod.categoryTitle || 'Core & Frameworks'}
                    />
                    <div className="truncate">
                      <p className="text-xs font-semibold text-[#E8EAEE] truncate">{mod.name}</p>
                      <p className="text-[10px] font-mono text-[#6B7480] truncate">{mod.id}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-[10px] font-mono text-[#9AA3AF] bg-[#181B20] px-1 py-0.5 rounded border border-[#23272E]">
                      v{mod.version}
                    </span>
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
