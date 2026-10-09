# Release Packaging: Standalone Installer ZIP Archive

Automate the creation and publishing of `Blacksite-Mod-Manager-Setup-2.0.0.zip` containing solely `Blacksite-Mod-Manager-Setup-2.0.0.exe` in the GitHub Actions CI/CD release workflow, generate its cryptographic SHA256 checksum, and document it for release distribution.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following requirements were confirmed during the clarification step:

- **Archive Filename**: Confirmed as `Blacksite-Mod-Manager-Setup-2.0.0.zip`.
- **In-App Download UI**: Per user confirmation, the in-app Windows Download modal will **not** be modified. The ZIP archive is strictly maintained as an official GitHub Releases download asset.
- **Checksum Verification**: The `SHA256SUMS.txt` generation step will include the `.zip` archive alongside all `.exe` binaries to ensure integrity.

---

## 1. Overview & Core Concept

- **What It Does**: Enhances the Windows release packaging pipeline (`.github/workflows/release.yml`) so that whenever a release tag (e.g., `v2.0.0`) is pushed or manually triggered via `workflow_dispatch`, the runner compresses the compiled `Blacksite-Mod-Manager-Setup-2.0.0.exe` installer into a standalone `.zip` archive containing only that installer executable.
- **Target Audience**: Single Player Tarkov (SPT) and Fika modders whose browsers, corporate firewalls, or Windows Defender SmartScreen policies quarantine or block direct `.exe` downloads, or users who prefer downloading zipped archives.
- **Key Value**: Guarantees zero friction for end users downloading Blacksite Mod Manager from GitHub Releases without requiring extra manual packaging steps by the maintainer.

---

## 2. User Experience & Visual Design

- **GitHub Release Page Experience**:
  - The release assets table on GitHub will list:
    1. `Blacksite-Mod-Manager-Setup-2.0.0.exe` (Windows NSIS setup installer)
    2. `Blacksite-Mod-Manager-Setup-2.0.0.zip` (Clean ZIP archive containing solely the setup executable)
    3. `Blacksite-Mod-Manager-Portable-2.0.0.exe` (Standalone portable single-file binary)
    4. `SHA256SUMS.txt` (Integrity manifest containing hashes for `.exe` and `.zip` files)
- **Documentation**:
  - `README.md` will explicitly list the new ZIP asset under the Installation and Releases sections with direct link structures.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Native PowerShell `Compress-Archive` vs 7-Zip**
  - *Chosen Approach*: Use Windows-native PowerShell `Compress-Archive -Path $setupExe.FullName -DestinationPath $zipPath -Force` within the `windows-latest` GitHub Actions runner.
  - *Why*: Built into PowerShell 7/Core on Windows runners; creates standard Deflate-compatible `.zip` files readable natively by Windows Explorer, macOS, and Linux with zero external tool dependencies.
  - *Alternatives Considered*: 7z CLI or npm zip scripts; both add unnecessary moving parts and extra dependencies.

- **Decision 2: Single-Executable Archive Structure**
  - *Chosen Approach*: Compress only `Blacksite-Mod-Manager-Setup-2.0.0.exe` directly at the root of the ZIP file (no nested folder hierarchies).
  - *Why*: Directly satisfies the requirement for "just a Zip with the Blacksite-Mod-Manager-Setup-2.0.0.exe in it".

- **Decision 3: Unified Checksum Manifest**
  - *Chosen Approach*: Update the PowerShell checksum generation loop to scan both `release/*.exe` and `release/*.zip`.
  - *Why*: Users downloading the ZIP can verify the archive's SHA256 against `SHA256SUMS.txt` before unzipping.

---

## 4. Technical Architecture & CI/CD Strategy

### Release Workflow Flow

```
┌────────────────────────────────────────────────────────┐
│             GitHub Actions (windows-latest)            │
└────────────────────────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │  npx electron-builder --win --x64     │
        └───────────────────────────────────────┘
                            │
               Generates in release/
               • Blacksite-Mod-Manager-Setup-2.0.0.exe
               • Blacksite-Mod-Manager-Portable-2.0.0.exe
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │  Compress-Archive (PowerShell)        │
        │  Source: Setup-2.0.0.exe              │
        │  Target: Setup-2.0.0.zip              │
        └───────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │  Get-FileHash (SHA256)                │
        │  Hashes: *.exe + *.zip -> SHA256SUMS  │
        └───────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │  softprops/action-gh-release@v2       │
        │  Uploads:                             │
        │  • *.exe                              │
        │  • *.zip                              │
        │  • SHA256SUMS.txt                     │
        └───────────────────────────────────────┘
```

### Action Items
1. **Update `.github/workflows/release.yml`**:
   - Add the PowerShell step to create `release/Blacksite-Mod-Manager-Setup-2.0.0.zip` containing only the setup executable.
   - Expand the SHA256 checksum loop to include `release/*.zip`.
   - Update `files:` in `action-gh-release` to include `release/*.zip`.
   - Update the release body template to detail the new ZIP archive asset.
2. **Update `README.md`**:
   - Add reference to `Blacksite-Mod-Manager-Setup-2.0.0.zip` under the release downloads section.
3. **Verify Build & Configuration**:
   - Run compilation and lint check to ensure all files are valid.
