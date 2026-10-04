const DB_NAME = 'blacksite_image_cache_v1';
const STORE_NAME = 'images';
const DB_VERSION = 1;

interface CachedImageRecord {
  url: string;
  blob: Blob;
  contentType: string;
  size: number;
  timestamp: number;
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
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'url' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
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
    return this.memoryBlobUrls.get(url) || null;
  }

  /**
   * Retrieves a cached image URL as a local blob: URL from IndexedDB.
   * Returns null if not cached.
   */
  async getCachedImageUrl(url: string): Promise<string | null> {
    if (!url) return null;

    // 1. Check in-memory object URL
    if (this.memoryBlobUrls.has(url)) {
      return this.memoryBlobUrls.get(url)!;
    }

    try {
      const db = await this.getDB();
      return new Promise<string | null>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(url);

        req.onsuccess = () => {
          const record = req.result as CachedImageRecord | undefined;
          if (record && record.blob) {
            const objectUrl = URL.createObjectURL(record.blob);
            this.memoryBlobUrls.set(url, objectUrl);
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
   * Stores a blob in IndexedDB and updates in-memory registry
   */
  async cacheBlob(url: string, blob: Blob, contentType = 'image/png'): Promise<string> {
    const objectUrl = URL.createObjectURL(blob);
    this.memoryBlobUrls.set(url, objectUrl);

    try {
      const db = await this.getDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record: CachedImageRecord = {
        url,
        blob,
        contentType: contentType || blob.type || 'image/png',
        size: blob.size,
        timestamp: Date.now(),
      };
      store.put(record);
    } catch (e) {
      console.warn('Failed to persist image to IndexedDB:', e);
    }

    return objectUrl;
  }

  /**
   * Fetches an image URL and caches the resulting Blob into IndexedDB.
   * Dedupes concurrent requests for the same URL.
   */
  async fetchAndCache(url: string): Promise<string | null> {
    if (!url) return null;

    // Check if already in memory
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
      } catch (err) {
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
   * Computes statistics about the local image cache
   */
  async getCacheStats(): Promise<{ count: number; totalSizeBytes: number }> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();

        req.onsuccess = () => {
          const records = (req.result as CachedImageRecord[]) || [];
          let totalSizeBytes = 0;
          for (const r of records) {
            totalSizeBytes += r.size || 0;
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
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
    } catch (e) {
      console.warn('Failed clearing IndexedDB image cache:', e);
    }
  }
}

export const imageCacheService = new ImageCacheService();
