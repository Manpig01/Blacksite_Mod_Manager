# Fix: Dependency Download HTTP 403 Forbidden Failures

Resolve rare dependency installation failures where downloads error out with `HTTP status 403: Forbidden` by migrating to Electron's Chromium-native network stack (`net.fetch`), implementing intelligent cross-origin referrer stripping on S3/CDN/GitHub redirects, and providing automated fallback version resolution.

## User Review & Critical Decisions

> [!IMPORTANT]
> The exact failure mode was identified via the provided error toast:
> `Installation Failed: Download failed with HTTP status 403: Forbidden`

- **Root Cause**:
  1. The downloader in `electron/modInstaller.cjs` hardcoded `'Referer': 'https://sp-mod.com/'`. When The Forge API redirects a mod download to Amazon S3 signed URLs, CloudFront, or GitHub Releases (e.g., `objects.githubusercontent.com`), the cross-origin referer header triggers CORS/referrer validation rejections, returning **HTTP 403 Forbidden**.
  2. Node.js built-in `fetch` retains headers on cross-origin redirects rather than adhering to browser referrer policies, and has a TLS fingerprint that triggers Cloudflare/CDN rate-limiting or security challenges.
  3. Some dependencies lack a valid `latest_compatible_version.link` on The Forge, causing Blacksite to generate a fallback download link that 403s/404s.

- **Solution**:
  1. **Adopt Chromium-Native `net.fetch` in Electron**: Utilize Electron's native `net.fetch` backed by Chromium's full networking stack. This ensures authentic browser TLS fingerprints, cookie sharing, and automatic referrer stripping on cross-origin CDN redirects.
  2. **Smart Referrer Stripping**: Only send `'Referer': 'https://sp-mod.com/'` when requesting the primary `sp-mod.com` domain. Automatically strip the header on CDN, S3, and GitHub redirect targets.
  3. **Multi-Stage 403 Recovery & Fallback**: If a 403 Forbidden status is encountered during download, automatically retry without custom headers, follow manual redirects if needed, and fall back to querying the mod's latest version endpoints.
  4. **Standalone DLL Detection**: Handle raw `.dll` dependency downloads directly without failing in the decompression engine.

---

## 1. Overview & Core Concept

- **What It Does**: Hardens the download and installation pipeline in `electron/modInstaller.cjs` and `src/services/apiService.ts` so all mod dependencies (including those hosted on external mirrors, S3 storage, or GitHub releases) download cleanly without 403 Forbidden errors.
- **Target Audience**: Single Player Tarkov players installing complex mod chains with multiple prerequisites (such as SAIN, BigBrain, Waypoints, WTT-CommonLib, or SVM).
- **Key Value**: 100% reliable 1-click dependency installation without unexpected 403 failures.

---

## 2. Technical Architecture & Network Strategy

### Download & Redirect Flow

```
┌────────────────────────────────────────────────────────┐
│             Dependency Download Initiated              │
│       (e.g., Forge URL or External Asset Link)         │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│     Electron Native Net / Enhanced Fetch Engine        │
│                                                        │
│  • Primary Request: Domain-specific headers            │
│  • Detects Redirect (301/302/307 to S3/CDN/GitHub)     │
│  • Automatically strips third-party Referer            │
│  • Retains authentic browser User-Agent                │
└──────────────────────────┬─────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
      HTTP 200 (Success)         HTTP 403/404 Error
              │                         │
              ▼                         ▼
     Stream direct to disk      Automated Recovery:
     with live % progress       • Retry without headers
                                • Query Forge version API
                                • Resolve alternate link
```

---

## 3. Action Items

1. **Update `electron/modInstaller.cjs` (`streamDownloadToFile`)**:
   - Integrate `net.fetch` from `electron` when running in Electron, with graceful fallback to global `fetch`.
   - Implement `getSafeHeaders(targetUrl)`:
     - Set `'Referer': 'https://sp-mod.com/'` only if `hostname.endsWith('sp-mod.com')`.
     - Remove `Referer` for AWS S3 (`s3.amazonaws.com`), GitHub (`github.com`, `githubusercontent.com`), CloudFront, and other third-party CDNs.
     - Add modern browser headers: `Accept`, `Accept-Language`, `Sec-Fetch-Dest: document`, `Sec-Fetch-Mode: navigate`.
   - Implement automatic retry with header stripping if an HTTP 403 Forbidden is received.
2. **Handle Standalone DLL Downloads in `installMod`**:
   - Check if the downloaded file is a standalone `.dll` (via extension or PE `MZ` header).
   - If `.dll`, route directly into `BepInEx/plugins` instead of sending to `extractArchive`, avoiding decompression failures.
3. **Harden Dependency URL Resolution in `src/services/apiService.ts`**:
   - If `latest_compatible_version` is null or lacks a link, query `/mods/${nodeId}/versions` to locate the latest active version download link instead of generating a generic link.
4. **Verification**:
   - Verify code with `lint_applet` and `compile_applet`.
