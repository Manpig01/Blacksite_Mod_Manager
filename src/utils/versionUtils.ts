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
