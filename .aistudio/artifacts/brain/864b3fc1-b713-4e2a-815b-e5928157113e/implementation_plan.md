# Fix: Electron "Redirect was cancelled" via Native Node Network Engine

Resolved the desktop runtime error `Error: Redirect was cancelled at SimpleURLLoaderWrapper` occurring during downloads of redirected mods (including *Beretta 93R Raffica Continued*) by completely decoupling mod downloads from Chromium's internal URL loader and routing all requests through Node.js's native libuv/fetch network engine.

---

## 1. Problem Diagnosis & Root Cause

1. **Chromium SimpleURLLoader Behavior**:
   In `electron/modInstaller.cjs`, the file streaming downloader previously checked for `electron.net.fetch`:
   ```javascript
   const fetchFn = electronNet && typeof electronNet.fetch === 'function' ? electronNet.fetch : fetch;
   ```
2. When Electron's `net.fetch()` was called with `redirect: 'manual'` on a URL that responds with an `HTTP 307` redirect (such as `https://sp-mod.com/mod/download/3057/...` redirecting to Codeberg), Chromium's `SimpleURLLoader` aborted the redirect internally, throwing:
   ```
   Error: Redirect was cancelled
       at SimpleURLLoaderWrapper.<anonymous> (node:electron/js2c/browser_init:2:118919)
       at SimpleURLLoaderWrapper.emit (node:events:518:28)
   ```
3. Node.js's native `globalThis.fetch` operates on Node's native socket stack rather than Chromium's browser navigation pipeline, natively supporting `redirect: 'manual'` without aborting.

---

## 2. Solutions Implemented

1. **Decoupled from Electron Chromium Network Stack (`electron/modInstaller.cjs`)**:
   - Removed `electron.net` usage entirely from `streamDownloadToFile`.
   - Wired `streamDownloadToFile` to use Node's native `globalThis.fetch`, ensuring Chromium's `SimpleURLLoaderWrapper` is never invoked during mod file streaming.

2. **Clean Hop-by-Hop Redirect Handling**:
   - Manually follows HTTP 301, 302, 303, 307, and 308 redirects across external domains.
   - Preserves `Referer: https://sp-mod.com/` only for direct `sp-mod.com` calls, and strips `Referer` when hopping to Codeberg, GitHub, GitLab, or S3.
   - Sends authentic application client identity (`BlacksiteModManager/2.0.0 (Windows NT 10.0; Win64; x64; SPT-Mod-Manager)`) with `Accept: */*`.

3. **Multi-Tier 403 & Mirror Fallback**:
   - Automatically falls back to standard tool headers (`User-Agent: curl/8.6.0`) if any mirror responds with HTTP 403 Forbidden.

---

## 3. Verification
- `npm run lint` (`tsc -b`): Clean pass, 0 errors.
- `compile_applet`: Build succeeded.
- Verified that `globalThis.fetch` streams binary payloads directly to disk without Chromium `SimpleURLLoaderWrapper` interference.
