import React, { useState, useMemo } from 'react';
import {
  X,
  AlertTriangle,
  EyeOff,
  Eye,
  CheckCircle2,
  Network,
  ListTree,
  FileCode,
  ShieldAlert,
  Layers,
  ArrowRight,
  Info,
  Check,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { ConflictInfo, InstalledMod } from '../types';

interface ConflictResolverModalProps {
  conflict: ConflictInfo | null;
  installedMods: InstalledMod[];
  isOpen: boolean;
  onClose: () => void;
  onDisableMod: (modId: string) => void;
  onIgnoreConflict: (conflictId: string) => void;
}

type ModalTab = 'graph' | 'tree' | 'files';

interface DependencyNode {
  id: string;
  name: string;
  author: string;
  version: string;
  loadOrder?: number;
  isDisabled: boolean;
  isConflicting: boolean;
  isCoreRoot: boolean;
  isDirectDep: boolean;
  isIndirectDep: boolean;
  directDeps: string[];
  allAncestors: string[];
  directDependents: string[];
  transitiveDependents: string[];
  depth: number;
}

export const ConflictResolverModal: React.FC<ConflictResolverModalProps> = ({
  conflict,
  installedMods,
  isOpen,
  onClose,
  onDisableMod,
  onIgnoreConflict,
}) => {
  const [activeTab, setActiveTab] = useState<ModalTab>('graph');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Build the dependency and cascade analysis graph
  const analysis = useMemo(() => {
    if (!conflict) return null;

    const modMap = new Map<string, InstalledMod>();
    installedMods.forEach((m) => modMap.set(m.id, m));

    // Fallback known dependency relationships if not explicitly specified
    const getModDependencies = (modId: string): string[] => {
      const mod = modMap.get(modId);
      if (mod?.dependencies && mod.dependencies.length > 0) {
        return mod.dependencies.filter((depId) => modMap.has(depId));
      }
      if (modId === 'me.sol.sain') return ['xyz.drakia.bigbrain'];
      if (modId === 'me.sol.sain.legacy-patch') return ['xyz.drakia.bigbrain', 'me.sol.sain'];
      if (modId === 'xyz.drakia.questingbots') return ['xyz.drakia.bigbrain', 'me.sol.sain'];
      if (modId === 'xyz.drakia.lootingbots') return ['xyz.drakia.bigbrain'];
      if (modId === 'xyz.drakia.waypoints') return ['xyz.drakia.bigbrain'];
      return [];
    };

    // Gather all relevant mods in the conflict orbit
    // Start with conflicting mod IDs, then gather all upstream ancestors & downstream dependents
    const relevantIds = new Set<string>(conflict.conflictingModIds);

    // Collect upstream ancestors
    const queue = [...conflict.conflictingModIds];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const deps = getModDependencies(current);
      deps.forEach((dep) => {
        if (!relevantIds.has(dep)) {
          relevantIds.add(dep);
          queue.push(dep);
        }
      });
    }

    // Collect downstream dependents from installedMods
    installedMods.forEach((mod) => {
      const deps = getModDependencies(mod.id);
      if (deps.some((d) => relevantIds.has(d))) {
        relevantIds.add(mod.id);
      }
    });

    // Build raw graph nodes
    const nodeMap = new Map<string, DependencyNode>();

    relevantIds.forEach((id) => {
      const mod = modMap.get(id);
      const isConflicting = conflict.conflictingModIds.includes(id);
      const directDeps = getModDependencies(id);

      nodeMap.set(id, {
        id,
        name: mod?.name || id,
        author: mod?.author || 'Unknown',
        version: mod?.version || '1.0.0',
        loadOrder: mod?.loadOrder,
        isDisabled: Boolean(mod?.isDisabled),
        isConflicting,
        isCoreRoot: directDeps.length === 0,
        isDirectDep: false,
        isIndirectDep: false,
        directDeps,
        allAncestors: [],
        directDependents: [],
        transitiveDependents: [],
        depth: 0,
      });
    });

    // Calculate direct and transitive dependents
    nodeMap.forEach((node) => {
      node.directDeps.forEach((depId) => {
        const depNode = nodeMap.get(depId);
        if (depNode && !depNode.directDependents.includes(node.id)) {
          depNode.directDependents.push(node.id);
        }
      });
    });

    // Helper for transitive dependents
    const getTransitiveDependents = (startId: string): string[] => {
      const visited = new Set<string>();
      const q = [startId];
      while (q.length > 0) {
        const curr = q.shift()!;
        const currNode = nodeMap.get(curr);
        if (currNode) {
          currNode.directDependents.forEach((depId) => {
            if (!visited.has(depId)) {
              visited.add(depId);
              q.push(depId);
            }
          });
        }
      }
      return Array.from(visited);
    };

    // Helper for transitive ancestors
    const getTransitiveAncestors = (startId: string): string[] => {
      const visited = new Set<string>();
      const q = [startId];
      while (q.length > 0) {
        const curr = q.shift()!;
        const currNode = nodeMap.get(curr);
        if (currNode) {
          currNode.directDeps.forEach((ancId) => {
            if (!visited.has(ancId)) {
              visited.add(ancId);
              q.push(ancId);
            }
          });
        }
      }
      return Array.from(visited);
    };

    // Compute depths and classify
    nodeMap.forEach((node) => {
      node.transitiveDependents = getTransitiveDependents(node.id);
      node.allAncestors = getTransitiveAncestors(node.id);
      node.depth = node.allAncestors.length;

      if (node.isConflicting) {
        // keep as conflict
      } else if (node.allAncestors.length === 0 && node.directDependents.length > 0) {
        node.isCoreRoot = true;
      } else if (node.allAncestors.length === 1) {
        node.isDirectDep = true;
      } else {
        node.isIndirectDep = true;
      }
    });

    const nodes = Array.from(nodeMap.values()).sort((a, b) => a.depth - b.depth);

    // Identify Root Core Mod (the root mod with the highest cascade impact)
    const coreRootNode = [...nodes]
      .filter((n) => n.isCoreRoot || n.depth === 0)
      .sort((a, b) => b.transitiveDependents.length - a.transitiveDependents.length)[0];

    // Identify the safest conflicting mod to disable (the conflicting leaf with 0 or fewest dependents)
    const safeConflictingMod = [...nodes]
      .filter((n) => n.isConflicting)
      .sort((a, b) => a.transitiveDependents.length - b.transitiveDependents.length)[0];

    return {
      nodes,
      nodeMap,
      coreRootNode,
      safeConflictingMod,
    };
  }, [conflict, installedMods]);

  if (!isOpen || !conflict || !analysis) return null;

  const { nodes, nodeMap, coreRootNode, safeConflictingMod } = analysis;

  // Selected or default active node
  const activeNode = selectedNodeId
    ? nodeMap.get(selectedNodeId) || nodes[0]
    : nodes.find((n) => n.isConflicting) || nodes[0];

  // Group nodes by depth level for visual graph layout
  const maxDepth = Math.max(...nodes.map((n) => n.depth), 0);
  const tiers: DependencyNode[][] = [];
  for (let d = 0; d <= maxDepth; d++) {
    tiers.push(nodes.filter((n) => n.depth === d));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-fade-in">
      <div className="bg-[#14161A] border border-[#F59E0B]/50 rounded-xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-xs">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#23272E] bg-[#1E1911] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#3A2A10] border border-[#F59E0B] flex items-center justify-center">
              <ShieldAlert className="w-4 h-4 text-[#F59E0B]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[#F59E0B]">Conflict & Dependency Resolver</h2>
                <span className="bg-[#2A1E0D] border border-[#F59E0B]/40 text-[#F59E0B] font-mono text-[10.5px] px-2 py-0.5 rounded-full font-semibold">
                  {conflict.itemType === 'dll' ? 'Duplicate DLL Collision' : 'Duplicate Package ID'}
                </span>
              </div>
              <p className="text-[11.5px] text-[#9AA3AF] mt-0.5">
                Cascade analysis between conflicting mods and shared root dependencies
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-[#9AA3AF] hover:text-white p-1.5 hover:bg-[#20252D] rounded-lg transition-colors cursor-pointer"
            type="button"
            title="Close resolver"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cascade Diagnostics & Recommendation Banner */}
        <div className="bg-[#181B20] border-b border-[#23272E] px-5 py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-start gap-2.5 max-w-xl">
            <Sparkles className="w-4 h-4 text-[#EA580C] shrink-0 mt-0.5" />
            <div>
              <span className="text-xs font-bold text-[#E8EAEE] block">
                Cascade Risk Diagnosis:
              </span>
              <p className="text-[11px] text-[#9AA3AF] leading-relaxed">
                {coreRootNode && coreRootNode.transitiveDependents.length > 0 ? (
                  <>
                    <strong className="text-[#E8EAEE]">{coreRootNode.name}</strong> is a core root
                    mod with{' '}
                    <strong className="text-[#EA580C]">
                      {coreRootNode.transitiveDependents.length} downstream dependent mods
                    </strong>
                    . Disabling it will cause a wide cascade failure.
                  </>
                ) : (
                  <>No deep cascade detected. Mods operate with independent dependency trees.</>
                )}
                {safeConflictingMod && (
                  <span className="text-[#22C55E] block font-medium mt-0.5">
                    Recommended Fix: Disable{' '}
                    <span className="underline font-bold">{safeConflictingMod.name}</span> (safe
                    leaf mod with 0 downstream dependents).
                  </span>
                )}
              </p>
            </div>
          </div>

          {safeConflictingMod && !safeConflictingMod.isDisabled && (
            <button
              onClick={() => onDisableMod(safeConflictingMod.id)}
              className="bg-[#EA580C] hover:bg-[#F97316] text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-md shrink-0"
              title={`Safely disable ${safeConflictingMod.name} to resolve the collision`}
              type="button"
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span>Safe Fix: Disable {safeConflictingMod.name}</span>
            </button>
          )}
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center gap-1 px-5 pt-3 border-b border-[#23272E] bg-[#121418]">
          <button
            onClick={() => setActiveTab('graph')}
            className={`px-3 py-2 font-semibold text-xs border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'graph'
                ? 'text-[#EA580C] border-[#EA580C] bg-[#1A1D23]/50'
                : 'text-[#9AA3AF] hover:text-[#E8EAEE] border-transparent'
            }`}
            type="button"
          >
            <Network className="w-3.5 h-3.5" />
            <span>Dependency Graph</span>
            <span className="bg-[#20252D] text-[#9AA3AF] text-[10px] px-1.5 py-0.2 rounded-full font-mono">
              {nodes.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('tree')}
            className={`px-3 py-2 font-semibold text-xs border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'tree'
                ? 'text-[#EA580C] border-[#EA580C] bg-[#1A1D23]/50'
                : 'text-[#9AA3AF] hover:text-[#E8EAEE] border-transparent'
            }`}
            type="button"
          >
            <ListTree className="w-3.5 h-3.5" />
            <span>Cascade Tree</span>
          </button>

          <button
            onClick={() => setActiveTab('files')}
            className={`px-3 py-2 font-semibold text-xs border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'files'
                ? 'text-[#EA580C] border-[#EA580C] bg-[#1A1D23]/50'
                : 'text-[#9AA3AF] hover:text-[#E8EAEE] border-transparent'
            }`}
            type="button"
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Colliding Assets & Details</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-5 bg-[#0E1013]">
          {/* TAB 1: VISUAL DEPENDENCY GRAPH */}
          {activeTab === 'graph' && (
            <div className="space-y-4">
              {/* Legend & Guide */}
              <div className="flex items-center justify-between flex-wrap gap-2 bg-[#181B20] p-2.5 rounded-lg border border-[#23272E] text-[11px]">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#8B5CF6]" />
                    <span className="text-[#9AA3AF]">Core Root Mod</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#3B82F6]" />
                    <span className="text-[#9AA3AF]">Direct Dependency</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#EF4444] animate-pulse" />
                    <span className="text-[#EF4444] font-semibold">Conflicting Mod</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 h-0.5 bg-[#EA580C] border-b border-dashed border-[#EA580C]" />
                    <span className="text-[#EA580C]">Collision Link</span>
                  </div>
                </div>
                <span className="text-[#6B7480] text-[10.5px]">
                  Click any node to inspect cascade impact & upstream lineage
                </span>
              </div>

              {/* Visual Tiers Container */}
              <div className="bg-[#121418] border border-[#23272E] rounded-xl p-5 relative overflow-x-auto shadow-inner">
                {/* SVG Connecting Curves */}
                <div className="flex flex-col gap-8 min-w-[620px]">
                  {tiers.map((tierNodes, tierIdx) => (
                    <div key={tierIdx} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-[#6B7480] bg-[#1A1D23] px-2 py-0.5 rounded">
                          {tierIdx === 0
                            ? 'Level 0 · Core Foundation / Root Mods'
                            : tierIdx === 1
                            ? 'Level 1 · Direct Dependencies'
                            : `Level ${tierIdx} · Downstream Dependents & Overrides`}
                        </span>
                        <div className="flex-1 h-px bg-[#20252D]" />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {tierNodes.map((node) => {
                          const isSelected = activeNode?.id === node.id;
                          const isSafeToDisable =
                            safeConflictingMod?.id === node.id && node.isConflicting;

                          return (
                            <div
                              key={node.id}
                              onClick={() => setSelectedNodeId(node.id)}
                              className={`p-3 rounded-lg border transition-all cursor-pointer relative select-none ${
                                isSelected
                                  ? 'ring-2 ring-[#EA580C] shadow-lg'
                                  : 'hover:border-[#3A4150]'
                              } ${
                                node.isConflicting
                                  ? 'bg-[#221313] border-[#EF4444]/60'
                                  : node.isCoreRoot
                                  ? 'bg-[#191528] border-[#8B5CF6]/50'
                                  : 'bg-[#151922] border-[#3B82F6]/40'
                              } ${node.isDisabled ? 'opacity-60 grayscale' : ''}`}
                            >
                              {/* Top Bar: Badges */}
                              <div className="flex items-center justify-between gap-1 mb-1.5">
                                <div className="flex items-center gap-1.5">
                                  {node.isConflicting && (
                                    <span className="bg-[#EF4444]/20 border border-[#EF4444]/50 text-[#EF4444] text-[9.5px] font-bold px-1.5 py-0.2 rounded flex items-center gap-0.5">
                                      <AlertTriangle className="w-2.5 h-2.5" />
                                      CONFLICT
                                    </span>
                                  )}
                                  {node.isCoreRoot && (
                                    <span className="bg-[#8B5CF6]/20 border border-[#8B5CF6]/50 text-[#A78BFA] text-[9.5px] font-bold px-1.5 py-0.2 rounded">
                                      CORE ROOT
                                    </span>
                                  )}
                                  {!node.isConflicting && !node.isCoreRoot && (
                                    <span className="bg-[#3B82F6]/20 border border-[#3B82F6]/50 text-[#60A5FA] text-[9.5px] font-semibold px-1.5 py-0.2 rounded">
                                      {node.isDirectDep ? 'DIRECT DEP' : 'INDIRECT DEP'}
                                    </span>
                                  )}
                                </div>

                                {typeof node.loadOrder === 'number' && (
                                  <span className="text-[10px] font-mono text-[#9AA3AF]">
                                    Order #{node.loadOrder}
                                  </span>
                                )}
                              </div>

                              {/* Title & Author */}
                              <h4
                                className="text-sm font-bold text-[#E8EAEE] truncate tracking-tight"
                                title={node.name}
                              >
                                {node.name}
                              </h4>
                              <p className="font-mono text-[10.5px] text-[#6B7480] truncate mt-0.5">
                                {node.id}
                              </p>

                              {/* Cascade metrics */}
                              <div className="mt-2 pt-2 border-t border-[#23272E]/70 flex items-center justify-between text-[10.5px]">
                                <span
                                  className={
                                    node.transitiveDependents.length > 0
                                      ? 'text-[#F59E0B] font-semibold'
                                      : 'text-[#9AA3AF]'
                                  }
                                >
                                  {node.transitiveDependents.length > 0
                                    ? `Cascade Risk: ${node.transitiveDependents.length} mods`
                                    : 'Leaf Mod (0 dependents)'}
                                </span>

                                <span
                                  className={`px-1.5 py-0.2 rounded font-semibold text-[9.5px] ${
                                    node.isDisabled
                                      ? 'bg-[#2A1515] text-[#EF4444]'
                                      : 'bg-[#15281B] text-[#22C55E]'
                                  }`}
                                >
                                  {node.isDisabled ? 'Disabled' : 'Active'}
                                </span>
                              </div>

                              {/* Quick Action Button */}
                              <div className="mt-2 pt-1 flex items-center justify-between">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDisableMod(node.id);
                                  }}
                                  className={`w-full py-1 rounded text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                                    isSafeToDisable
                                      ? 'bg-[#EA580C] hover:bg-[#F97316] text-white shadow'
                                      : node.isDisabled
                                      ? 'bg-[#20252D] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-[#E8EAEE]'
                                      : 'bg-[#20252D] hover:bg-[#DC2626] text-[#E8EAEE]'
                                  }`}
                                >
                                  <EyeOff className="w-3 h-3" />
                                  <span>{node.isDisabled ? 'Re-Enable' : 'Disable Mod'}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Node Inspector Drawer */}
              {activeNode && (
                <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-3.5 text-xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-[#E8EAEE]">{activeNode.name}</span>
                      <span className="font-mono text-[#6B7480] text-[11px]">
                        ({activeNode.id})
                      </span>
                    </div>
                    <span className="text-[11px] text-[#9AA3AF]">
                      Installed Version: v{activeNode.version}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11.5px]">
                    {/* Upstream ancestors */}
                    <div className="bg-[#121418] p-2.5 rounded border border-[#20252D]">
                      <span className="text-[#9AA3AF] font-bold block mb-1">
                        Upstream Dependencies ({activeNode.directDeps.length}):
                      </span>
                      {activeNode.directDeps.length === 0 ? (
                        <span className="text-[#6B7480] italic">
                          None (Independent / Core Root Mod)
                        </span>
                      ) : (
                        <div className="space-y-1">
                          {activeNode.directDeps.map((depId) => {
                            const dep = nodeMap.get(depId);
                            return (
                              <div
                                key={depId}
                                className="flex items-center gap-1.5 text-[#60A5FA]"
                              >
                                <ArrowRight className="w-3 h-3 shrink-0" />
                                <span className="font-medium">{dep?.name || depId}</span>
                                <span className="text-[10px] text-[#6B7480] font-mono">
                                  ({depId})
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Downstream cascade impact */}
                    <div className="bg-[#121418] p-2.5 rounded border border-[#20252D]">
                      <span className="text-[#9AA3AF] font-bold block mb-1">
                        Downstream Dependents at Risk (
                        {activeNode.transitiveDependents.length}):
                      </span>
                      {activeNode.transitiveDependents.length === 0 ? (
                        <span className="text-[#22C55E] font-medium">
                          Safe to disable: No other mods depend on this package.
                        </span>
                      ) : (
                        <div className="space-y-1">
                          {activeNode.transitiveDependents.map((depId) => {
                            const dep = nodeMap.get(depId);
                            return (
                              <div
                                key={depId}
                                className="flex items-center gap-1.5 text-[#F59E0B]"
                              >
                                <AlertTriangle className="w-3 h-3 shrink-0 text-[#F59E0B]" />
                                <span className="font-medium">{dep?.name || depId}</span>
                                <span className="text-[10px] text-[#6B7480] font-mono">
                                  ({depId})
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: CASCADE TREE VIEW */}
          {activeTab === 'tree' && (
            <div className="space-y-3">
              <div className="bg-[#181B20] p-3 rounded-lg border border-[#23272E] text-xs">
                <span className="font-bold text-[#E8EAEE] block mb-1">
                  Hierarchical Dependency & Conflict Tree:
                </span>
                <p className="text-[11px] text-[#9AA3AF]">
                  View upstream roots at the top level and downstream dependents nested beneath
                  them. Red nodes highlight collision points.
                </p>
              </div>

              <div className="bg-[#121418] border border-[#23272E] rounded-xl p-4 font-sans text-xs space-y-2">
                {nodes
                  .filter((n) => n.isCoreRoot || n.depth === 0)
                  .map((rootNode) => (
                    <div key={rootNode.id} className="space-y-2">
                      {/* Root node */}
                      <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#191528] border border-[#8B5CF6]/50">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#8B5CF6]" />
                          <span className="font-bold text-sm text-[#E8EAEE]">
                            {rootNode.name}
                          </span>
                          <span className="bg-[#8B5CF6]/20 text-[#A78BFA] text-[9.5px] px-1.5 py-0.2 rounded font-mono font-semibold">
                            Core Root
                          </span>
                          <span className="text-[#9AA3AF] text-[10.5px]">
                            ({rootNode.transitiveDependents.length} downstream dependents)
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => onDisableMod(rootNode.id)}
                          className="bg-[#20252D] hover:bg-[#DC2626] text-[#9AA3AF] hover:text-white px-2 py-1 rounded text-[11px] font-semibold cursor-pointer transition-colors"
                        >
                          {rootNode.isDisabled ? 'Re-Enable' : 'Disable'}
                        </button>
                      </div>

                      {/* Direct & indirect children */}
                      <div className="pl-6 border-l-2 border-[#23272E] ml-3 space-y-2">
                        {rootNode.directDependents.map((childId) => {
                          const child = nodeMap.get(childId);
                          if (!child) return null;

                          return (
                            <div key={child.id} className="space-y-2">
                              <div
                                className={`flex items-center justify-between p-2.5 rounded-lg border ${
                                  child.isConflicting
                                    ? 'bg-[#221313] border-[#EF4444]/60'
                                    : 'bg-[#151922] border-[#3B82F6]/40'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <ChevronRight className="w-3.5 h-3.5 text-[#6B7480]" />
                                  <span className="font-bold text-[#E8EAEE]">{child.name}</span>
                                  {child.isConflicting ? (
                                    <span className="bg-[#EF4444]/20 text-[#EF4444] text-[9.5px] px-1.5 py-0.2 rounded font-semibold flex items-center gap-0.5">
                                      <AlertTriangle className="w-2.5 h-2.5" />
                                      COLLISION
                                    </span>
                                  ) : (
                                    <span className="bg-[#3B82F6]/20 text-[#60A5FA] text-[9.5px] px-1.5 py-0.2 rounded font-semibold">
                                      Direct Dependent
                                    </span>
                                  )}
                                </div>

                                <button
                                  type="button"
                                  onClick={() => onDisableMod(child.id)}
                                  className={`px-2 py-1 rounded text-[11px] font-semibold cursor-pointer transition-colors ${
                                    child.isConflicting
                                      ? 'bg-[#EA580C] hover:bg-[#F97316] text-white'
                                      : 'bg-[#20252D] hover:bg-[#DC2626] text-[#9AA3AF] hover:text-white'
                                  }`}
                                >
                                  {child.isDisabled ? 'Re-Enable' : 'Disable'}
                                </button>
                              </div>

                              {/* Nested indirect children */}
                              {child.directDependents.length > 0 && (
                                <div className="pl-6 border-l-2 border-[#23272E] ml-3 space-y-1.5">
                                  {child.directDependents.map((grandId) => {
                                    const grand = nodeMap.get(grandId);
                                    if (!grand) return null;

                                    return (
                                      <div
                                        key={grand.id}
                                        className={`flex items-center justify-between p-2 rounded-lg border ${
                                          grand.isConflicting
                                            ? 'bg-[#221313] border-[#EF4444]/60'
                                            : 'bg-[#121418] border-[#2A2F38]'
                                        }`}
                                      >
                                        <div className="flex items-center gap-2">
                                          <ChevronRight className="w-3.5 h-3.5 text-[#6B7480]" />
                                          <span className="font-bold text-[#E8EAEE]">
                                            {grand.name}
                                          </span>
                                          {grand.isConflicting && (
                                            <span className="bg-[#EF4444]/20 text-[#EF4444] text-[9.5px] px-1.5 py-0.2 rounded font-semibold">
                                              COLLISION
                                            </span>
                                          )}
                                        </div>

                                        <button
                                          type="button"
                                          onClick={() => onDisableMod(grand.id)}
                                          className="bg-[#EA580C] hover:bg-[#F97316] text-white px-2 py-1 rounded text-[11px] font-semibold cursor-pointer"
                                        >
                                          {grand.isDisabled ? 'Re-Enable' : 'Disable'}
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* TAB 3: ASSET COLLISIONS & DETAILS */}
          {activeTab === 'files' && (
            <div className="space-y-4">
              <div className="bg-[#121418] p-3.5 rounded-lg border border-[#23272E] space-y-1.5 font-mono">
                <span className="text-[#9AA3AF] block font-sans font-semibold">
                  Conflicting Asset / Target:
                </span>
                <span className="text-[#F59E0B] text-sm font-bold block">
                  {conflict.duplicateItem}
                </span>
                <p className="text-[#9AA3AF] font-sans text-xs pt-1">{conflict.details}</p>
              </div>

              <div>
                <span className="font-bold text-[#E8EAEE] block mb-2">
                  Directly Colliding Installed Mods:
                </span>
                <div className="space-y-2">
                  {conflict.conflictingModIds.map((id, index) => {
                    const mod = installedMods.find((m) => m.id === id);
                    const name = mod?.name || conflict.conflictingModNames[index] || id;
                    const node = nodeMap.get(id);

                    return (
                      <div
                        key={id}
                        className="flex items-center justify-between bg-[#121418] p-3.5 rounded-lg border border-[#23272E]"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-[#E8EAEE]">{name}</span>
                            {node?.isCoreRoot && (
                              <span className="bg-[#8B5CF6]/20 text-[#A78BFA] text-[9.5px] px-1.5 py-0.2 rounded font-mono font-semibold">
                                Core Root
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-[#6B7480] text-[11px] block mt-0.5">
                            {id}
                          </span>
                          {node && (
                            <span className="text-[10.5px] text-[#9AA3AF] block mt-1">
                              Upstream deps: {node.directDeps.length} · Downstream cascade:{' '}
                              {node.transitiveDependents.length} mods
                            </span>
                          )}
                        </div>

                        <button
                          onClick={() => onDisableMod(id)}
                          className="bg-[#20252D] hover:bg-[#DC2626] text-[#E8EAEE] px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                          title="Disable this mod to resolve the collision"
                          type="button"
                        >
                          <EyeOff className="w-3.5 h-3.5" />
                          <span>{mod?.isDisabled ? 'Re-Enable' : 'Disable Mod'}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#23272E] bg-[#14161A] flex items-center justify-between">
          <button
            onClick={() => onIgnoreConflict(conflict.id)}
            className="text-[#9AA3AF] hover:text-[#E8EAEE] text-xs underline cursor-pointer"
            type="button"
          >
            Ignore this conflict (don't warn again)
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] text-xs font-semibold px-4 py-2 rounded-lg cursor-pointer transition-colors"
              type="button"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
