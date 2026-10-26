import React from 'react';
import {
  GitFork,
  Layers,
  Download,
  EyeOff,
  Puzzle,
  Zap,
} from 'lucide-react';
import {
  InstalledMod,
  FileCollision,
  CircularDependencyCycle,
  MissingPrerequisite,
} from '../../types';

interface ConflictIssueSectionsProps {
  filteredCycles: CircularDependencyCycle[];
  filteredCollisions: FileCollision[];
  filteredPrereqs: MissingPrerequisite[];
  modMap: Map<string, InstalledMod>;
  onDisableMod: (modId: string) => void;
  onEnableMod: (modId: string) => void;
  onPrioritizeCollisionMod: (collision: FileCollision, targetModId: string) => void;
  onIgnoreCollision: (collisionId: string) => void;
  onInstallMissingDependency: (forgeModId?: number, modName?: string) => void;
}

export const ConflictIssueSections: React.FC<ConflictIssueSectionsProps> = ({
  filteredCycles,
  filteredCollisions,
  filteredPrereqs,
  modMap,
  onDisableMod,
  onEnableMod,
  onPrioritizeCollisionMod,
  onIgnoreCollision,
  onInstallMissingDependency,
}) => {
  return (
    <>
      {/* 1. Circular Dependency Loops Section */}
      {filteredCycles.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <GitFork className="w-4 h-4 text-purple-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-purple-300 tabular-nums">
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
                      <span className="text-xs font-semibold text-white tabular-nums">
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
                      type="button"
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
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#EA580C] tabular-nums">
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
                                <span className="text-[10px] text-[#6E7681] font-mono tabular-nums">
                                  v{contender.version}
                                </span>
                              </div>
                              <div className="text-[11px] text-[#9AA3AF] flex items-center gap-2 mt-0.5 tabular-nums">
                                <span>Order #{contender.loadOrder ?? idx + 1}</span>
                                {mod?.author && <span>by {mod.author}</span>}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => onPrioritizeCollisionMod(collision, contender.modId)}
                              className="px-2 py-1 text-[11px] font-medium rounded bg-[#20252D] hover:bg-[#2A303C] text-[#EA580C] border border-[#2D333B] transition-colors cursor-pointer"
                              title="Set as higher priority in load sequence"
                            >
                              Prioritize
                            </button>

                            <button
                              type="button"
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
                      type="button"
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
            <h2 className="text-sm font-bold uppercase tracking-wider text-sky-300 tabular-nums">
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
                        type="button"
                        onClick={() => onEnableMod(prereq.requiredModId)}
                        className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>Enable {prereq.requiredModName}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
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
    </>
  );
};
