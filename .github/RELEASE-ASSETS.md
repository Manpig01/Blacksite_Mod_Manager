# Mandatory release asset policy

Every Blacksite release draft must include these five downloadable assets:

1. `Blacksite.exe` — the standalone, self-contained Windows x64 executable.
2. `Blacksite-win-x64.zip` — the portable package (and optional loose tools when present).
3. `SHA256SUMS.txt` — SHA-256 hashes for every other uploaded asset.
4. `Blacksite-source.zip` — source snapshot for the release commit.
5. `Blacksite-source.tar.gz` — source snapshot for the release commit.

`.github/workflows/release.yml` is the source of truth for building and uploading this list. Do not create a release workflow, release script, or release draft that omits the standalone EXE as a primary asset. The workflow validates the required files before publishing the GitHub release draft.
