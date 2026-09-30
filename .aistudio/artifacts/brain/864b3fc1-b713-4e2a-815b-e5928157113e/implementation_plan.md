# Fix electron-builder Artifact Naming Macro in Windows CI

Resolve the packaging failure in GitHub Actions:
`cannot expand pattern "Blacksite-Mod-Manager-${target}-${version}.${ext}": macro target is not defined`

## User Review & Critical Decisions

> [!IMPORTANT]
> In `electron-builder`, `${target}` is not a supported macro in the top-level or `win` configuration.
> 
> To generate clearly named installers and portable executables without errors, artifact naming must be specified under each target's own block (`nsis` and `portable`), using valid macros (`${version}`, `${ext}`, `${arch}`).

- **Confirmed Decision**: Move artifact naming to target-specific blocks:
  - `nsis.artifactName`: `Blacksite-Mod-Manager-Setup-${version}.${ext}`
  - `portable.artifactName`: `Blacksite-Mod-Manager-Portable-${version}.${ext}`
  - Also provide missing `description` and `author` fields in `package.json` to eliminate electron-builder packaging warnings.

---

### 1. Overview & Core Concept

- **The Error**: During `npx electron-builder --win --x64`, after successfully building and packaging the unpacked application, electron-builder attempted to format the output filenames using:
  `"artifactName": "Blacksite-Mod-Manager-${target}-${version}.${ext}"`
  Because `target` is not a recognized macro variable in electron-builder, execution stopped with exit code 1.
- **The Solution**: Configure target-specific output filenames under `build.nsis` and `build.portable`.

---

### 2. User Experience & Visual Design

- **Installer Name**: `Blacksite-Mod-Manager-Setup-1.8.0.exe` (clean, recognizable for standard Windows installation).
- **Portable Name**: `Blacksite-Mod-Manager-Portable-1.8.0.exe` (clean, recognizable for running directly without installation).
- Aligns perfectly with the download links documented in the automated GitHub Releases.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Target-Specific `artifactName` Configuration**
  - *Chosen Approach*:
    ```json
    "nsis": {
      "artifactName": "Blacksite-Mod-Manager-Setup-${version}.${ext}",
      ...
    },
    "portable": {
      "artifactName": "Blacksite-Mod-Manager-Portable-${version}.${ext}"
    }
    ```
  - *Why*: Supported natively by electron-builder across all versions without macro interpolation errors.
  - *Alternatives Considered*: Using generic `${productName}-${version}.${ext}` on `win` block. This would cause naming collisions between the NSIS installer and the portable binary. Setting explicit names per target gives distinct files.

- **Decision 2: Add `description` and `author` to `package.json`**
  - *Chosen Approach*: Add `description: "Next-generation mod manager and server orchestrator for Single Player Tarkov"` and `author: "Blacksite Development Team"`.
  - *Why*: Electron-builder logs warnings when these standard metadata fields are absent from `package.json`.

---

### 4. Technical Architecture & File Changes

```
package.json
├── "description": "Next-generation mod manager..."
├── "author": "Blacksite Development Team"
└── "build": {
      "win": {
        "target": ["nsis", "portable"]
        // (Removed invalid top-level artifactName macro)
      },
      "nsis": {
        "artifactName": "Blacksite-Mod-Manager-Setup-${version}.${ext}"
      },
      "portable": {
        "artifactName": "Blacksite-Mod-Manager-Portable-${version}.${ext}"
      }
    }
```
