import { SptVersionInfo, ModVersion } from '../types';

/**
 * Compares two semantic version strings in descending order (newest/highest version first).
 * Handles standard semver (e.g. "4.1.6", "4.0.13", "3.11.4") as well as pre-release suffixes and "v" prefixes.
 */
export function compareVersionsDesc(verA?: string | null, verB?: string | null): number {
  const cleanA = (verA || '').replace(/^[vV\s]+/, '').trim();
  const cleanB = (verB || '').replace(/^[vV\s]+/, '').trim();

  if (!cleanA && !cleanB) return 0;
  if (!cleanA) return 1;
  if (!cleanB) return -1;

  // Split into components (e.g., 4.0.13-rc1 -> [4, 0, 13, "rc1"])
  const partsA = cleanA.split(/[.-]/).map((segment) => {
    const num = parseInt(segment, 10);
    return isNaN(num) ? segment.toLowerCase() : num;
  });

  const partsB = cleanB.split(/[.-]/).map((segment) => {
    const num = parseInt(segment, 10);
    return isNaN(num) ? segment.toLowerCase() : num;
  });

  const maxLen = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLen; i++) {
    const a = partsA[i] !== undefined ? partsA[i] : 0;
    const b = partsB[i] !== undefined ? partsB[i] : 0;

    if (typeof a === 'number' && typeof b === 'number') {
      if (b !== a) return b - a; // Descending: higher number first
    } else {
      const strA = String(a);
      const strB = String(b);
      const cmp = strB.localeCompare(strA, undefined, { numeric: true });
      if (cmp !== 0) return cmp;
    }
  }

  return 0;
}

/**
 * Sorts an array of SPT versions in order of most recent (newest releases at the top).
 * Uses semantic version comparison, creation/release timestamp, and ID order.
 */
export function sortSptVersionsByMostRecent(versions: SptVersionInfo[]): SptVersionInfo[] {
  if (!versions || !Array.isArray(versions) || versions.length === 0) {
    return [];
  }

  // De-duplicate by version string
  const seenVersions = new Set<string>();
  const uniqueList: SptVersionInfo[] = [];

  for (const v of versions) {
    const key = (v.version || '').trim();
    if (key && !seenVersions.has(key)) {
      seenVersions.add(key);
      uniqueList.push(v);
    } else if (!key) {
      uniqueList.push(v);
    }
  }

  return uniqueList.sort((a, b) => {
    // 1. Primary: Semantic version comparison descending (e.g., 4.1.6 > 4.1.5 > 4.0.13 > 3.11.4)
    const verCmp = compareVersionsDesc(a.version, b.version);
    if (verCmp !== 0) return verCmp;

    // 2. Secondary: Release / creation date descending
    const dateA = new Date(
      a.createdAt || (a as any).created_at || (a as any).updatedAt || (a as any).updated_at || 0
    ).getTime();
    const dateB = new Date(
      b.createdAt || (b as any).created_at || (b as any).updatedAt || (b as any).updated_at || 0
    ).getTime();
    if (dateB !== dateA && !isNaN(dateA) && !isNaN(dateB)) {
      return dateB - dateA;
    }

    // 3. Fallback: ID descending
    return (b.id || 0) - (a.id || 0);
  });
}

/**
 * Sorts an array of ModVersion objects in order of most recent release.
 */
export function sortModVersionsByMostRecent(versions: ModVersion[]): ModVersion[] {
  if (!versions || !Array.isArray(versions) || versions.length === 0) {
    return [];
  }

  return [...versions].sort((a, b) => {
    // 1. Published / Created date descending
    const dateA = new Date(a.published_at || a.created_at || (a as any).updated_at || 0).getTime();
    const dateB = new Date(b.published_at || b.created_at || (b as any).updated_at || 0).getTime();
    if (dateB !== dateA && !isNaN(dateA) && !isNaN(dateB) && dateA > 0 && dateB > 0) {
      return dateB - dateA;
    }

    // 2. Semver descending
    const verCmp = compareVersionsDesc(a.version, b.version);
    if (verCmp !== 0) return verCmp;

    // 3. ID descending
    return (b.id || 0) - (a.id || 0);
  });
}

/**
 * Determines appropriate CSS badge class based on SPT version tier.
 */
export function getSptBadgeClass(version?: string | null): string {
  if (!version) return 'bg-[#16A34A] border border-[#16A34A]/80 text-white';
  const clean = version.replace(/^[vV\s]+/, '').trim();

  if (clean.startsWith('4.1')) {
    return 'bg-[#16A34A] border border-[#16A34A]/80 text-white'; // Emerald green
  }
  if (clean.startsWith('4.0')) {
    return 'bg-[#7C3AED] border border-[#7C3AED]/80 text-white'; // Violet
  }
  if (clean.startsWith('3.')) {
    return 'bg-[#D97706] border border-[#D97706]/80 text-white'; // Amber/Gold
  }
  return 'bg-[#16A34A] border border-[#16A34A]/80 text-white';
}

/**
 * Checks if an SPT version constraint (e.g. "~4.1.1", "^4.0.0", ">=3.9.0", "3.10.5", "3.9.0")
 * is compatible with a target SPT version (e.g. "4.1.6", "4.0.12", "3.9.0").
 */
export function isSptVersionCompatible(constraint?: string | null, targetSptVersion?: string | null): boolean {
  if (!constraint || !targetSptVersion || targetSptVersion === 'All') return true;

  const cleanTarget = targetSptVersion.replace(/^[vV\s]+/, '').trim();
  const cleanConstraint = constraint.trim();

  // Exact match
  if (cleanConstraint === cleanTarget) return true;

  // Extract base version and operator
  const opMatch = cleanConstraint.match(/^([~^>=<]*)\s*([0-9]+(?:\.[0-9]+)*(?:-[a-zA-Z0-9.]+)?)/);
  if (!opMatch) return false;

  const op = opMatch[1] || '';
  const baseVer = opMatch[2];

  const targetParts = cleanTarget.split('.').map((n) => parseInt(n, 10));
  const baseParts = baseVer.split('.').map((n) => parseInt(n, 10));

  const tMajor = targetParts[0] ?? 0;
  const tMinor = targetParts[1] ?? 0;
  const tPatch = targetParts[2] ?? 0;

  const bMajor = baseParts[0] ?? 0;
  const bMinor = baseParts[1] ?? 0;
  const bPatch = baseParts[2] ?? 0;

  if (op === '~') {
    // Tilde: allows patch-level changes if minor is specified, or minor if not
    if (tMajor !== bMajor) return false;
    if (baseParts.length >= 2 && tMinor !== bMinor) return false;
    return true;
  }

  if (op === '^') {
    // Caret: allows compatible changes within same major version
    if (tMajor !== bMajor) return false;
    return true;
  }

  if (op === '>=') {
    if (tMajor > bMajor) return true;
    if (tMajor === bMajor && tMinor > bMinor) return true;
    if (tMajor === bMajor && tMinor === bMinor && tPatch >= bPatch) return true;
    return false;
  }

  // Exact/version prefix match without operator (e.g. "3.8.0" or "4.0")
  if (baseParts.length >= 2) {
    return tMajor === bMajor && tMinor === bMinor;
  }
  return tMajor === bMajor;
}

/**
 * Finds the best matching ModVersion for a given target SPT version.
 * If targetSptVersion is "All" or empty, returns the latest release (first in sorted list).
 */
export function findMatchingModVersion(
  versions?: ModVersion[] | null,
  targetSptVersion?: string | null
): ModVersion | undefined {
  if (!versions || !Array.isArray(versions) || versions.length === 0) return undefined;
  if (!targetSptVersion || targetSptVersion === 'All') return versions[0];

  // 1. Direct constraint compatibility match
  const directMatch = versions.find((v) =>
    isSptVersionCompatible(v.spt_version_constraint, targetSptVersion)
  );
  if (directMatch) return directMatch;

  // 2. Partial match in description or version notes if any
  const cleanTarget = targetSptVersion.replace(/^[vV\s]+/, '').trim();
  const descMatch = versions.find((v) =>
    v.description && v.description.toLowerCase().includes(`spt ${cleanTarget}`.toLowerCase())
  );
  if (descMatch) return descMatch;

  // 3. Fallback to latest available release
  return versions[0];
}
