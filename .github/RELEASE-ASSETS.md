# Blacksite release asset policy

A `v*.*.*` tag publishes a GitHub Release with exactly these four uploaded assets:

1. `LICENSE`
2. `SHA256SUMS.txt` — SHA-256 hashes for the standalone executable and portable ZIP.
3. `BlacksiteModManager-win-x64.zip`
4. `BlacksiteModManager.exe` — the standalone, self-contained Windows x64 executable.

GitHub automatically provides its source-code ZIP and tar.gz archives for the tag; the workflow does not create or upload duplicate source archives. The portable ZIP contains the published application files, including any bundled 7-Zip tools.

`.github/workflows/build-release.yml` is the single source of truth for publishing and uploading these release assets.
