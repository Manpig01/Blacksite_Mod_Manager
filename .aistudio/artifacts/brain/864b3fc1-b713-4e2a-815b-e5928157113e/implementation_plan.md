# Fix Tailwind Oxide Windows Native Binding in GitHub Actions CI

Resolve the `@tailwindcss/oxide` compilation failure on Windows GitHub Actions runner (`Error: Cannot find native binding. npm has a bug related to optional dependencies #4828`).

## User Review & Critical Decisions

> [!IMPORTANT]
> The build error is caused by npm's known cross-platform lockfile issue: when `package-lock.json` is checked in from a Linux environment, Windows CI runners fail to download platform-specific optional native packages (`@tailwindcss/oxide-win32-x64-msvc`).
>
> We will resolve this comprehensively on both the CI workflow level and in `package.json`.

- **Confirmed Decision**: Remove `package-lock.json` dynamically on the Windows runner prior to installation, and force-install all four native Windows binaries required by Vite, Tailwind v4, Esbuild, and Rollup.

---

### 1. Overview & Core Concept

- **Problem**: When running `tsc -b && vite build` on Windows in GitHub Actions, Vite loads `vite.config.ts`, which imports `@tailwindcss/vite`. `@tailwindcss/vite` imports `@tailwindcss/oxide`, which fails with:
  `Error: Cannot find native binding. npm has a bug related to optional dependencies (https://github.com/npm/cli/issues/4828).`
- **Solution**:
  1. Update `.github/workflows/build.yml` on the Windows runner to delete the Linux-generated `package-lock.json` before `npm install`, allowing npm on Windows to compute a clean native dependency tree.
  2. Add `@tailwindcss/oxide-win32-x64-msvc` alongside `@rollup/rollup-win32-x64-msvc`, `lightningcss-win32-x64-msvc`, and `@esbuild/win32-x64` in explicit installation commands and `package.json`'s `optionalDependencies`.

---

### 2. User Experience & Visual Design

- This is a continuous integration pipeline fix. All application frontend UI, dark cyberpunk aesthetics, mod manager tools, and local server integration remain pristine and unaffected.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Dynamically removing `package-lock.json` in Windows CI runner**
  - *Chosen Approach*: `if (Test-Path package-lock.json) { Remove-Item package-lock.json }` before `npm install` on the runner.
  - *Why*: As documented in npm issue #4828, removing the cross-platform lockfile on a fresh CI runner forces npm on Windows to evaluate native dependencies natively for `win32-x64`, ensuring all required binary bindings are downloaded.
  - *Alternatives Considered*: Manually listing every transitive dependency's native module. By removing the lockfile AND explicitly installing the known binaries, we guarantee complete immunity against npm optional dependency failures.

- **Decision 2: Comprehensive `optionalDependencies` in `package.json`**
  - *Chosen Approach*: Explicitly declare all four Windows packages:
    - `@tailwindcss/oxide-win32-x64-msvc`
    - `lightningcss-win32-x64-msvc`
    - `@rollup/rollup-win32-x64-msvc`
    - `@esbuild/win32-x64`
  - *Why*: Guarantees that any Windows development machine running `npm install` directly will recognize and fetch all four required binaries.

---

### 4. Technical Architecture & CI Pipeline Flow

```
┌─────────────────────────────────────────────────────────────┐
│                   GitHub Actions Runner                     │
│                      (windows-latest)                       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Step: Install Dependencies                  │
│  1. Remove Linux package-lock.json                          │
│  2. npm install --include=optional                          │
│  3. npm install --no-save:                                  │
│     - @tailwindcss/oxide-win32-x64-msvc                     │
│     - lightningcss-win32-x64-msvc                           │
│     - @rollup/rollup-win32-x64-msvc                         │
│     - @esbuild/win32-x64                                    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               Step: Compile Web Application                 │
│                 tsc -b && vite build                        │
│   (Vite loads config, Tailwind Oxide & LightningCSS OK)     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│              Step: Package with Electron-Builder            │
│               npx electron-builder --win --x64              │
│       -> Produces Setup .exe and Portable .exe              │
└─────────────────────────────────────────────────────────────┘
```
