# Fix LightningCSS Windows Native Binary Missing Error in CI

Resolve the second platform-specific native binary failure on Windows (`Cannot find module '../lightningcss.win32-x64-msvc.node'`) caused by Tailwind CSS v4's `lightningcss` engine.

### User Review & Critical Decisions

> [!IMPORTANT]
> **Root Cause Identified from GitHub Actions Run**:
> During `npm run build`, Vite loads `vite.config.ts`, which imports `@tailwindcss/vite`.
> Tailwind v4 relies on `lightningcss`, which requires a native C++ node binary (`lightningcss.win32-x64-msvc.node`).
> Because `package-lock.json` was generated in a Linux environment, npm's optional dependency resolver skipped the Windows binary during CI.

- **Solution 1: Remove Linux-Generated Lockfile on Windows Runner**:
  - In `.github/workflows/build-windows-exe.yml`, remove `package-lock.json` on the Windows runner before running `npm install`. This forces npm to natively resolve dependencies for the current OS (Windows x64).
- **Solution 2: Explicitly Install Both Windows Native Modules**:
  - Run `npm install --no-save @rollup/rollup-win32-x64-msvc lightningcss-win32-x64-msvc` in the workflow.
- **Solution 3: Update `package.json`**:
  - Register `lightningcss-win32-x64-msvc` and `@rollup/rollup-win32-x64-msvc` in `optionalDependencies`.

---

### Technical Plan

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Current Failing Step                            │
│                                                                        │
│   vite.config.ts -> @tailwindcss/vite -> lightningcss                  │
│   └── ❌ Missing '../lightningcss.win32-x64-msvc.node'                 │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Permanent Windows Native Fix                         │
│                                                                        │
│   1. Remove Linux package-lock.json on runner                         │
│   2. Fresh npm install for Windows x64                                 │
│   3. Explicitly install:                                               │
│      - @rollup/rollup-win32-x64-msvc                                   │
│      - lightningcss-win32-x64-msvc                                     │
│   4. Run npm run build (tsc -b && vite build) -> SUCCESS              │
│   5. Package installer & portable .exe                                 │
└────────────────────────────────────────────────────────────────────────┘
```

#### Files to Update:
1. **`.github/workflows/build-windows-exe.yml`**:
   - Update `Install Dependencies` step to clear the Linux lockfile and install both Windows native binaries.
2. **`package.json`**:
   - Add `"lightningcss-win32-x64-msvc": "^1.32.0"` to `optionalDependencies`.
