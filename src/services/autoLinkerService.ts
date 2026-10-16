// src/services/autoLinkerService.ts
import { InstalledMod, Mod } from '../types';

/**
 * Calculates Token Jaccard Similarity between two strings.
 * Divides intersection of alphanumeric tokens by union of tokens.
 */
export function calculateTokenJaccard(strA: string, strB: string): number {
  if (!strA || !strB) return 0;
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 1)
    );

  const tokensA = tokenize(strA);
  const tokensB = tokenize(strB);

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersectionCount = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersectionCount++;
  }

  const unionCount = new Set([...tokensA, ...tokensB]).size;
  return unionCount > 0 ? intersectionCount / unionCount : 0;
}

export function normalizeAlphaNum(s?: string | null): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface LinkEvaluationResult {
  status: 'linked' | 'quarantine' | 'unlinked';
  confidence: number;
  matchedMod?: Mod;
  reason?: string;
}

export const autoLinkerService = {
  /**
   * Evaluates a local mod against the remote Forge catalog using the 3-Tier Algorithm + Quarantine Gate
   */
  evaluateModLink(localMod: InstalledMod, catalog: Mod[]): LinkEvaluationResult {
    if (!catalog || catalog.length === 0) {
      return { status: 'unlinked', confidence: 0 };
    }

    const localId = (localMod.id || '').toLowerCase().trim();
    const localName = (localMod.name || '').toLowerCase().trim();
    const localAuthor = normalizeAlphaNum(localMod.author);
    const inferredGuid = (localMod.inferredGuid || '').toLowerCase().trim();

    let bestMatch: Mod | null = null;
    let highestScore = 0;
    let matchReason = '';

    for (const remote of catalog) {
      const remoteGuid = (remote.guid || '').toLowerCase().trim();
      const remoteSlug = (remote.slug || '').toLowerCase().trim();
      const remoteName = (remote.name || '').toLowerCase().trim();
      const remoteAuthor = normalizeAlphaNum(remote.owner?.name);

      // --- Tier 1 (Exact Match - 1.00 Confidence) ---
      if (localMod.modId && localMod.modId === remote.id) {
        return { status: 'linked', confidence: 1.0, matchedMod: remote, reason: 'Exact Mod ID match' };
      }
      if (remoteGuid && (localId === remoteGuid || inferredGuid === remoteGuid)) {
        return { status: 'linked', confidence: 1.0, matchedMod: remote, reason: 'Exact BepInPlugin GUID match' };
      }
      if (remoteSlug && localId === remoteSlug) {
        return { status: 'linked', confidence: 1.0, matchedMod: remote, reason: 'Exact Forge slug match' };
      }

      // --- Tier 2 (Compound Author + Slug Match - 0.94 Confidence) ---
      const authorMatches = localAuthor && remoteAuthor && (localAuthor === remoteAuthor || localAuthor.includes(remoteAuthor) || remoteAuthor.includes(localAuthor));
      const jaccard = calculateTokenJaccard(localName, remoteName);

      if (authorMatches && jaccard > 0.85) {
        if (0.94 > highestScore) {
          highestScore = 0.94;
          bestMatch = remote;
          matchReason = `Author verified (${remote.owner?.name}) & Name similarity (${Math.round(jaccard * 100)}%)`;
        }
        continue;
      }

      // --- Tier 3 (Standalone DLL Binary GUID Match - 0.90 Confidence) ---
      const candidateGuid = inferredGuid || (localId.includes('.') ? localId : null);
      if (candidateGuid) {
        const segments = candidateGuid.split('.');
        if (segments.length >= 3) {
          const guidAuthor = normalizeAlphaNum(segments[1]);
          const guidModName = normalizeAlphaNum(segments.slice(2).join(''));
          const remoteCleanMod = normalizeAlphaNum(remoteSlug || remoteName);

          if (
            (guidAuthor === remoteAuthor || remoteAuthor.includes(guidAuthor)) &&
            (remoteCleanMod.includes(guidModName) || guidModName.includes(remoteCleanMod))
          ) {
            if (0.9 > highestScore) {
              highestScore = 0.9;
              bestMatch = remote;
              matchReason = `Embedded [BepInPlugin] GUID structure matched`;
            }
            continue;
          }
        }
      }

      // --- Partial fuzzy match (Quarantine zone evaluation: 0.65 to 0.87) ---
      let partialScore = 0;
      if (authorMatches && jaccard > 0.5) {
        partialScore = 0.70 + (jaccard * 0.15); // 0.775 to 0.85
      } else if (jaccard > 0.75) {
        partialScore = 0.65 + (jaccard * 0.18); // 0.785 to 0.83
      } else if (remoteCleanSlugName(remoteSlug, localName)) {
        partialScore = 0.72;
      }

      if (partialScore > highestScore) {
        highestScore = partialScore;
        bestMatch = remote;
        matchReason = `Candidate match: ${remote.name} (Similarity: ${Math.round(jaccard * 100)}%)`;
      }
    }

    // Safety Quarantine Gate
    if (highestScore >= 0.88 && bestMatch) {
      return {
        status: 'linked',
        confidence: Math.round(highestScore * 100) / 100,
        matchedMod: bestMatch,
        reason: matchReason,
      };
    }

    if (highestScore >= 0.65 && bestMatch) {
      return {
        status: 'quarantine',
        confidence: Math.round(highestScore * 100) / 100,
        matchedMod: bestMatch,
        reason: matchReason,
      };
    }

    return { status: 'unlinked', confidence: 0 };
  },

  /**
   * Runs the Auto-Linker over an array of installed mods against the Forge catalog
   */
  autoLinkInstalledMods(installedMods: InstalledMod[], catalog: Mod[]): InstalledMod[] {
    return installedMods.map((mod) => {
      // If already explicitly verified and linked by user or previous run, keep
      if (mod.forgeLinkStatus === 'linked' && mod.modId) {
        return mod;
      }

      const res = this.evaluateModLink(mod, catalog);

      if (res.status === 'linked' && res.matchedMod) {
        return {
          ...mod,
          modId: res.matchedMod.id,
          forgeLinkConfidence: res.confidence,
          forgeLinkStatus: 'linked',
          forgeCandidateMod: {
            id: res.matchedMod.id,
            name: res.matchedMod.name,
            slug: res.matchedMod.slug,
            author: res.matchedMod.owner?.name,
            version: res.matchedMod.versions?.[0]?.version,
            thumbnail: res.matchedMod.thumbnail,
          },
          categoryTitle: mod.categoryTitle || res.matchedMod.category?.title,
          thumbnail: mod.thumbnail || res.matchedMod.thumbnail,
        };
      }

      if (res.status === 'quarantine' && res.matchedMod) {
        return {
          ...mod,
          // DO NOT assign modId yet: keep in safety quarantine
          forgeLinkConfidence: res.confidence,
          forgeLinkStatus: 'quarantine',
          forgeCandidateMod: {
            id: res.matchedMod.id,
            name: res.matchedMod.name,
            slug: res.matchedMod.slug,
            author: res.matchedMod.owner?.name,
            version: res.matchedMod.versions?.[0]?.version,
            thumbnail: res.matchedMod.thumbnail,
          },
        };
      }

      return {
        ...mod,
        forgeLinkStatus: 'unlinked',
        forgeLinkConfidence: 0,
        forgeCandidateMod: undefined,
      };
    });
  },

  /**
   * User confirms a quarantined candidate match
   */
  confirmQuarantineLink(mod: InstalledMod, candidate: NonNullable<InstalledMod['forgeCandidateMod']>): InstalledMod {
    return {
      ...mod,
      modId: candidate.id,
      forgeLinkStatus: 'linked',
      forgeLinkConfidence: 1.0,
      thumbnail: mod.thumbnail || candidate.thumbnail,
    };
  },

  /**
   * User rejects a quarantined candidate match
   */
  rejectQuarantineLink(mod: InstalledMod): InstalledMod {
    return {
      ...mod,
      forgeLinkStatus: 'unlinked',
      forgeLinkConfidence: 0,
      forgeCandidateMod: undefined,
    };
  },
};

function remoteCleanSlugName(slug: string, localName: string): boolean {
  if (!slug || !localName) return false;
  const cleanSlug = normalizeAlphaNum(slug);
  const cleanLocal = normalizeAlphaNum(localName);
  return cleanSlug.length > 4 && (cleanSlug === cleanLocal || cleanSlug.includes(cleanLocal));
}
