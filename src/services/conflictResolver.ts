import {
  InstalledMod,
  ConflictMatrixReport,
  CircularDependencyCycle,
  FileCollision,
  MissingPrerequisite,
  FileCollisionType,
  FileCollisionContender,
} from '../types';
import { getKnownDependencyMeta } from '../data/knownDependencies';

/**
 * Normalizes mod identifiers for case-insensitive matching across GUID, disk IDs, and names.
 */
function normalizeIdentifier(raw: string): string {
  return (raw || '').trim().toLowerCase();
}

/**
 * Extracts default known dependencies if not explicitly declared in manifest
 */
function resolveModDependencies(mod: InstalledMod, allModsMap: Map<string, InstalledMod>): string[] {
  const deps = new Set<string>();

  // 1. Explicit dependencies
  if (Array.isArray(mod.dependencies)) {
    for (const d of mod.dependencies) {
      if (d) deps.add(normalizeIdentifier(d));
    }
  }

  // 2. LoadAfter constraints (A must load after B => A depends on B)
  if (Array.isArray((mod as any).loadAfter)) {
    for (const b of (mod as any).loadAfter) {
      if (b) deps.add(normalizeIdentifier(b));
    }
  }

  // 3. Known heuristics
  const normId = normalizeIdentifier(mod.id);
  const normName = normalizeIdentifier(mod.name);

  if (normId.includes('sain') || normName.includes('sain')) {
    deps.add('xyz.drakia.bigbrain');
  }
  if (normId.includes('questingbots') || normName.includes('questing bots')) {
    deps.add('xyz.drakia.bigbrain');
    deps.add('xyz.drakia.waypoints');
    deps.add('me.sol.sain');
  }
  if (normId.includes('lootingbots') || normName.includes('looting bots')) {
    deps.add('xyz.drakia.bigbrain');
  }
  if (normId.includes('waypoints') && !normName.includes('bigbrain')) {
    deps.add('xyz.drakia.bigbrain');
  }
  if (normId.includes('wtt') || normName.includes('wtt-') || normName.includes('wtt ')) {
    if (!normId.includes('commonlib') && !normName.includes('commonlib')) {
      deps.add('com.wtt.commonlib');
    }
  }

  // Filter against active installed mods map keys
  const resolved: string[] = [];
  for (const dep of deps) {
    // Check if directly matches a mod ID or GUID or name
    let matchedId: string | null = null;
    for (const [id, m] of allModsMap.entries()) {
      if (
        id === dep ||
        normalizeIdentifier(m.id) === dep ||
        normalizeIdentifier(m.name) === dep ||
        normalizeIdentifier((m as any).guid) === dep
      ) {
        matchedId = m.id;
        break;
      }
    }
    resolved.push(matchedId || dep);
  }

  return resolved;
}

/**
 * Builds directed dependency graph: A -> B means "A requires B to load first".
 */
export function buildDependencyGraph(installedMods: InstalledMod[]) {
  const activeMods = installedMods.filter((m) => !m.isDisabled);
  const modMap = new Map<string, InstalledMod>();
  const idMap = new Map<string, string>(); // normalized alias -> actual mod.id

  for (const m of activeMods) {
    modMap.set(m.id, m);
    idMap.set(normalizeIdentifier(m.id), m.id);
    idMap.set(normalizeIdentifier(m.name), m.id);
    if ((m as any).guid) {
      idMap.set(normalizeIdentifier((m as any).guid), m.id);
    }
  }

  const adj = new Map<string, string[]>();
  for (const m of activeMods) {
    adj.set(m.id, []);
  }

  for (const m of activeMods) {
    const rawDeps = resolveModDependencies(m, modMap);
    for (const rawDep of rawDeps) {
      const targetId = idMap.get(normalizeIdentifier(rawDep)) || (modMap.has(rawDep) ? rawDep : null);
      if (targetId && targetId !== m.id && modMap.has(targetId)) {
        const currentList = adj.get(m.id) || [];
        if (!currentList.includes(targetId)) {
          currentList.push(targetId);
          adj.set(m.id, currentList);
        }
      }
    }

    // loadBefore constraints (A must load before B => B depends on A, so B -> A)
    if (Array.isArray((m as any).loadBefore)) {
      for (const before of (m as any).loadBefore) {
        const targetB = idMap.get(normalizeIdentifier(before)) || (modMap.has(before) ? before : null);
        if (targetB && targetB !== m.id && modMap.has(targetB)) {
          const bList = adj.get(targetB) || [];
          if (!bList.includes(m.id)) {
            bList.push(m.id);
            adj.set(targetB, bList);
          }
        }
      }
    }
  }

  return { activeMods, modMap, adj };
}

/**
 * Detects circular dependency cycles using Tarjan's Strongly Connected Components (SCC) algorithm.
 */
export function detectCyclesTarjan(installedMods: InstalledMod[]): CircularDependencyCycle[] {
  const { modMap, adj } = buildDependencyGraph(installedMods);

  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  function strongConnect(u: string) {
    indices.set(u, index);
    lowlink.set(u, index);
    index++;
    stack.push(u);
    onStack.add(u);

    const neighbors = adj.get(u) || [];
    for (const v of neighbors) {
      if (!indices.has(v)) {
        strongConnect(v);
        lowlink.set(u, Math.min(lowlink.get(u)!, lowlink.get(v)!));
      } else if (onStack.has(v)) {
        lowlink.set(u, Math.min(lowlink.get(u)!, indices.get(v)!));
      }
    }

    if (lowlink.get(u) === indices.get(u)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== u);

      // Only components with 2 or more vertices (or a self-loop) represent cycles
      if (scc.length > 1) {
        sccs.push(scc);
      } else if (scc.length === 1 && (adj.get(u) || []).includes(u)) {
        sccs.push(scc);
      }
    }
  }

  for (const nodeId of adj.keys()) {
    if (!indices.has(nodeId)) {
      strongConnect(nodeId);
    }
  }

  // Format into CircularDependencyCycle reports
  const cycles: CircularDependencyCycle[] = [];

  for (let i = 0; i < sccs.length; i++) {
    const scc = sccs[i];
    const modNames = scc.map((id) => modMap.get(id)?.name || id);

    // Form cycle chain string: Mod A -> Mod B -> Mod C -> Mod A
    const pathStr = [...modNames, modNames[0]].join(' ➔ ');

    const sourceModId = scc[0];
    const targetModId = scc[1] || scc[0];
    const sourceModName = modMap.get(sourceModId)?.name || sourceModId;
    const targetModName = modMap.get(targetModId)?.name || targetModId;

    cycles.push({
      cycleId: `cycle-scc-${i + 1}-${scc.slice(0, 3).join('-')}`,
      modIds: scc,
      modNames,
      pathRepresentation: pathStr,
      description: `Circular dependency detected involving ${scc.length} active mods. SPT.Server will encounter deadlock during startup sequencing.`,
      breakRecommendation: {
        sourceModId,
        sourceModName,
        targetModId,
        targetModName,
        suggestedAction: 'adjust_load_order',
      },
    });
  }

  return cycles;
}

/**
 * Computes topological sort via Kahn's algorithm.
 * Returns sorted mod IDs or partial ordering if cycles exist.
 */
export function topologicalSortKahn(installedMods: InstalledMod[]): {
  order: string[];
  hasCycle: boolean;
  unresolvedModIds: string[];
} {
  const { modMap, adj } = buildDependencyGraph(installedMods);
  const inDegree = new Map<string, number>();

  for (const u of modMap.keys()) {
    inDegree.set(u, 0);
  }

  for (const neighbors of adj.values()) {
    for (const v of neighbors) {
      inDegree.set(v, (inDegree.get(v) || 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [u, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(u);
    }
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    order.push(u);

    for (const v of adj.get(u) || []) {
      const nextDeg = (inDegree.get(v) || 1) - 1;
      inDegree.set(v, nextDeg);
      if (nextDeg === 0) {
        queue.push(v);
      }
    }
  }

  const allIds = Array.from(modMap.keys());
  const hasCycle = order.length < allIds.length;
  const unresolvedModIds = allIds.filter((id) => !order.includes(id));

  return {
    order,
    hasCycle,
    unresolvedModIds,
  };
}

/**
 * Multi-Level Virtual Path Index (VPI) File Collision Classifier
 */
export function detectFileCollisions(
  installedMods: InstalledMod[],
  ignoredCollisionIds: string[] = []
): FileCollision[] {
  const activeMods = installedMods.filter((m) => !m.isDisabled);
  const collisions: FileCollision[] = [];
  const ignoredSet = new Set(ignoredCollisionIds.map((id) => id.toLowerCase()));

  // Map normalized relative path -> contending mods list
  const vpiMap = new Map<
    string,
    {
      normalizedPath: string;
      originalPath: string;
      contenders: FileCollisionContender[];
    }
  >();

  function registerPath(rawPath: string, mod: InstalledMod) {
    if (!rawPath) return;
    const cleanPath = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const norm = cleanPath.toLowerCase();

    // Skip root directories
    if (norm === 'bepinex/plugins' || norm === 'user/mods' || norm === 'spt_runtime/user/mods') {
      return;
    }

    if (!vpiMap.has(norm)) {
      vpiMap.set(norm, {
        normalizedPath: norm,
        originalPath: cleanPath,
        contenders: [],
      });
    }

    const entry = vpiMap.get(norm)!;
    if (!entry.contenders.some((c) => c.modId === mod.id)) {
      entry.contenders.push({
        modId: mod.id,
        modName: mod.name,
        version: mod.version || '1.0.0',
        loadOrder: mod.loadOrder,
        isDirectLink: true,
      });
    }
  }

  for (const mod of activeMods) {
    // 1. Client path (.dll plugin)
    if (mod.clientPath) {
      registerPath(mod.clientPath, mod);
      // Also register file base name if direct DLL
      const baseName = mod.clientPath.split('/').pop();
      if (baseName && baseName.toLowerCase().endsWith('.dll')) {
        registerPath(`BepInEx/plugins/${baseName}`, mod);
      }
    }

    // 2. Server path (user/mods/xyz)
    if (mod.serverPath) {
      registerPath(mod.serverPath, mod);
    }

    // 3. Config files
    if (Array.isArray(mod.configFiles)) {
      for (const cfg of mod.configFiles) {
        const configPath = cfg.relativePath || (cfg as any).path;
        if (configPath) {
          registerPath(configPath, mod);
        }
      }
    }
  }

  // Classify collisions
  for (const [normPath, entry] of vpiMap.entries()) {
    if (entry.contenders.length <= 1) continue;

    const collisionId = `collision-${normPath.replace(/[^a-z0-9]/g, '_')}`;
    if (ignoredSet.has(collisionId.toLowerCase())) continue;

    let type: FileCollisionType = 'ASSET_OVERRIDE';
    let severity: 'critical' | 'warning' | 'info' = 'info';
    let recommendedAction: 'prioritize_higher' | 'disable_mod' | 'sandbox_config' = 'prioritize_higher';
    let details = '';

    if (normPath.endsWith('.dll')) {
      type = 'CRITICAL_BINARY';
      severity = 'critical';
      recommendedAction = 'disable_mod';
      details = `Critical binary collision: Multiple active mods place identical DLL '${entry.originalPath}'. This will cause BepInEx entrypoint collision and game crash.`;
    } else if (
      normPath.endsWith('.json') ||
      normPath.endsWith('.jsonc') ||
      normPath.endsWith('.cfg') ||
      normPath.endsWith('.ini')
    ) {
      type = 'CONFIG_OVERWRITE';
      severity = 'warning';
      recommendedAction = 'sandbox_config';
      details = `Configuration overwrite: Mods contend for '${entry.originalPath}'. Deep-merge or load prioritization required to protect user custom presets.`;
    } else {
      type = 'ASSET_OVERRIDE';
      severity = 'info';
      recommendedAction = 'prioritize_higher';
      details = `Asset collision: Multiple mods provide visual/sound asset '${entry.originalPath}'. Load order dictates which texture or bundle wins.`;
    }

    collisions.push({
      collisionId,
      type,
      relativePath: entry.originalPath,
      severity,
      contenders: entry.contenders,
      details,
      recommendedAction,
      ignored: false,
    });
  }

  // Sort critical first, then warnings, then info
  collisions.sort((a, b) => {
    const sevOrder = { critical: 1, warning: 2, info: 3 };
    return sevOrder[a.severity] - sevOrder[b.severity];
  });

  return collisions;
}

/**
 * Detects missing prerequisites (dependencies that are absent or disabled)
 */
export function detectMissingPrerequisites(installedMods: InstalledMod[]): MissingPrerequisite[] {
  const activeMods = installedMods.filter((m) => !m.isDisabled);
  const allModsMap = new Map<string, InstalledMod>();

  for (const m of installedMods) {
    allModsMap.set(normalizeIdentifier(m.id), m);
    allModsMap.set(normalizeIdentifier(m.name), m);
    if ((m as any).guid) {
      allModsMap.set(normalizeIdentifier((m as any).guid), m);
    }
  }

  const missingList: MissingPrerequisite[] = [];

  for (const mod of activeMods) {
    const needed = resolveModDependencies(mod, allModsMap);

    for (const depKey of needed) {
      const match = allModsMap.get(normalizeIdentifier(depKey));

      if (match) {
        if (match.isDisabled) {
          missingList.push({
            id: `missing-disabled-${mod.id}-${match.id}`,
            consumerModId: mod.id,
            consumerModName: mod.name,
            requiredModId: match.id,
            requiredModName: match.name,
            versionConstraint: '>= 1.0.0',
            forgeModId: typeof (match as any).forgeId === 'number' ? (match as any).forgeId : undefined,
            isInstalledButDisabled: true,
          });
        }
      } else {
        // Missing completely
        const knownMeta = getKnownDependencyMeta(depKey);
        missingList.push({
          id: `missing-absent-${mod.id}-${depKey}`,
          consumerModId: mod.id,
          consumerModName: mod.name,
          requiredModId: depKey,
          requiredModName: knownMeta?.name || depKey,
          versionConstraint: knownMeta?.version || 'Latest',
          forgeModId: knownMeta?.id,
          isInstalledButDisabled: false,
        });
      }
    }
  }

  return missingList;
}

/**
 * Master analysis report generator for the Conflict Matrix
 */
export function analyzeLoadout(
  installedMods: InstalledMod[],
  ignoredCollisionIds: string[] = []
): ConflictMatrixReport {
  const cycles = detectCyclesTarjan(installedMods);
  const collisions = detectFileCollisions(installedMods, ignoredCollisionIds);
  const missingPrerequisites = detectMissingPrerequisites(installedMods);
  const kahnResult = topologicalSortKahn(installedMods);

  const criticalCount =
    collisions.filter((c) => c.severity === 'critical').length +
    missingPrerequisites.filter((m) => !m.isInstalledButDisabled).length;
  const warningCount =
    collisions.filter((c) => c.severity === 'warning').length +
    missingPrerequisites.filter((m) => m.isInstalledButDisabled).length;
  const circularCount = cycles.length;

  return {
    cycles,
    collisions,
    missingPrerequisites,
    criticalCount,
    warningCount,
    circularCount,
    totalIssuesCount: criticalCount + warningCount + circularCount,
    topologicalLoadOrder: kahnResult.order,
    hasCycle: kahnResult.hasCycle,
    timestamp: new Date().toISOString(),
  };
}

export const conflictResolver = {
  buildDependencyGraph,
  detectCyclesTarjan,
  topologicalSortKahn,
  detectFileCollisions,
  detectMissingPrerequisites,
  analyzeLoadout,
};
