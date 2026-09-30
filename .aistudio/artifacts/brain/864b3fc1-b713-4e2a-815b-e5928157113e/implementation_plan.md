# Fix Rollup Windows Native Binary Dependency in CI Build

Resolve the Vite/Rollup build failure (`Cannot find module @rollup/rollup-win32-x64-msvc`) on the GitHub Actions Windows runner by ensuring platform-specific optional binaries are installed during the CI dependency step.

### User Review & Critical Decisions

> [!IMPORTANT]
> **Root Cause Identified from GitHub Actions Run**:
> The `Compile Web Application` step failed during `vite build` with:
> `Error: Cannot find module @rollup/rollup-win32-x64-msvc. npm has a bug related to optional dependencies (https://github.com/npm/cli/issues/4828).`
>
> When npm lockfiles are generated on Linux, npm does not automatically resolve Windows-specific native binary optional dependencies (`@rollup/rollup-win32-x64-msvc`). When GitHub Actions runs on `windows-latest`, standard `npm install` skips this optional binary, causing Vite's Rollup bundler to crash when spawning the native compiler.

- **Fix 1: Explicit Optional Dependency in `package.json`**:
  - Add `@rollup/rollup-win32-x64-msvc` under `optionalDependencies` in `package.json` so package managers recognize it across platforms.
- **Fix 2: Guaranteed Binary Installation in GitHub Actions Workflow**:
  - Update the `Install Dependencies` step in `.github/workflows/build-windows-exe.yml` to:
    ```yaml
    - name: Install Dependencies
      run: |
        npm install --include=optional
        npm install --no-save @rollup/rollup-win32-x64-msvc@^4.0.0
    ```
  - This ensures the exact Windows MSVC native rollup binary required by Vite 6 / Rollup 4 is always present on the Windows runner before `npm run build` executes.

---

### 1. Overview & Core Concept

- **What It Does**: Supplies the Windows-native Rollup binary (`@rollup/rollup-win32-x64-msvc`) directly during the GitHub Actions Windows CI pipeline, enabling `tsc -b && vite build` to compile successfully into `dist/`.
- **Outcome**: `npm run build` will complete cleanly in 3-5 seconds, allowing the subsequent `electron-builder` step to package `Blacksite-Mod-Manager-Setup-1.8.0.exe` and `Blacksite-Mod-Manager-Portable-1.8.0.exe` and attach them to your GitHub Release.

---

### 2. CI/CD Architecture Adjustments

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Current Failing Step                            │
│                                                                        │
│   npm run build -> tsc -b && vite build                                │
│   └── ❌ Error: Cannot find module '@rollup/rollup-win32-x64-msvc'     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       Resolved CI Workflow Steps                       │
│                                                                        │
│   1. actions/checkout@v4                                               │
│   2. actions/setup-node@v4 (Node 22)                                   │
│   3. Install Dependencies:                                             │
│      ├── npm install --include=optional                                │
│      └── npm install --no-save @rollup/rollup-win32-x64-msvc@^4.0.0   │
│   4. Compile Web Application (tsc -b && vite build) -> Success!        │
│   5. electron-builder --win --x64 -> Generates NSIS & Portable .exe    │
│   6. Publish Release to Manpig01/Blacksite_Mod_Manager-TEST            │
└────────────────────────────────────────────────────────────────────────┘
```
