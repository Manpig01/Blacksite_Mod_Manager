# Windows Executable Packaging & GitHub Actions Automated Release Pipeline

Transform Blacksite Mod Manager into a packaged Windows desktop application (`.exe`) with an automated GitHub Actions CI/CD release workflow on every push to the `main` branch, paired with a tactical top-bar download button and desktop release modal for players.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural parameters were confirmed through the interactive design review:

- **Confirmed Engine**: **Electron** packaged with **electron-builder** for native Windows runtime support, direct OS file system access, and standard Windows installer/portable distribution.
- **Confirmed Automation Trigger**: **On every push to the `main` branch** (with manual `workflow_dispatch` trigger fallback in GitHub Actions) to automatically build Windows binaries and attach them to a GitHub Release.
- **Confirmed In-App Presence**: A tactical **"Download Windows App (.exe)"** button in the header bar with an interactive release modal containing download options (Installer & Portable EXE), installation guidance, and desktop architecture benefits.

---

### 1. Overview & Core Concept

- **What It Does**: Packages the Blacksite React application into a standalone Windows desktop executable (`.exe`). Introduces an automated `.github/workflows/build-windows-exe.yml` GitHub Actions pipeline that triggers on repository pushes, compiles Vite assets, runs `electron-builder`, and publishes downloadable `.exe` releases on GitHub.
- **Target Persona**: Single Player Tarkov (SPT) players who want native Windows desktop convenience—direct access to their `C:\Games\SPT-Tarkov` folders, automated local mod installation without browser file upload sandboxing, and background server process monitoring.
- **Key Value**: Players can run Blacksite as a standalone Windows app or web app, with zero-friction automated builds delivered directly via GitHub Releases on every repository update.

---

### 2. User Experience & Visual Design

#### Key User Flows
1. **Header Action**:
   - The user spots a sleek, high-intent button in the top bar: **"Windows App (.exe)"** with a Windows/Download icon and subtle amber highlight accent.
2. **Release Modal Interaction**:
   - Clicking opens the **Blacksite Desktop Release Modal**.
   - Highlights the build version (`v1.8.0`), latest release status, and two primary action buttons:
     - **Setup Installer (`.exe`)**: Recommended standard NSIS installer with desktop shortcut and uninstaller.
     - **Portable Executable (`.exe`)**: Standalone single-file executable that runs without installation (ideal for thumb drives or drop-in SPT folders).
   - Features a clean 3-step tactical guide: *Download → Select SPT Folder → 1-Click Mod Loading*.
   - Includes a direct link to the GitHub Releases page and CI build status badge.
3. **Automated GitHub Delivery**:
   - When the user pushes to `main`, GitHub Actions spins up a `windows-latest` runner, builds the web assets, packages the binaries with `electron-builder`, and drafts/publishes a GitHub Release with downloadable artifacts.

#### Visual Identity & Theme
- **Aesthetic Direction**: Military/tactical utilitarian desktop UI adhering to Blacksite's dark graphite palette (`#121418`, `#181B20`, `#23272E`).
- **Color Discipline (60-30-10)**:
  - `60% Neutral Canvas`: `#121418` dark graphite backdrop.
  - `30% Structural Surfaces`: `#181B20` elevated surface panels, `#23272E` hairline borders.
  - `10% Accent Budget`: `#EA580C` / `#F97316` tactical orange for primary download actions; `#16A34A` green status dots for ready builds.
- **Typography & Layout**:
  - Unboxed metadata with typographic dots (`·`).
  - Monospace tabular numerals (`font-mono tabular-nums`) for version numbers, hash digests, and release dates.
  - Single-line controls with truncation guards.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Dual Distribution Target (NSIS Installer + Portable .exe)**
  - *Chosen Approach*: Configure `electron-builder` to generate both an NSIS installer (`Blacksite-Mod-Manager-Setup-1.8.0.exe`) and a zero-install portable executable (`Blacksite-Mod-Manager-Portable-1.8.0.exe`).
  - *Why*: Many Tarkov modders prefer portable executables placed directly adjacent to their SPT folder without registry modifications, while standard users prefer automated shortcuts.
  - *Alternative Considered*: MSIX / Microsoft Store packaging (rejected: requires expensive code signing certificates and restricts arbitrary filesystem access required for SPT mod injection).

- **Decision 2: Automated GitHub Actions Release Workflow**
  - *Chosen Approach*: Write a production-grade `.github/workflows/build-windows-exe.yml` running on `windows-latest`. It automatically generates a release tag on `main` push (e.g. `v1.8.0-build.<run_number>` or updating `latest`), packages the binaries, and publishes them using `softprops/action-gh-release` as well as uploading workflow build artifacts.
  - *Why*: Users get immediate access to compiled Windows binaries on every push without needing local Windows build tooling or cross-compilation on Linux.

- **Decision 3: Non-Breaking Desktop Wrapper Architecture**
  - *Chosen Approach*: Keep the current Vite + React SPA architecture 100% intact. Add an `electron/` directory containing lightweight main and preload scripts that load the local production bundle, preserving web browser preview functionality in AI Studio while enabling full desktop compilation.
  - *Why*: Guarantees zero regression to the existing web application and dev server in AI Studio.

---

### 4. Technical Architecture & CI/CD Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Local Development & Web                         │
│                                                                        │
│   src/ (React 19 + Tailwind v4 + Vite SPA)                             │
│   ├── Header.tsx ──> "Windows App (.exe)" Button                       │
│   └── WindowsDownloadModal.tsx ──> Direct Releases & Setup Guide       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ git push origin main
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     GitHub Actions CI/CD Pipeline                      │
│                  (.github/workflows/build-windows-exe.yml)             │
│                                                                        │
│   1. Checkout repository & setup Node.js 20                            │
│   2. npm ci / npm install                                              │
│   3. npm run build (TypeScript compile + Vite production bundle)       │
│   4. npx electron-builder --win (Packages NSIS & Portable .exe)        │
│   5. Publish Release with softprops/action-gh-release                  │
│      ├── Blacksite-Mod-Manager-Setup-1.8.0.exe                         │
│      └── Blacksite-Mod-Manager-Portable-1.8.0.exe                     │
└────────────────────────────────────────────────────────────────────────┘
```

#### Interactive Component & State Mapping
- `Header.tsx`: Houses the desktop download trigger button, styled consistently with the tactical interface.
- `WindowsDownloadModal.tsx`:
  - `isOpen`: Controls modal presence with smooth backdrop transition.
  - `activeTab`: Toggle between "Downloads" and "Quick Setup Guide".
  - `customRepoUrl`: Allows the user to point to their specific GitHub username/repository or view default release assets.
  - `onClose`: Clean backdrop and escape key dismissal.
- `package.json`:
  - Adds `electron`, `electron-builder`, and `concurrently` (as dev dependencies for packaging).
  - Adds build scripts: `"build:electron"`, `"package:win"`.
  - Configures `build` metadata (app ID, Windows NSIS/portable targets, file inclusions).
- `electron/main.cjs`:
  - Creates the Windows application window with dark background `#121418`, custom menu, native window controls, and loads `dist/index.html`.
