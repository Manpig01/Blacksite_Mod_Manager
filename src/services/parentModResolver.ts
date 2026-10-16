// src/services/parentModResolver.ts

export interface ParentModSummary {
  id: number;
  name: string;
  thumbnailUrl: string | null;
  latestVersion: string;
  isInstalled: boolean;
}

export class ParentModResolver {
  private memoryCache = new Map<number, ParentModSummary>();
  private inflightRequests = new Map<number, Promise<ParentModSummary | null>>();
  private objectUrlRegistry = new Map<string, { objectUrl: string; refCount: number }>();

  /**
   * Batch-prefetches parent mods for an entire page of Addons in a single API call
   * instead of N+1 individual queries per addon card.
   */
  public async prefetchParentBatch(
    parentIds: number[],
    installedModIds: Set<number>,
    fetchModsByIds: (ids: number[]) => Promise<Array<{ id: number; name: string; thumbnail?: string; version?: string }>>
  ): Promise<void> {
    const missingIds = [...new Set(parentIds)].filter(
      (id) => !this.memoryCache.has(id) && !this.inflightRequests.has(id)
    );

    if (missingIds.length === 0) return;

    const batchPromise = fetchModsByIds(missingIds)
      .then((mods) => {
        const foundMap = new Map<number, ParentModSummary>();
        for (const m of mods) {
          const summary: ParentModSummary = {
            id: m.id,
            name: m.name,
            thumbnailUrl: m.thumbnail ?? null,
            latestVersion: m.version || '1.0.0',
            isInstalled: installedModIds.has(m.id),
          };
          this.memoryCache.set(m.id, summary);
          foundMap.set(m.id, summary);
        }
        return foundMap;
      })
      .finally(() => {
        for (const id of missingIds) this.inflightRequests.delete(id);
      });

    for (const id of missingIds) {
      this.inflightRequests.set(
        id,
        batchPromise.then((map) => map.get(id) ?? null)
      );
    }

    await batchPromise;
  }

  /**
   * Coalesces concurrent requests from multiple Addon cards asking for the same Parent Mod
   */
  public async getParentMod(
    parentId: number,
    singleFetcher: (id: number) => Promise<ParentModSummary | null>
  ): Promise<ParentModSummary | null> {
    if (this.memoryCache.has(parentId)) {
      return this.memoryCache.get(parentId)!;
    }
    if (this.inflightRequests.has(parentId)) {
      return this.inflightRequests.get(parentId)!;
    }

    const req = singleFetcher(parentId)
      .then((res) => {
        if (res) this.memoryCache.set(parentId, res);
        return res;
      })
      .finally(() => {
        this.inflightRequests.delete(parentId);
      });

    this.inflightRequests.set(parentId, req);
    return req;
  }

  /**
   * Returns cached summary if already in memory
   */
  public getCachedParentMod(parentId: number): ParentModSummary | null {
    return this.memoryCache.get(parentId) || null;
  }

  /**
   * Reference-counted ObjectURL manager: prevents Chromium memory leaks when scrolling
   * through hundreds of mod/addon thumbnails.
   */
  public acquireObjectUrl(cacheKey: string, blob: Blob): string {
    const existing = this.objectUrlRegistry.get(cacheKey);
    if (existing) {
      existing.refCount += 1;
      return existing.objectUrl;
    }
    const objectUrl = URL.createObjectURL(blob);
    this.objectUrlRegistry.set(cacheKey, { objectUrl, refCount: 1 });
    return objectUrl;
  }

  public releaseObjectUrl(cacheKey: string): void {
    const existing = this.objectUrlRegistry.get(cacheKey);
    if (!existing) return;
    existing.refCount -= 1;
    if (existing.refCount <= 0) {
      URL.revokeObjectURL(existing.objectUrl);
      this.objectUrlRegistry.delete(cacheKey);
    }
  }

  public clearAllObjectUrls(): void {
    for (const [, entry] of this.objectUrlRegistry.entries()) {
      try {
        URL.revokeObjectURL(entry.objectUrl);
      } catch (_) {}
    }
    this.objectUrlRegistry.clear();
  }
}

export const parentModResolver = new ParentModResolver();
