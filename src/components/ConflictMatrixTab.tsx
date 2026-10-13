import React, { useState, useMemo } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  GitFork,
  FileCode,
  Layers,
  ArrowRight,
  Download,
  EyeOff,
  Wrench,
  HelpCircle,
  Puzzle,
  ChevronRight,
  Sparkles,
  Zap,
  ListOrdered,
  Filter,
} from 'lucide-react';
import {
  ConflictMatrixReport,
  InstalledMod,
  FileCollision,
  CircularDependencyCycle,
  MissingPrerequisite,
  FileCollisionType,
} from '../types';

interface ConflictMatrixTabProps {
  installedMods: InstalledMod[];
  conflictReport: ConflictMatrixReport;
  onRefreshReport: () => void;
  onDisableMod: (modId: string) => void;
  onEnableMod: (modId: string) => void;
  onPrioritizeMod: (modId: string, newOrder: number) => void;
  onIgnoreCollision: (collisionId: string) => void;
  onInstallMissingDependency: (forgeModId?: number, modName?: string) => void;
  onAutoFixAll?: () => void;
}

type FilterView = 'all' | 'circular' | 'binary' | 'config' | 'prereq';

export const ConflictMatrixTab: React.FC<ConflictMatrixTabProps> = ({
  installedMods,
  conflictReport,
  onRefreshReport,
  onDisableMod,
  onEnableMod,
  onPrioritizeMod,
  onIgnoreCollision,
  onInstallMissingDependency,
  onAutoFixAll,
}) => {
  const [filterView, setFilterView] = useState<FilterView>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [showLoadOrderDrawer, setShowLoadOrderDrawer] = useState(false);
  const [resolvedNotice, setResolvedNotice] = useState<string | null>(null);

  const modMap = useMemo(() => {
    const map = new Map<string, InstalledMod>();
    for (const m of installedMods) {
      map.set(m.id, m);
    }
    return map;
  }, [installedMods]);

  const filteredCollisions = useMemo(() => {
    return conflictReport.collisions.filter((col) => {
      if (filterView === 'binary' && col.type !== 'CRITICAL_BINARY') return false;
      if (filterView === 'config' && col.type !== 'CONFIG_OVERWRITE') return false;
      if (filterView === 'circular') return false;
      if (filterView === 'prereq') return false;

      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        col.relativePath.toLowerCase().includes(q) ||
        col.details.toLowerCase().includes(q) ||
        col.contenders.some((c) => c.modName.toLowerCase().includes(q))
      );
    });
  }, [conflictReport.collisions, filterView, searchQuery]);

  const filteredCycles = useMemo(() => {
    if (filterView === 'binary' || filterView === 'config' || filterView === 'prereq') return [];
    if (!searchQuery) return conflictReport.cycles;
    const q = searchQuery.toLowerCase();
    return conflictReport.cycles.filter(
      (c) =>
        c.pathRepresentation.toLowerCase().includes(q) ||
        c.modNames.some((n) => n.toLowerCase().includes(q))
    );
  }, [conflictReport.cycles, filterView, searchQuery]);

  const filteredPrereqs = useMemo(() => {
    if (filterView === 'binary' || filterView === 'config' || filterView === 'circular') return [];
    if (!searchQuery) return conflictReport.missingPrerequisites;
    const q = searchQuery.toLowerCase();
    return conflictReport.missingPrerequisites.filter(
      (p) =>
        p.consumerModName.toLowerCase().includes(q) ||
        p.requiredModName.toLowerCase().includes(q)
    );
  }, [conflictReport.missingPrerequisites, filterView, searchQuery]);

  const hasIssues = conflictReport.totalIssuesCount > 0;

  const handleExportDiagnostics = () => {
    const data = {
      matrixVersion: '2.1.0-phase3',
      timestamp: conflictReport.timestamp,
      summary: {
        totalIssues: conflictReport.totalIssuesCount,
        criticalCount: conflictReport.criticalCount,
        warningCount: conflictReport.warningCount,
        circularCount: conflictReport.circularCount,
      },
      cycles: conflictReport.cycles,
      collisions: conflictReport.collisions,
      missingPrerequisites: conflictReport.missingPrerequisites,
      topologicalLoadOrder: conflictReport.topologicalLoadOrder,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blacksite-conflict-matrix-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrioritize = (collision: FileCollision, targetModId: string) => {
    // Elevate target mod load order to lower numerical index (higher priority)
    const targetMod = modMap.get(targetModId);
    if (targetMod) {
      const minCurrent = Math.min(...collision.contenders.map((c) => c.loadOrder ?? 100));
      const newOrder = Math.max(1, minCurrent - 5);
      onPrioritizeMod(targetModId, newOrder);
      setResolvedNotice(`Prioritized ${targetMod.name} (Load order #${newOrder})`);
      setTimeout(() => setResolvedNotice(null), 4000);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto flex flex-col bg-[#121418] text-[#E8EAEE] p-6 space-y-6">
      {/* Top Header Card */}
      <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-5 shadow-lg relative overflow-hidden">
        {/* Glow accent */}
        <div
          className={`absolute top-0 left-0 right-0 h-1 ${
            conflictReport.circularCount > 0
              ? 'bg-purple-500'
              : conflictReport.criticalCount > 0
              ? 'bg-red-500'
              : conflictReport.warningCount > 0
              ? 'bg-amber-500'
              : 'bg-emerald-500'
          }`}
        />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div
                className={`p-2.5 rounded-lg border ${
                  hasIssues
                    ? conflictReport.criticalCount > 0 || conflictReport.circularCount > 0
                      ? 'bg-red-500/10 border-red-500/30 text-red-400'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                }`}
              >
                {hasIssues ? (
                  <ShieldAlert className="w-6 h-6 animate-pulse" />
                ) : (
                  <CheckCircle2 className="w-6 h-6" />
                )}
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  Tactical Conflict Matrix
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#20252D] text-[#9AA3AF] border border-[#2D333B]">
                    Tarjan SCC + VPI VFS
                  </span>
                </h1>
                <p className="text-xs text-[#9AA3AF] mt-0.5">
                  Real-time dependency loop detection, BepInEx binary collisions, and semantic config protection.
                </p>
              </div>
            </div>

            {/* Quick Badges Bar */}
            <div className="flex flex-wrap items-center gap-2 mt-4">
              {conflictReport.circularCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30">
                  <GitFork className="w-3.5 h-3.5" />
                  {conflictReport.circularCount} Circular Loop{conflictReport.circularCount > 1 ? 's' : ''}
                </span>
              )}
              {conflictReport.criticalCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-red-500/15 text-red-300 border border-red-500/30">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  {conflictReport.criticalCount} Critical
                </span>
              )}
              {conflictReport.warningCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {conflictReport.warningCount} Warning{conflictReport.warningCount > 1 ? 's' : ''}
                </span>
              )}
              {conflictReport.totalIssuesCount === 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Loadout Pristine — 0 Collisions
                </span>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onRefreshReport}
              className="px-3.5 py-2 text-xs font-medium rounded-lg bg-[#20252D] hover:bg-[#2A303C] text-[#E8EAEE] border border-[#2D333B] flex items-center gap-2 transition-colors cursor-pointer"
              title="Re-run Tarjan SCC and Virtual Path scan"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Re-Scan</span>
            </button>

            <button
              onClick={() => setShowLoadOrderDrawer(!showLoadOrderDrawer)}
              className="px-3.5 py-2 text-xs font-medium rounded-lg bg-[#20252D] hover:bg-[#2A303C] text-[#E8EAEE] border border-[#2D333B] flex items-center gap-2 transition-colors cursor-pointer"
            >
              <ListOrdered className="w-3.5 h-3.5 text-[#EA580C]" />
              <span>Load Sequence ({conflictReport.topologicalLoadOrder.length})</span>
            </button>

            {onAutoFixAll && hasIssues && (
              <button
                onClick={onAutoFixAll}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#EA580C] hover:bg-[#F97316] text-white flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Auto-Fix Safe</span>
              </button>
            )}

            <button
              onClick={handleExportDiagnostics}
              className="p-2 text-xs rounded-lg bg-[#20252D] hover:bg-[#2A303C] text-[#9AA3AF] hover:text-[#E8EAEE] border border-[#2D333B] transition-colors cursor-pointer"
              title="Export diagnostic report"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>

        {resolvedNotice && (
          <div className="mt-3 py-1.5 px-3 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>{resolvedNotice}</span>
          </div>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#181B20] border border-[#23272E] rounded-lg p-2.5">
        <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
          <button
            onClick={() => setFilterView('all')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              filterView === 'all'
                ? 'bg-[#EA580C] text-white font-semibold'
                : 'text-[#9AA3AF] hover:text-[#E8EAEE] hover:bg-[#20252D]'
            }`}
          >
            All Issues ({conflictReport.totalIssuesCount})
          </button>
          <button
            onClick={() => setFilterView('circular')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              filterView === 'circular'
                ? 'bg-[#EA580C] text-white font-semibold'
                : 'text-[#9AA3AF] hover:text-[#E8EAEE] hover:bg-[#20252D]'
            }`}
          >
            Circular Loops ({conflictReport.circularCount})
          </button>
          <button
            onClick={() => setFilterView('binary')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              filterView === 'binary'
                ? 'bg-[#EA580C] text-white font-semibold'
                : 'text-[#9AA3AF] hover:text-[#E8EAEE] hover:bg-[#20252D]'
            }`}
          >
            DLL Collisions ({conflictReport.collisions.filter((c) => c.type === 'CRITICAL_BINARY').length})
          </button>
          <button
            onClick={() => setFilterView('config')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              filterView === 'config'
                ? 'bg-[#EA580C] text-white font-semibold'
                : 'text-[#9AA3AF] hover:text-[#E8EAEE] hover:bg-[#20252D]'
            }`}
          >
            Config Overwrites ({conflictReport.collisions.filter((c) => c.type === 'CONFIG_OVERWRITE').length})
          </button>
          <button
            onClick={() => setFilterView('prereq')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              filterView === 'prereq'
                ? 'bg-[#EA580C] text-white font-semibold'
                : 'text-[#9AA3AF] hover:text-[#E8EAEE] hover:bg-[#20252D]'
            }`}
          >
            Missing Prerequisites ({conflictReport.missingPrerequisites.length})
          </button>
        </div>

        <div className="w-full sm:w-64">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conflicts or mods..."
            className="w-full bg-[#121418] border border-[#2D333B] rounded-md px-3 py-1.5 text-xs text-[#E8EAEE] placeholder-[#6E7681] focus:outline-none focus:border-[#EA580C]"
          />
        </div>
      </div>

      {/* Kahn's Topological Load Order Drawer */}
      {showLoadOrderDrawer && (
        <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-5 shadow-lg space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ListOrdered className="w-4 h-4 text-[#EA580C]" />
              <h2 className="text-sm font-semibold text-white">
                Kahn's Topological Load Sequencing Order
              </h2>
            </div>
            <span className="text-[11px] text-[#9AA3AF]">
              {conflictReport.hasCycle ? (
                <span className="text-red-400 font-semibold">Partial (Cycles Detected)</span>
              ) : (
                <span className="text-emerald-400 font-semibold">Strict Acyclic Order Validated</span>
              )}
            </span>
          </div>

          <p className="text-xs text-[#9AA3AF]">
            Computed deterministic load sequence for SPT Server and BepInEx plugin lifecycle. Mods with zero inbound dependencies execute first.
          </p>

          <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-2 bg-[#121418] rounded-lg border border-[#23272E]">
            {conflictReport.topologicalLoadOrder.map((modId, idx) => {
              const mod = modMap.get(modId);
              return (
                <span
                  key={modId}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#20252D] text-xs text-[#E8EAEE] border border-[#2D333B]"
                >
                  <span className="text-[10px] font-mono text-[#EA580C]">#{idx + 1}</span>
                  <span className="font-medium">{mod?.name || modId}</span>
                  <span className="text-[10px] text-[#6E7681]">v{mod?.version || '1.0'}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* 1. Circular Dependency Loops Section */}
      {filteredCycles.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <GitFork className="w-4 h-4 text-purple-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-purple-300">
              Circular Dependency Loops ({filteredCycles.length})
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {filteredCycles.map((cycle) => (
              <div
                key={cycle.cycleId}
                className="bg-[#181B20] border border-purple-500/30 rounded-xl p-4 shadow-md hover:border-purple-500/50 transition-colors"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                        DEADLOCK HAZARD
                      </span>
                      <span className="text-xs font-semibold text-white">
                        {cycle.modNames.length}-Mod Cyclic Dependency
                      </span>
                    </div>

                    {/* Cycle Flow Diagram */}
                    <div className="mt-3 p-3 bg-[#121418] rounded-lg border border-[#23272E] font-mono text-xs text-purple-200 overflow-x-auto whitespace-nowrap">
                      {cycle.pathRepresentation}
                    </div>

                    <p className="text-xs text-[#9AA3AF] mt-2">
                      {cycle.description}
                    </p>
                  </div>

                  {/* Recommendations */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                    <button
                      onClick={() => onDisableMod(cycle.breakRecommendation.targetModId)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                      <span>Break Loop: Disable {cycle.breakRecommendation.targetModName}</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. File & DLL Collisions Section */}
      {filteredCollisions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#EA580C]" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#EA580C]">
              File & Binary Collisions ({filteredCollisions.length})
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {filteredCollisions.map((collision) => (
              <div
                key={collision.collisionId}
                className={`bg-[#181B20] border rounded-xl p-4 shadow-md transition-colors ${
                  collision.severity === 'critical'
                    ? 'border-red-500/30 hover:border-red-500/50'
                    : 'border-amber-500/30 hover:border-amber-500/50'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                          collision.type === 'CRITICAL_BINARY'
                            ? 'bg-red-500/20 text-red-300 border-red-500/30'
                            : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                        }`}
                      >
                        {collision.type === 'CRITICAL_BINARY' ? 'CRITICAL BINARY' : 'CONFIG OVERWRITE'}
                      </span>
                      <span className="font-mono text-xs text-white font-semibold">
                        {collision.relativePath}
                      </span>
                    </div>

                    <p className="text-xs text-[#9AA3AF]">{collision.details}</p>

                    {/* Contending Mods Cards */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {collision.contenders.map((contender, idx) => {
                        const mod = modMap.get(contender.modId);
                        return (
                          <div
                            key={contender.modId}
                            className="p-2.5 bg-[#121418] border border-[#23272E] rounded-lg text-xs flex items-center gap-3"
                          >
                            <div>
                              <div className="font-semibold text-white flex items-center gap-1.5">
                                <span>{contender.modName}</span>
                                <span className="text-[10px] text-[#6E7681]">v{contender.version}</span>
                              </div>
                              <div className="text-[11px] text-[#9AA3AF] flex items-center gap-2 mt-0.5">
                                <span>Order #{contender.loadOrder ?? idx + 1}</span>
                                {mod?.author && <span>by {mod.author}</span>}
                              </div>
                            </div>

                            {/* Individual Mod Action */}
                            <button
                              onClick={() => handlePrioritize(collision, contender.modId)}
                              className="px-2 py-1 text-[11px] font-medium rounded bg-[#20252D] hover:bg-[#2A303C] text-[#EA580C] border border-[#2D333B] transition-colors cursor-pointer"
                              title="Set as higher priority in load sequence"
                            >
                              Prioritize
                            </button>

                            <button
                              onClick={() => onDisableMod(contender.modId)}
                              className="px-2 py-1 text-[11px] font-medium rounded bg-[#20252D] hover:bg-red-900/30 text-[#9AA3AF] hover:text-red-300 border border-[#2D333B] transition-colors cursor-pointer"
                              title="Disable this mod"
                            >
                              Disable
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                    <button
                      onClick={() => onIgnoreCollision(collision.collisionId)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#20252D] hover:bg-[#2A303C] text-[#9AA3AF] hover:text-[#E8EAEE] border border-[#2D333B] transition-colors cursor-pointer"
                    >
                      Ignore Collision
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Missing Prerequisites Section */}
      {filteredPrereqs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Puzzle className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-sky-300">
              Missing Prerequisites & Addon Dependencies ({filteredPrereqs.length})
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {filteredPrereqs.map((prereq) => (
              <div
                key={prereq.id}
                className="bg-[#181B20] border border-sky-500/30 rounded-xl p-4 shadow-md hover:border-sky-500/50 transition-colors"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                        {prereq.isInstalledButDisabled ? 'PREREQUISITE DISABLED' : 'PREREQUISITE MISSING'}
                      </span>
                      <span className="text-xs font-semibold text-white">
                        {prereq.requiredModName}
                      </span>
                    </div>

                    <p className="text-xs text-[#9AA3AF]">
                      Required by active mod{' '}
                      <span className="text-white font-medium">{prereq.consumerModName}</span>.
                      {prereq.isInstalledButDisabled
                        ? ' This mod is installed on your disk, but currently disabled.'
                        : ' This mod is not present in your SPT library.'}
                    </p>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    {prereq.isInstalledButDisabled ? (
                      <button
                        onClick={() => onEnableMod(prereq.requiredModId)}
                        className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>Enable {prereq.requiredModName}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() =>
                          onInstallMissingDependency(prereq.forgeModId, prereq.requiredModName)
                        }
                        className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-[#EA580C] hover:bg-[#F97316] text-white transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>1-Click Install from Forge</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pristine Empty State */}
      {!hasIssues && (
        <div className="py-16 flex flex-col items-center justify-center text-center space-y-4 bg-[#181B20] border border-[#23272E] rounded-xl p-8">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-white">All Systems Operational</h3>
            <p className="text-xs text-[#9AA3AF] max-w-md">
              No circular dependencies, DLL entrypoint collisions, or unfulfilled prerequisites detected. Your active loadout is validated and ready for deployment.
            </p>
          </div>
          <button
            onClick={onRefreshReport}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-[#20252D] hover:bg-[#2A303C] text-[#E8EAEE] border border-[#2D333B] transition-colors cursor-pointer flex items-center gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Re-verify Loadout</span>
          </button>
        </div>
      )}
    </div>
  );
};
