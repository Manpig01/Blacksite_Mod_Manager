# Implementation Plan: Addon Image Fetching & Persistent Caching

### Problem Overview
Addons in the SPT Forge API (`sp-mod.com`) often have CDN-hosted thumbnails on `files.sp-mod.com` that encounter hotlink protection or CORS restrictions in web environments. Additionally, some addons do not have custom preview thumbnails or their thumbnails may fail to load. Currently, raw `<img>` tags in `AddonsTab` hide on error, leaving empty spaces, and do not utilize local persistent caching.

### Chosen Solution
Create a resilient **`AddonThumbnail`** component backed by **`imageCacheService`** (IndexedDB + memory cache) with a multi-candidate fallback chain (Addon thumbnail -> Parent mod thumbnail -> Author avatar -> Tactical preset badge) and proxy support.

---

### Key Changes Planned

1. **`src/components/AddonThumbnail.tsx`**:
   - Build a specialized thumbnail renderer for addons.
   - **Candidate fallback chain**:
     1. Direct/proxied `addon.thumbnail`
     2. Parent mod thumbnail (`addon.mod?.thumbnail`)
     3. Author avatar (`addon.authors?.[0]?.avatar`)
     4. Tactical preset placeholder badge with SVG icon and parent mod title
   - **Proxy Resolution**: Use `getProxiedForgeImageUrl()` on web while allowing native direct loads with injected headers in Electron.
   - **Persistent Caching**: Check `imageCacheService` memory cache for 0ms immediate render; read/write blobs to IndexedDB (`blacksite_image_cache_v1`).

2. **`src/components/AddonsTab.tsx`**:
   - Replace raw `<img>` elements in the addon card grid and the Addon Details Modal with `<AddonThumbnail addon={addon} />`.
   - Ensure consistent styling, hover zoom transitions, and smooth fade-in.

3. **Validation**:
   - Run compilation checks (`compile_applet`) and verify thumbnail resolution across both addons with dedicated thumbnails and addons falling back to parent mod thumbnails.
