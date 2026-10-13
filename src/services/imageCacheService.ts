const DB_NAME = 'blacksite_image_cache_v2';
const STORE_META = 'thumb_meta';
const STORE_BLOBS = 'thumb_blobs';
const DB_VERSION = 1;

export const MAX_CACHE_BYTES = 200 * 1024 * 1024; // 200 MB storage quota ceiling
export const EVICT_TARGET_BYTES = 150 * 1024 * 1024; // 150 MB ceiling after pruning
export const MAX_THUMB_WIDTH = 480; // Max thumbnail/banner width for high-density cards

export interface CachedThumbMeta {
  url: string;
  byteSize: number;
  lastAccessed: number;
  contentType: string;
  width?: number;
  height?: number;
  transcoded?: boolean;
}

export interface CachedThumbBlob {
  url: string;
  blob: Blob;
}

/**
 * Transcodes incoming image blob to optimized WebP using OffscreenCanvas off the main thread.
 * Downscales oversized banners/thumbnails to max 480px width at quality 0.82.
 * Falls back gracefully to original blob if unsupported or if transcoding fails.
 */
async function transcodeToWebp(
  blob: Blob,
  maxWidth = MAX_THUMB_WIDTH
): Promise<{ blob: Blob; contentType: string; width?: number; height?: number; transcoded: boolean }> {
  // Pass through SVG or empty blobs
  if (!blob || blob.size === 0 || blob.type === 'image/svg+xml') {
    return { blob, contentType: blob?.type || 'image/png', transcoded: false };
  }

  // Check OffscreenCanvas and createImageBitmap support
  if (
    typeof window === 'undefined' ||
    typeof createImageBitmap === 'undefined' ||
    typeof OffscreenCanvas === 'undefined'
  ) {
    return { blob, contentType: blob.type || 'image/png', transcoded: false };
  }

  try {
    const bitmap = await createImageBitmap(blob);
    let targetWidth = bitmap.width;
    let targetHeight = bitmap.height;

    if (targetWidth <= 0 || targetHeight <= 0) {
      bitmap.close();
      return { blob, contentType: blob.type || 'image/png', transcoded: false };
    }

    if (targetWidth > maxWidth) {
      const ratio = maxWidth / targetWidth;
      targetWidth = maxWidth;
      targetHeight = Math.max(1, Math.round(bitmap.height * ratio));
    }

    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof canvas.convertToBlob !== 'function') {
      bitmap.close();
      return { blob, contentType: blob.type || 'image/png', transcoded: false };
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close();

    const webpBlob = await canvas.convertToBlob({
      type: 'image/webp',
      quality: 0.82,
    });

    if (webpBlob && webpBlob.size > 0 && (webpBlob.size <= blob.size || targetWidth < bitmap.width)) {
      return {
        blob: webpBlob,
        contentType: 'image/webp',
        width: targetWidth,
        height: targetHeight,
        transcoded: true,
      };
    }
  } catch {
    // Fall back to original blob on any canvas or decode failure
  }

  return { blob, contentType: blob.type || 'image/png', transcoded: false };
}

class ImageCacheService {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private memoryBlobUrls: Map<string, string> = new Map();
  private pendingFetches: Map<string, Promise<string | null>> = new Map();

  private getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB not supported in this environment'));
        return;
      }

      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        // Two-store architecture: thumb_meta for fast LRU queries and thumb_blobs for binary payload
        if (!db.objectStoreNames.contains(STORE_META)) {
          const metaStore = db.createObjectStore(STORE_META, { keyPath: 'url' });
          metaStore.createIndex('by_lastAccessed', 'lastAccessed', { unique: false });
          metaStore.createIndex('by_byteSize', 'byteSize', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_BLOBS)) {
          db.createObjectStore(STORE_BLOBS, { keyPath: 'url' });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    return this.dbPromise;
  }

  /**
   * Synchronously checks if we have an active in-memory blob URL for immediate 0ms render
   */
  getMemoryUrl(url: string): string | null {
    if (!url) return null;
    const existing = this.memoryBlobUrls.get(url);
    if (existing) {
      this.touchLastAccessed(url);
      return existing;
    }
    return null;
  }

  /**
   * Updates lastAccessed timestamp in thumb_meta without loading binary blobs
   */
  private touchLastAccessed(url: string): void {
    this.getDB()
      .then((db) => {
        try {
          const tx = db.transaction(STORE_META, 'readwrite');
          const store = tx.objectStore(STORE_META);
          const req = store.get(url);
          req.onsuccess = () => {
            const meta = req.result as CachedThumbMeta | undefined;
            if (meta) {
              meta.lastAccessed = Date.now();
              store.put(meta);
            }
          };
        } catch {
          // Ignore background touch error
        }
      })
      .catch(() => {});
  }

  /**
   * Retrieves a cached image URL as a local blob: URL from IndexedDB.
   * Returns null if not cached.
   */
  async getCachedImageUrl(url: string): Promise<string | null> {
    if (!url) return null;

    // 1. Check in-memory object URL for instant 0ms access
    if (this.memoryBlobUrls.has(url)) {
      this.touchLastAccessed(url);
      return this.memoryBlobUrls.get(url)!;
    }

    try {
      const db = await this.getDB();
      return new Promise<string | null>((resolve) => {
        const tx = db.transaction([STORE_META, STORE_BLOBS], 'readonly');
        const blobStore = tx.objectStore(STORE_BLOBS);
        const req = blobStore.get(url);

        req.onsuccess = () => {
          const record = req.result as CachedThumbBlob | undefined;
          if (record && record.blob) {
            const objectUrl = URL.createObjectURL(record.blob);
            this.memoryBlobUrls.set(url, objectUrl);
            this.touchLastAccessed(url);
            resolve(objectUrl);
          } else {
            resolve(null);
          }
        };

        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  /**
   * Transcodes, stores image blob into two decoupled stores (meta and blob),
   * and automatically enforces strict 200MB bounded LRU eviction.
   */
  async cacheBlob(url: string, rawBlob: Blob, contentType = 'image/png'): Promise<string> {
    // 1. In-flight WebP transcoding and downscaling off the DOM thread
    const { blob, contentType: finalType, width, height, transcoded } = await transcodeToWebp(rawBlob);

    const objectUrl = URL.createObjectURL(blob);
    this.memoryBlobUrls.set(url, objectUrl);

    try {
      const db = await this.getDB();
      const tx = db.transaction([STORE_META, STORE_BLOBS], 'readwrite');
      const metaStore = tx.objectStore(STORE_META);
      const blobStore = tx.objectStore(STORE_BLOBS);

      const meta: CachedThumbMeta = {
        url,
        byteSize: blob.size,
        lastAccessed: Date.now(),
        contentType: finalType || contentType || blob.type || 'image/png',
        width,
        height,
        transcoded,
      };

      const blobRecord: CachedThumbBlob = {
        url,
        blob,
      };

      metaStore.put(meta);
      blobStore.put(blobRecord);

      tx.oncomplete = () => {
        // Enforce strict bounded LRU eviction if quota is exceeded
        this.checkAndEvictLru(db).catch(() => {});
      };
    } catch (e) {
      console.warn('Failed to persist image to IndexedDB:', e);
    }

    return objectUrl;
  }

  /**
   * Scans metadata index (without deserializing binary blobs) and prunes oldest entries
   * down to EVICT_TARGET_BYTES (150MB) if total cache exceeds MAX_CACHE_BYTES (200MB).
   */
  private async checkAndEvictLru(db: IDBDatabase): Promise<void> {
    try {
      const tx = db.transaction([STORE_META, STORE_BLOBS], 'readwrite');
      const metaStore = tx.objectStore(STORE_META);
      const blobStore = tx.objectStore(STORE_BLOBS);
      const index = metaStore.index('by_lastAccessed');

      const req = index.openCursor(); // Ascending order: oldest lastAccessed first
      let totalSize = 0;
      const oldestEntries: { url: string; byteSize: number }[] = [];

      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const val = cursor.value as CachedThumbMeta;
          const sz = val.byteSize || 0;
          totalSize += sz;
          oldestEntries.push({ url: val.url, byteSize: sz });
          cursor.continue();
        } else {
          // Finished scanning metadata
          if (totalSize > MAX_CACHE_BYTES) {
            let bytesToEvict = totalSize - EVICT_TARGET_BYTES;
            for (const item of oldestEntries) {
              if (bytesToEvict <= 0) break;
              metaStore.delete(item.url);
              blobStore.delete(item.url);
              bytesToEvict -= item.byteSize;

              const memUrl = this.memoryBlobUrls.get(item.url);
              if (memUrl) {
                try {
                  URL.revokeObjectURL(memUrl);
                } catch {
                  // Ignore revocation error
                }
                this.memoryBlobUrls.delete(item.url);
              }
            }
          }
        }
      };
    } catch (e) {
      console.warn('LRU eviction failed:', e);
    }
  }

  /**
   * Fetches an image URL and caches the resulting Blob into IndexedDB.
   * Dedupes concurrent requests for the same URL.
   */
  async fetchAndCache(url: string): Promise<string | null> {
    if (!url) return null;

    // Check if already in memory or indexed cache
    const existing = await this.getCachedImageUrl(url);
    if (existing) return existing;

    // Check if a fetch is already in flight for this URL
    if (this.pendingFetches.has(url)) {
      return this.pendingFetches.get(url)!;
    }

    const fetchPromise = (async () => {
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) return null;

        const blob = await res.blob();
        const contentType = res.headers.get('content-type') || blob.type || 'image/png';
        return await this.cacheBlob(url, blob, contentType);
      } catch {
        return null;
      } finally {
        this.pendingFetches.delete(url);
      }
    })();

    this.pendingFetches.set(url, fetchPromise);
    return fetchPromise;
  }

  /**
   * Preloads a batch of image URLs in parallel using an 8-stream worker pool
   */
  async preloadImages(urls: string[], concurrency = 8): Promise<number> {
    const validUrls = Array.from(new Set(urls.filter(Boolean)));
    let completed = 0;
    for (let i = 0; i < validUrls.length; i += concurrency) {
      const batch = validUrls.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (url) => {
          try {
            await this.fetchAndCache(url);
            completed++;
          } catch {
            // Ignore individual failure
          }
        })
      );
    }
    return completed;
  }

  /**
   * Computes statistics about the local image cache using ONLY the lightweight thumb_meta store
   * without deserializing binary blobs into V8 heap.
   */
  async getCacheStats(): Promise<{ count: number; totalSizeBytes: number }> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_META, 'readonly');
        const store = tx.objectStore(STORE_META);
        const req = store.getAll();

        req.onsuccess = () => {
          const records = (req.result as CachedThumbMeta[]) || [];
          let totalSizeBytes = 0;
          for (const r of records) {
            totalSizeBytes += r.byteSize || 0;
          }
          resolve({ count: records.length, totalSizeBytes });
        };

        req.onerror = () => resolve({ count: 0, totalSizeBytes: 0 });
      });
    } catch {
      return { count: 0, totalSizeBytes: 0 };
    }
  }

  /**
   * Wipes all cached mod images from IndexedDB and revokes object URLs
   */
  async clearCache(): Promise<void> {
    for (const objectUrl of this.memoryBlobUrls.values()) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // ignore
      }
    }
    this.memoryBlobUrls.clear();

    try {
      const db = await this.getDB();
      const tx = db.transaction([STORE_META, STORE_BLOBS], 'readwrite');
      tx.objectStore(STORE_META).clear();
      tx.objectStore(STORE_BLOBS).clear();
    } catch (e) {
      console.warn('Failed clearing IndexedDB image cache:', e);
    }
  }
}

export const imageCacheService = new ImageCacheService();
