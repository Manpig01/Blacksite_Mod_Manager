# Blacksite Mod Manager: Version 2.0.0 Public Release & Branding Plan

A comprehensive implementation plan to update the application branding to the new Blacksite tactical skull emblem in the titlebar, browser tab, and Windows taskbar; bump the version from ALPHA to **v2.0.0 Stable** across the entire application; and configure the repository for a public open-source GitHub release.

## User Review & Critical Decisions

> [!IMPORTANT]
> **Summary of Confirmed User Decisions**
> - **Branding & Versioning**: Version designation is bumped to **v2.0.0** with the `ALPHA` label dropped across all UI surfaces (e.g., `Blacksite Mod Manager - v2.0.0`), window titlebars, toasts, modal dialogs, and package manifests.
> - **New Tactical Icon**: The newly provided tactical embroidered patch (skull insignia with panoramic night vision goggles and "BLACKSITE MOD MANAGER" lettering) will be configured as the window top-left emblem, browser favicon, taskbar icon, and native Electron executable icon.
> - **Public GitHub Release Readiness**: Includes full open-source release tooling:
>   - Multi-platform GitHub Actions workflow (`.github/workflows/release.yml`) for automated builds and GitHub Release draft/publish on `v*` tags.
>   - Polished public `README.md` with status badges, installation guides, feature list, SPT compatibility table, and architecture overview.
>   - Public repository standard files: Open-source LICENSE (MIT), `.gitignore` verification, Issue and PR templates (`.github/ISSUE_TEMPLATE/`), and release packaging scripts.

---

## 1. Scope of Changes

### 1. New Tactical Icon Integration
- **Titlebar Emblem**: Update `src/components/CustomTitleBar.tsx` to display the new tactical patch icon in the top-left corner with crisp rendering and proper aspect ratio.
- **Header Badge**: Update `src/components/Header.tsx` to replace the dragon emoji with the official tactical patch emblem.
- **Web App Favicon / Taskbar**: Update `public/emblem.png` and `index.html` icon link (`<link rel="icon" ...>`) so the browser tab and web view display the new patch.
- **Native Electron Taskbar & Window Icon**: Configure `electron/main.cjs` `BrowserWindow` options with explicit `icon: path.join(__dirname, '../public/emblem.png')` so the desktop taskbar icon and window frame icon are set directly by the OS window manager.
- **Windows Executable Icon**: Update electron-builder icon asset configurations in `package.json` to link the new icon.

### 2. Version 2.0.0 Stable Bump
- **Application Manifest**: Update `package.json` version from `1.8.0` to `2.0.0`.
- **HTML Document & OpenGraph**:
  - Update `index.html` `<title>` to `Blacksite Mod Manager - v2.0.0`.
  - Update `og:title` to `Blacksite Mod Manager - v2.0.0`.
- **Custom Titlebar**: Update `src/components/CustomTitleBar.tsx` title text from `Blacksite Mod Manager - ALPHA v1.8.0` to `Blacksite Mod Manager - v2.0.0`.
- **App Shell & Modals**:
  - Update `src/App.tsx` default initialization toast and app metadata to `v2.0.0`.
  - Update `src/components/WindowsDownloadModal.tsx` default `appVersion` to `2.0.0`.
  - Update `src/components/ExportModsModal.tsx` generator string to `Blacksite Mod Manager v2.0.0`.
  - Update `electron/preload.cjs` fallback version to `2.0.0`.
  - Update `metadata.json` version and description.

### 3. Public GitHub Release Packaging
- **GitHub Actions Release CI/CD (`.github/workflows/release.yml`)**:
  - Automatically triggers on tag pushes matching `v*.*.*`.
  - Checks out code, sets up Node.js with caching, installs dependencies.
  - Runs build and lint verification.
  - Builds the production web app and packages the Windows installer (`.exe`) and portable binary via `electron-builder`.
  - Automatically generates a GitHub Release with release notes and attaches the installer binaries (`.exe`) and checksums.
- **Comprehensive Public `README.md`**:
  - Professional tactical header banner with new patch emblem.
  - Badges: Release v2.0.0, License, SPT compatibility (3.8.x - 4.x), Node.js / Electron.
  - Key Features showcase (1-Click Batch Updater, Fika Support, Conflict Resolver, Deep Clean Uninstaller).
  - Quick Start & Installation instructions for Windows desktop and web modes.
  - Keyboard shortcuts, mod layout directory structure, and contribution guide.
- **GitHub Open-Source Release Standards**:
  - `.github/ISSUE_TEMPLATE/bug_report.md` for structured bug reporting.
  - `.github/ISSUE_TEMPLATE/feature_request.md` for community suggestions.
  - `.github/pull_request_template.md` for community PRs.
  - Verify `LICENSE` (MIT) and ensure `.gitignore` excludes build artifacts and local caches.

---

## 2. Verification Plan

1. **Build & Type Check**:
   - Run `compile_applet` to verify TypeScript builds with zero errors.
   - Run `lint_applet` to confirm clean codebase.
2. **Visual & UI Inspection**:
   - Verify top-left window titlebar displays the new patch image alongside `Blacksite Mod Manager - v2.0.0`.
   - Verify Header shows the official patch emblem.
   - Verify browser favicon reflects the new icon.
   - Verify Windows Download modal displays `v2.0.0`.
3. **Release Assets Inspection**:
   - Verify `.github/workflows/release.yml` syntax and steps.
   - Verify `package.json` scripts and electron-builder configurations.
   - Verify `README.md` formatting and badges.
