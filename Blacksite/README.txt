================================================================================
 BLACKSITE MOD MANAGER  BETA v1.9.0
 Single Player Tarkov (SPT) Mod Manager — built for the sp-mod.com ecosystem
================================================================================

WHAT THIS IS
------------
A standalone Windows executable (WPF, .NET 8, self-contained — no runtime
install needed) that browses the real sp-mod.com mod catalog, resolves
dependencies through the official API, and installs mods directly into your
SPT folder.

RUNNING
-------
1. Double-click BlacksiteModManager.exe.
   (First launch takes a few extra seconds — the single-file bundle unpacks
   the embedded .NET runtime to %TEMP%\net8.0-wpf.)
2. Click "Set SPT Directory" and pick your SPT root folder — the one that
   contains BepInEx\, user\ and EscapeFromTarkov.exe.
3. The SPT version is auto-detected when possible (from SPT.Core.dll);
   adjust the "SPT Version" box if needed. It is used to pick compatible
   mod releases and to resolve dependencies.
4. The catalog (~1,900 mods) loads automatically. "Refresh Catalog"
   re-runs the current query (see FILTERING & SORTING below).
5. Click Install on a card:
     - the API is queried for the mod's versions and the best release for
       your SPT version is selected (semver + constraint aware),
     - GET /mods/dependencies is checked; if anything is missing you get a
       dialog offering to install the dependencies first,
     - the real .zip streams to %TEMP%\{modId}.zip with live MB/s progress,
     - it is extracted/merged into your SPT root (BepInEx\plugins,
       user\mods, etc., exactly as packaged) with overwrite,
     - the temp zip is deleted and the status bar reports completion.

FILTERING & SORTING ENGINE (new in v1.2.0)
-------------------------------------------
Catalog (Browse Mods tab) — every control maps to REAL, verified query
parameters on GET https://sp-mod.com/api/v0/mods; the server does the
filtering and the grid re-renders from the live response:

  • Search bar      → query=<text>. Real-time (300 ms debounce), matches
                      mod names, teasers/descriptions and author names.
  • SPT constraint  → filter[spt_version]=X.Y.Z, e.g. "SPT 3.11.4". The
                      dropdown is populated live from GET /spt/versions
                      (50 releases, 3.7.1 → 4.1.5, each with its mod count).
                      Your last selection is saved to settings.json and
                      restored on the next launch.
  • Category        → filter[category_id]=N. Populated live from
                      GET /mod-categories (Weapons, Traders, Tools, …).
  • Fika compatible → filter[fika_compatibility]=1, surfaces only mods
                      explicitly marked Fika-compatible (green 🤝 badge
                      also appears on matching cards).
  • Sort            → sort= parameter: Most Downloaded (sort=-downloads),
                      Most Recent (sort=-published_at), Alphabetical A–Z /
                      Z–A (sort=±name), Most Endorsed, Most Favourited.
  • Clear All Filters resets every filter and sort to its default state.

Installed Mods tab — instant client-side filtering of the scanned grid:

  • Text filter (300 ms debounce) matches package.json names, author
    metadata and package IDs.
  • Toggles: Hide Disabled Mods · Hide Out-of-Date Mods · Show Only Server
    Mods · Show Only Client Plugins (the last two are mutually exclusive).
  • Clickable column headers (Mod / Type / Status / Version) sort the grid
    ascending/descending with ▲/▼ indicators; Version sorts semantically
    (v1.2.10 < v1.10.0).
  • "Clear Filters" resets the bar, toggles and sorting to defaults.

DOWNLOAD ENGINE HARDENING (new in v1.2.0)
-----------------------------------------
Large mod downloads that get cut off mid-transfer (the "Incomplete
download: expected N bytes but got N-9" failure) are now retried and
RESUMED: the downloader keeps the partial .part file, re-requests the
missing byte range via the HTTP Range header, and falls back to a clean
restart if the host ignores Range. Up to 6 attempts, stall-guarded reads,
and the file only appears at its destination once its size is verified
complete. A .part left behind by a crashed run is resumed on the next try.

PARALLEL STAGED EXTRACTION ENGINE (performance overhaul)
--------------------------------------------------------
The extraction engine is aggressively optimized for SPT archives with
thousands of tiny files (database JSONs):
• Phase A — every archive is extracted into a unique
  %TEMP%\\bs-extract-* staging folder: tiny files (< 1 MB) are
  extracted CONCURRENTLY on ProcessorCount workers (Parallel.ForEachAsync
  over batches, one independent archive reader per worker), while large
  media/bundle files extract sequentially alongside them so RAM stays
  bounded. Destination streams use a 1 MB buffer with
  FileOptions.Asynchronous | FileOptions.SequentialScan.
• Phase B — once all streams are closed, the staged tree moves into the
  SPT root at directory granularity: brand-new mod folders land via a
  single atomic Directory.Move (a rename — no per-file writes through
  the live game directory, which is what real-time antivirus scans hit
  file-by-file). Merging into existing trees recurses per child;
  cross-volume moves fall back to high-speed per-child moves.
• Progress is BYTE-based (Interlocked totals) and dispatch-gated: at
  most one UI update per 150 ms — updates in between are dropped, so
  thousands of tiny files can never flood the WPF dispatcher.
• Crashed runs leave no litter: bs-extract-* staging folders are swept
  at startup and by "Clear Temp Files".

UPDATE ENGINE REWRITE, ONE CARD PER MOD & BETA (new in v1.9.0-BETA)
-------------------------------------------------------------------
• The "Update available" verdict is now computed with strict semantic
  version comparison (central VersionUtils parser): the orange Update
  button appears ONLY when the Forge version parses strictly newer than
  the installed one. Formatting drift ("v4.1.0" vs "4.1.0", "-release"
  suffixes, " RC2" annotations) can no longer fabricate updates.
• One card per mod: client + server halves of the same mod (e.g. a
  BepInEx plugin + its user\mods server package) are consolidated into a
  single Installed Mods card with both category pills; uninstall/disable
  act on every component path.
• 1-click updates persist the installed version (verified from the
  package.json/DLL on disk), so mods no longer appear outdated again
  after a restart.
• Extraction rebuilt on a 7-Zip-first pipeline (bundled official engine,
  in-process fallback) with atomic placement and cancellation at any
  point; bs-staging-old-* rollback asides for safe folder replacement.
• Version bumped to v1.9.0-BETA (titlebar, window title, assembly).

STANDALONE 7-ZIP EXTRACTION
----------------------------
• Bundles the official standalone 7-Zip console binaries (7za.exe +
  7za.dll, x64) under tools\7zip\win\, copied to the output folder on
  every build.
• SevenZipService.ExtractArchiveAsync(archive, destination) extracts any
  7-Zip-supported archive with its full directory tree via
      7za.exe x "{archive}" -o"{destination}" -y -bso0
  running headless (no window, stderr captured) and fully asynchronous so
  the UI never blocks.
• Binary resolution: the bundled tools\7zip\win\7za.exe next to the
  running executable first; falls back to a system-installed 7-Zip
  (Program Files, or 7z/7za on PATH) when the bundled file is missing; a
  handled error is raised when neither is available.
• Exit codes: 0 = success, 1 = warning (extraction still succeeded),
  >= 2 = fatal error / corrupted archive (detailed standard error is
  logged).

SPT 4.1 SPT_RUNTIME LAYOUT FIX
------------------------------
• SPT 4.1 keeps the SERVER runtime (SPT.Server.exe and user\mods) inside
  an "SPT_Runtime" child folder of the install root (the 4.0-era name was
  "SPT"). The manager detects that layout automatically and installs
  server mods into:
      <root>\SPT_Runtime\user\mods
• BepInEx stays where it was: client plugins keep installing into the
  install root's BepInEx\plugins (<root>\BepInEx\plugins), which is the
  correct SPT 4.1 location. (Only if a game keeps its BepInEx inside the
  runtime folder — root has none of its own — is the client path
  runtime-prefixed.) Classic 3.x installs keep working exactly as before.
• Mod archives that ship an EscapeFromTarkov_Data overlay (asset/audio
  replacement mods) now merge it into the install root's
  EscapeFromTarkov_Data folder instead of stranding it inside user\mods.
• One-time migration: if the manager previously installed server mods
  into the old root\user\mods on a 4.x install, it offers to move them
  into SPT_Runtime\user\mods (a stray user\mods\EscapeFromTarkov_Data is
  merged into the root data folder; mods that already exist in the
  runtime are left untouched and nothing non-empty is ever deleted).
  BepInEx is never touched by the migration.
• SPT version detection ("Detected SPT 4.1.5" badge) and the integrated
  launcher (SPT.Server.exe / SPT.Launcher.exe) now also resolve through
  the SPT_Runtime folder.

UNIFIED CARD GRID, APP ICON & THUMBNAILS (new in ALPHA v1.8.0)
---------------------------------------------------------------
• Executable icon: the Blacksite shield emblem, embedded as a
  multi-resolution .ico (16-256px) via <ApplicationIcon>.
• The custom titlebar now shows the transparent shield emblem next to
  the app name "Blacksite Mod Manager - BETA v1.9.0".
• Installed Mods was rebuilt onto the exact same card grid as Browse:
  3-column responsive wrap layout, vertical-only scrolling, compact
  220px-tall cards on #181b20 with 8px corners and 6px margins.
• Installed cards carry the same 135x135 rounded thumbnail (cached web
  image from sp-mod.com with a letter placeholder fallback) with the
  green "★ SPT x" badge top-left, "Fika Compatible" bottom-left, and a
  yellow conflict/duplicate warning button top-right (click for details
  from the built-in conflict scanner).
• Card content: bold 14px title, package id, orange author pill + gray
  kind/category pills, "Latest vX • Downloads N" metadata row, and a
  2-line description with word ellipsis.
• Installed action row (compact 28px): Edit Configs, Update (when one
  is available), a green/red Disable-Enable toggle (.disabled folder
  suffix) and Uninstall (confirmation dialog).
• Latest-version/SPT badges are shared session-wide with the Browse
  grid (one API fetch per mod, reused by both views).

REBRAND: BLACKSITE MOD MANAGER (new in v1.8.1)
----------------------------------------------
• The app is now "Blacksite Mod Manager" everywhere: window titlebar,
  taskbar/window title, footer, dialogs, crash-log messages, API
  User-Agent (BlacksiteModManager/1.0), temp-artifact prefixes, the
  executable (BlacksiteModManager.exe) and its .NET namespaces/assembly.
• Settings, crash log and the thumbnail cache now live under
  %AppData%\BlacksiteModManager / %LocalAppData%\BlacksiteModManager.
  (Data from the previous Dragon Den folders is not migrated — set your
  SPT folder once after updating.)
• The copyright symbol was removed from the UI; the footer now shows the
  plain app name.

3-COLUMN COMPACT CARD GRID (new in v1.8.0)
-------------------------------------------
• Browse Mods now lays mods out in a responsive 3-column grid that wraps
  to the window width and scrolls strictly vertically (horizontal
  scrolling disabled, vertical auto).
• Cards are compact and uniform: fixed 220px height, ~1/3 of the window
  width, 6px margins, #181b20 background, 8px corner radius.
• The thumbnail is now a large 135x135 square on the card's left
  (UniformToFill, rounded 6px corners, clipped) with the green "★ SPT x"
  badge overlaid top-left and the "Fika Compatible" badge bottom-left.
• Content area: bold 14px title with ellipsis, package id, orange author
  pill + gray category pills, "Latest vX.X.X • Downloads X,XXX,XXX"
  metadata row, a 2-line description with word ellipsis, and a compact
  28px action row (bright green Install / dark gray Mod Page).
• Version string updated to v1.8.0 (titlebar + window title).

UI STYLE OVERHAUL (new in ALPHA v0.0.8)
---------------------------------------
• Custom borderless window: dark titlebar with the Blacksite logo and
  "Blacksite Mod Manager - ALPHA v0.0.8", plus native-style Minimize /
  Maximize-Restore / Close buttons with hover highlights (close hovers
  red). Drag the titlebar to move; double-click to maximize.
• Navigation tabs: Browse Mods · Installed Mods · Settings — the active
  tab carries the orange (#ea580c) underline. No other tabs.
• Browse Mods: refreshed filter rows — "Search mods or type @Author..."
  with dark Clear / Refresh buttons, a live "Showing X of Y" counter,
  Hide Featured / Hide Contains Ads / Hide Contains AI / Hide Installed
  toggles, SPT / category / sort / per-page dropdowns, a "Fika Comp
  Only" toggle and ◄ Prev / Page N/M / Next ► pagination.
• Mod cards in a responsive 2-column grid: green "★ SPT x" thumbnail
  badge (the release's own SPT constraint, fetched live), a
  "Fika Compatible" overlay on the thumbnail, bold title, orange author
  pill, dark gray tag pills, a "Latest vX.X.X • Downloads X,XXX,XXX"
  stats row (live versions API), multiline description with ellipsis,
  bright green Install (#16a34a) and dark gray Mod Page (#374151).
• Installed Mods: action bar (Refresh · Enable All · Disable All ·
  Client Folder · Server Folder · Uninstall All) with a live
  "X installed mods." status, plus a filter bar (search, Clear,
  Alphabetical (A→Z) sort dropdown, Updates first / Hide Disabled
  toggles).
• Footer: the app name on the left, Installation
  Queue center, transfer progress right.

CONFIG EDITOR, CONFLICT DETECTION & SPT LAUNCHER (new in v1.7.0)
----------------------------------------------------------------
• In-app config editor: the "📝" button on every Installed Mods card opens
  "Edit Configs" — a dark modal that recursively scans the mod's folder for
  .json / .jsonc / .cfg / .yaml (.yml) files, lists them in a sidebar and
  edits the selected one in a large scrollable text box (Enter and Tab are
  entered as text, as an editor should). "Save Changes" writes the edited
  text directly back to the file on disk; unsaved edits are confirmed
  before closing or switching files. Read-only files are unlocked first.
• Conflict & duplicate detector: right after the installed-mods scan, a
  background task checks for duplicate client .dll filenames across
  different BepInEx/plugins subfolders and duplicate server package IDs
  (package.json "name"/"id") across user/mods folders — including your
  custom configured paths. Affected mod cards get a yellow "⚠" badge;
  clicking it shows a dialog with the exact conflicting files. A summary
  appears in the status bar ("⚠ 2 conflicts detected on 3 mods").
• Integrated SPT launcher: the green "🚀 Launch SPT" button in the header
  starts SPT.Server.exe (or Aki.Server.exe) as a real OS process with its
  console output redirected into the app, waits for the "Server is ready"
  / "Server is running" phrase, then automatically starts
  SPT.Launcher.exe (or Aki.Launcher.exe) so you can hop into the game.
  A double-launch guard prevents a second server while one is running,
  and if the server exits before becoming ready you get its last console
  lines in the error dialog.

BROWSE-MODS VERTICAL SCROLLING FIX (new in v1.6.2)
---------------------------------------------------
Fixed the real cause of the missing vertical scrolling in Browse Mods: the
virtualized wrap panel was laying cards out in COLUMNS that extended
horizontally (and horizontal scrolling is disabled by design), so cards
were clipped off-screen and the wheel had nothing to scroll. The panel now
arranges cards in ROWS that wrap at the current window width and extend
DOWNWARD — the mouse wheel scrolls the catalog strictly vertically, and
every card is reachable at any window size.

NAVIGATION & SCROLLING FIXES (new in v1.6.1)
---------------------------------------------
• The Settings tab sits directly in the top navigation bar, right after
  "Browse Mods" and "Installed Mods" — clicking it highlights the tab with
  the orange underline accent and switches the main content view.
• Vertical scrolling enforced everywhere: the Browse Mods card grid and the
  Installed Mods list both run with horizontal scrolling DISABLED and
  vertical scrolling AUTO — the mouse wheel only ever scrolls up/down.
• The Browse Mods grid is a responsive wrap panel: cards wrap horizontally
  to fit the current window width and the grid grows downwards.
• The Installed Mods list is now width-adaptive: the Mod column absorbs the
  remaining window width, so the Status/Version/Actions columns (and their
  buttons) never overflow off-screen — no more side-to-side scrolling or
  clipped rows at smaller window sizes.

SETTINGS TAB & HIGH-SPEED EXTRACTION ENGINE (new in v1.6.0)
----------------------------------------------------------
• New "Settings" tab in the top navigation:
    - SPT Folder: path field + "Browse…" folder dialog. The SPT version is
      detected automatically from package.json, SPT.Server.exe / Aki.Server.exe
      version info or the SPT core assemblies, shown in a read-only green
      "Detected SPT [version]" badge.
    - Mod Paths: configurable client (default BepInEx/plugins) and server
      (default user/mods) mod subpaths with a live preview of the final
      folder paths. Custom paths apply everywhere — extraction routing,
      the installed-mods scanner and 1-click updates — and older installs
      in default locations stay visible.
    - Bottom action bar:
        · "Save" — persists all settings to %AppData%\BlacksiteModManager\settings.json
        · "Clear Cache" — purges cached API data (in-memory + on-disk thumbnails)
        · "Clear Temp Files" — deletes leftover .zip/.rar/.7z archives and
          extraction artifacts from the Windows temp folder
        · "Clear Log Files" — erases local app log files (crash.log)
• High-speed extraction engine:
    - Progress dispatches are throttled to at most one per 100 ms or per full
      1% increment — archives with hundreds of entries no longer flood the
      WPF rendering loop (400-file archive: ~100 updates instead of 402).
    - All extraction copies run through 1 MB buffers with
      FileOptions.Asynchronous | FileOptions.SequentialScan for maximum disk
      write throughput; the whole pipeline runs asynchronously off the UI
      thread (Task.Run offload + async streams end-to-end).
    - Temp archives are closed and deleted immediately after extraction
      completes (success or failure), on the background thread.

VERSION SELECTION, CHANGELOGS, DEPENDENCY RESOLVER & TOASTS (new in v1.5.0)
-------------------------------------------------------------------------
• Every catalog card now has a "🕘 Versions" button: it opens the version
  selection modal ("Install [Mod Title]") with one card per published
  release, straight from GET /mod/{id}/versions — no mock data.
• Each version card shows the release number, a blue "Latest" pill on the
  newest release, a Fika badge ("Fika Compatible" / "Fika unknown"), the
  per-version download count, the publication date, a green SPT-version
  pill (from the release's own compatibility constraint), the download
  size, and a bright green Install button for that exact release.
• Interactive changelogs: a "Changelog ▼" toggle on every card expands a
  dark inset box with the real release notes (HTML converted to readable
  plain text); the arrow flips to ▲ when expanded.
• Dependency resolver: clicking Install resolves the release's dependency
  tree against your SPT folder via GET /mods/dependencies. If anything is
  missing, the "Dependencies required" dialog lists the exact missing
  mods ("• WTT - CommonLib → v3.0.6"), warns "Choose your option wisely,
  there may be dragons here..." and offers three choices:
      - "Install mod + dependencies" (green): queues every dependency
        FIRST, then the requested mod.
      - "Install without dependencies" (red): queues only the mod.
      - "Cancel" (gray): aborts.
• Toast notifications: every mod, dependency or local archive added to
  the Installation Queue pops a bottom-right toast — "Queued" in bold
  green, "[Mod Title] added to download queue." — fading in smoothly and
  auto-dismissing after 3.5 seconds. Up to 5 stack at once.
• Installing a specific OLD release is fully supported end-to-end (the
  queue task downloads exactly the version you picked).

MULTI-FORMAT ARCHIVE ENGINE — .zip / .rar / .7z (new in v1.4.0)
----------------------------------------------------------------
• "Install from file…" (Browse tab) loads REAL archives from your disk
  — pick one or many .zip / .rar / .7z files and each is pushed into the
  Installation Queue as a live task card: same layout-aware routing
  (user\mods vs BepInEx\plugins), same byte-accurate progress, no
  download and no temp copy (the picked file is read directly).
• Format detection reads the file HEADER (magic bytes: PK…, Rar!…,
  7z¼¯…'), not just the extension. If the header is unrecognizable the
  extension routes the open attempt (.zip/.rar/.7z). Self-extracting /
  prefixed archives (data before the zip signature) are handled by
  locating the true zip start and reading through an offset-shifted view.
• Extraction is unified through SharpCompress (ArchiveFactory) for
  .rar/.7z and System.IO.Compression for .zip, with byte-accurate
  progress for every format: totalUncompressedBytes = Σ entry sizes,
  extractedBytes accumulates per entry, exact % = extracted/total × 100.
• Overwrites are fully supported (updating/reinstalling mods); read-only
  or broken-permission files are removed first so extraction always
  succeeds.
• Temp hygiene: every downloaded temp archive is deleted from
  Path.GetTempPath() when extraction completes (success OR failure), and
  a startup sweep removes artifacts left behind by crashed runs
  (bs-staging-* mirrors, *.update.pkg, *.zip.part).

INSTALLATION QUEUE & REAL-TIME EXTRACTION PROGRESS (new in v1.3.0)
----------------------------------------------------------------
• Click Install on as many mods as you like, back-to-back. Every install
  is pushed into a real background queue (Channel<T> drained by a
  semaphore-gated consumer) — the UI never blocks.
• The footer has an "Installation Queue" label with a live count badge and
  an "Open installation queue" button (bottom-center). The queue window
  shows two tabs — "Install Queue" (running/waiting tasks) and
  "Completed" — plus live counters (Current: X | Queue: Y | Completed: Z)
  and a "Clear Completed" button.
• Each task card streams real data: Queued ("Pending…" badge),
  Downloading (live progress bar, MB/s speed, downloaded MB / total MB),
  Extracting (byte-accurate percentage), Completed (green check with
  timestamp) or Failed (red badge with the exact exception message).
• Extraction progress is file-by-file and byte-accurate: the archive is
  opened with ZipFile.OpenRead, the total uncompressed size is computed
  from Σ entry.Length, each entry is extracted with overwrite and the
  exact percentage (extractedBytes / totalUncompressedBytes × 100) is
  reported through IProgress<double> to the footer and the queue cards.
  (RAR/7z packages get the same per-entry byte accounting via
  SharpCompress.)
• Successful queue tasks automatically refresh the Installed Mods scan.

DOWNLOAD FIX IN v1.3.0
----------------------
Fixed the "Incomplete download: expected 117,232,656 bytes but got
117,232,647" failure. Root cause (verified live against the real host):
sp-mod.com's API metadata can be a few bytes larger than the actual file
on the download host — More Energy Drinks v1.3.0's metadata says
117,232,656 bytes while GitHub (where the link redirects) serves a
117,232,647-byte file. The HTTP transfer itself completed perfectly; the
old code rejected it because the API's stale number disagreed.
Now: the transfer layer still enforces the host's own Content-Length
(with Range-based resume), and when the API metadata disagrees the
ARCHIVE ITSELF arbitrates — a structurally complete zip (intact central
directory) installs fine; a genuinely truncated file still fails loudly.
A host that answers a resume attempt with "416 + Content-Range: bytes */
REALTOTAL" is now reconciled too.

FIX IN v1.2.1
-------------
Fixed a startup crash ("Provide value on 'System.Windows.Baml2006.
DeferredBinaryDeserializerExtension' threw an exception") caused by an
invalid WPF brush literal ("None") inside the new ComboBox/CheckBox
templates — WPF stores such literals in compiled BAML and only converts
them when the control is first shown, so it slipped past the compiler.
The crash dialog now also shows the full inner-exception chain instead
of only the outer wrapper.

INSTALLED MODS TAB (v1.1.0)
---------------------------
The "Installed Mods" tab is backed by a real scan of your disk:

  • user\mods\*        → server mods. package.json is parsed when present
                         (name/id, version, author(s), main entry, sptVersion);
                         otherwise the mod's DLL version resources are read.
  • BepInEx\plugins\*  → client plugins. Plugin folders are inspected for
                         manifest.json (Thunderstore-style) and their DLLs are
                         read via PE metadata for the [BepInPlugin(guid, name,
                         version)] attribute — no assemblies are ever loaded.
                         Loose plugin DLLs are detected the same way; the SPT
                         core folder is excluded.

  • Check for Updates sends every recognized package ID + version to
    GET https://sp-mod.com/api/v0/mods/updates (with your SPT version) and
    flags rows: "Update available → vNew", "Up to date", "incompatible" or
    "blocked", exactly as reported by the server.
  • Update (1-click): streams the recommended archive to %TEMP%, verifies it
    (zip/rar/7z — dead links returning HTML are detected), extracts into a
    staging mirror, deletes the old mod folder and merges the new files into
    user\mods or BepInEx\plugins, then cleans up and rescans.
  • Disable/Enable renames the mod's folder/file with a ".disabled" suffix
    (the convention SPT and BepInEx honor) — real filesystem renames, instant
    status change in the list.
  • Uninstall asks for confirmation (MessageBox) and then recursively deletes
    the mod's folder or DLL from user\mods / BepInEx\plugins.

DATA & SETTINGS
---------------
Settings + install history : %AppData%\BlacksiteModManager\settings.json
Thumbnail cache            : %LocalAppData%\BlacksiteModManager\thumbs
Crash log (if any)         : %AppData%\BlacksiteModManager\crash.log

NETWORKING
----------
All data comes live from https://sp-mod.com/api/v0 (catalog, filter
taxonomies, versions, dependencies) and the linked file hosts for
downloads. A sliding-window
rate limiter (40 req/10 s burst, 200 req/60 s sustained) plus automatic
HTTP 429 handling with Retry-After parsing keeps you inside API limits;
transient 5xx/network errors are retried with exponential backoff.

NOTES
-----
- Windows may show a SmartScreen prompt for unsigned executables — click
  "More info" → "Run anyway".
- Mods are installed exactly as their authors packaged them. Read mod pages
  (🌐 button) for special setup instructions some mods require.
- Requires an internet connection; the app talks only to sp-mod.com,
  files.sp-mod.com and the download hosts it redirects to.

BUILD INFO
----------
Published with:
  dotnet publish -c Release -r win-x64 --self-contained true
      -p:PublishSingleFile=true -p:UseWPF=true
Target: net8.0-windows, WPF, self-contained single file (win-x64).
================================================================================
