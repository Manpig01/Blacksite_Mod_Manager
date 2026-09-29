# Blacksite Mod Manager — Dev Agent Prompt Pack

Ready-to-paste prompts for driving the coding agent that maintains **Blacksite Mod Manager** (WPF, .NET 8.0).

## How to use this pack

> **📌 2026-09-18 repo audit:** the repo was cloned and audited (see `blacksite-audit.md`). Main takeaway: **run Section 5.0 (hermetic test harness) before any feature work** — the current test suite crashes on any machine except the original dev's. Section 5's table below reflects which features already exist vs. still needed.

1. **Start every new session** by pasting the **Master Context Prompt** (Section 1). It gives the agent the full project state so it stops guessing.
2. **Then paste exactly one Task Prompt** (Section 2) per session. One task at a time keeps the agent focused and makes regressions easy to attribute.
3. If the agent drifts (renames branding, restructures XAML, breaks tests), stop it and re-paste the **Standing Constraints** block (Section 4).
4. For work not covered here, use the templates in Section 3.
5. Version note: the UI mandates the exact string `Blacksite Mod Manager - ALPHA v1.8.0`. The only prompt that overrides this is 2.1 (version bump). If the agent changes the version string in any other task, treat it as a defect.

---

## 1. Master Context Prompt (session bootstrap)

```text
PROJECT CONTEXT — Blacksite Mod Manager (read fully before any work)

You are continuing development of "Blacksite Mod Manager" (formerly "Dragon Den Mod Manager"), a Windows desktop mod manager for Single Player Tarkov (SPT) and Fika.

IDENTITY & VERSION
- App name: Blacksite Mod Manager. UI title must read exactly "Blacksite Mod Manager - ALPHA v1.8.0" unless I explicitly request a version change.
- Stack: C# / WPF on .NET 8.0, Windows x64, single-file publish target "BlacksiteModManager.exe".
- Icons: multi-resolution app.ico embedded in the executable; emblem.png used as the titlebar emblem (derived from the shield logo).

ARCHITECTURE YOU MUST RESPECT

1. Extraction engine
   - High-performance parallel extraction using Parallel.ForEachAsync with a byte-based 150ms throttle gate.
   - Optimized 1MB buffers opened with FileOptions.Asynchronous | FileOptions.SequentialScan.
   - Final placement uses atomic Directory.Move operations to bypass live Anti-Virus file-locking issues.
   - Standalone 7-Zip support: 7za.exe and 7za.dll bundled at tools/7zip/win/, wrapped by SevenZipService.cs, used alongside the in-process SharpCompress engine.

2. SPT 4.x layout support
   - Detects SPT_Runtime folder structures and routes mods correctly:
     * Server mods -> SPT_Runtime/user/mods
     * Client plugins -> BepInEx/plugins
     * EscapeFromTarkov_Data overlays -> mapped to the game root.
   - One-time legacy-to-4.x migration is handled by SptLayoutMigrator.cs.
   - Migration safety rules (non-negotiable): safe moves only; never delete a non-empty folder; assumes user/mods is the legacy source and SPT_Runtime/user/mods is the target; merges data overlays; cleans up legacy folders safely.

3. Startup sweep: cleans temp artifacts matching bs-staging-* and bs-extract-* on launch. Keep these prefixes stable.

4. UI (do not restructure without an explicit request)
   - Custom dark titlebar via WindowStyle="None" with drag/double-click behaviors and caption buttons.
   - 3-column responsive mod grid using VirtualizingWrapPanel.
   - Compact fixed-height (220px) mod cards with large 135x135 rounded-corner thumbnails, SPT version / Fika compatibility badges, and unified action rows.
   - Conflict warnings render as yellow badges on cards.
   - Layout is defined by MainWindow.xaml; card/theme design lives in Dark.xaml.
   - All namespaces and branding are fully migrated from "Dragon Den" to "Blacksite" — never regress this.

5. Config editor: in-app modal that scans .json, .jsonc, .cfg, and .yaml files; supports direct disk writes/saves with dirty-state tracking.

6. Conflict detector: background scanner identifying duplicate DLLs (client) and duplicate package IDs (server).

7. Launcher: integrated process-based launcher that monitors the server console for "Server is ready" or "Server is running" before chaining the client launch; includes a double-launch guard.

8. Build/publish
   - csproj: tools copied with CopyToOutputDirectory="PreserveNewest".
   - Custom post-publish target (AfterTargets="Publish") copies loose tools into the single-file publish directory, because single-file publish excludes loose content by default. Never remove this target.

9. Testing & validation
   - Test harness suite (QueueSmokeTest, FilterSmokeTest, etc.) covering 147+ assertions — keep all green.
   - BAML audit: zero leftover "Dragon Den" strings.
   - Binding audit: all 110+ bindings resolved.
   - Key reference files: SptLayoutMigrator.cs (SPT 4.x restructuring), SevenZipService.cs (standalone extraction), MainWindow.xaml (UI layout), Dark.xaml (card/theme design).

WORKING AGREEMENT
- Before writing code: state a short plan and list the files you intend to touch.
- After code changes: build the project, run the test harness and audits, and report results.
- Do not rename namespaces, rebrand, or restructure the XAML layout unless I explicitly ask.
- If a request conflicts with the constraints above, call it out before proceeding.
```

---

## 2. Task Prompts

### 2.1 — Version bump & release checklist

```text
TASK: Prepare the next alpha release.

Current context: Blacksite Mod Manager, WPF/.NET 8, single-file publish. The UI currently mandates the exact string "Blacksite Mod Manager - ALPHA v1.8.0".

Requirements:
1. Bump the version to ALPHA v1.9.0 everywhere it appears: the titlebar string, any version constants/assembly info, and any About UI. The final title string must be exactly "Blacksite Mod Manager - ALPHA v1.9.0" with no extra spacing or casing drift.
2. Produce a release checklist you execute: build in Release, run the full test harness (147+ assertions must pass), run the BAML audit (zero "Dragon Den" leftovers) and the binding audit (all bindings resolved).
3. Run a dotnet publish and verify: (a) BlacksiteModManager.exe is produced as a single file, (b) tools/7zip/win/7za.exe and 7za.dll exist as loose files next to the exe via the AfterTargets="Publish" target, (c) the app icon is embedded.
4. Report a pass/fail table for each checklist item.

Do not change any behavior, layout, or styling in this task — version strings and release verification only.
```

### 2.2 — Extraction: 7za-first with SharpCompress fallback

```text
TASK: Harden the extraction pipeline so 7za.exe (via SevenZipService.cs) is the primary extraction path, with the in-process SharpCompress engine as automatic fallback.

Constraints:
- Keep the existing Parallel.ForEachAsync pipeline, 150ms byte-based throttle, 1MB buffers with FileOptions.Asynchronous | FileOptions.SequentialScan, and atomic Directory.Move finalization intact for the SharpCompress path.
- Verify tools/7zip/win/7za.exe and 7za.dll exist at startup (log a warning if missing) and fall back to SharpCompress if they are absent.
- Fallback triggers: 7za returns a non-zero exit code, 7za binary missing, or unsupported archive type.
- Never extract directly into the live game folder — continue staging through bs-staging-* / bs-extract-* temp dirs that the startup sweep already cleans.
- Preserve SPT 4.x path routing (SPT_Runtime/user/mods, BepInEx/plugins, EscapeFromTarkov_Data -> game root) for BOTH engines. Add a shared post-extraction routing step if the two engines currently diverge.

Acceptance:
- Add/extend harness tests covering: 7za success path, 7za failure -> SharpCompress fallback, and identical final layout regardless of engine.
- Report which archive types route to which engine.
```

### 2.3 — SptLayoutMigrator: dry-run preview & rollback safety

```text
TASK: Add a dry-run preview mode and stronger rollback safety to SptLayoutMigrator.cs.

Context: The migrator performs one-time moves from legacy layout (user/mods) to SPT 4.x (SPT_Runtime/user/mods), merges EscapeFromTarkov_Data overlays to the game root, and cleans up legacy folders. Safety rules: only empty folders are deleted, non-empty folders are never touched.

Requirements:
1. Dry-run mode: produce a plain-language plan of every move/merge/delete it WOULD perform, without touching disk. Surface this in the UI as a confirmation step before the real migration.
2. Journaling: write a migration journal (JSON) of every completed operation before/after each step so an interrupted migration can report exactly where it stopped.
3. Rollback: if a step fails, restore already-moved items using the journal. Never delete anything during rollback.
4. Keep the existing invariants: user/mods = legacy source, SPT_Runtime/user/mods = target, only empty legacy folders deleted.
5. Extend the test harness with cases: interrupted migration recovery, mods present in BOTH legacy and target locations (merge, not overwrite), and a legacy folder that is empty (safe delete) vs non-empty (left alone).

Report the exact journal schema you implemented.
```

### 2.4 — Conflict detector: resolution actions

```text
TASK: Extend the conflict detector from detection to resolution.

Current behavior: a background scanner finds duplicate client DLLs and duplicate server package IDs and shows yellow warning badges on mod cards.

Requirements:
1. A conflict details view listing each conflict with: conflicting mod(s), the duplicate file/package ID, full paths, and file size/date.
2. Resolution actions per conflict: disable one mod's conflicting file (config/marker-based, not deletion), delete a specific duplicate file (to recycle bin if possible, not permanent delete), and "ignore this conflict" persisted across restarts.
3. After any resolution, re-run the background scan and update the yellow badges on affected cards.
4. Log all resolution actions to a local log file.
5. Do not change the card layout in MainWindow.xaml / Dark.xaml beyond the badge refresh logic.

Acceptance: harness tests for conflict detection after each action type, and persistence of "ignore" entries.
```

### 2.5 — Mod profiles (enable/disable sets)

```text
TASK: Add named mod profiles so users can switch mod loadouts.

Design requirements:
1. A profile = a named set of enabled/disabled mods (client plugins and server mods). Stored as JSON under the app's data folder.
2. Switching profiles: physically moves disabled mods' files out of the live paths (SPT_Runtime/user/mods, BepInEx/plugins) into a managed storage folder, and moves them back when re-enabled. Reuse the atomic Directory.Move pattern from the extraction engine to avoid AV locks.
3. Never move anything during a running server/client (respect the double-launch guard state).
4. UI: add a profile selector to the existing chrome in MainWindow.xaml consistent with the current dark design in Dark.xaml. Do not restructure the grid or card layout.
5. Guard rails: warn before switching if the config editor has unsaved dirty state; refuse to switch if a conflict-detector scan is mid-run.
6. Startup must reconcile disk state against the active profile (e.g., files manually deleted by the user) and self-heal or prompt.

Acceptance: harness tests for profile create/switch/reconcile, including a simulated crash between move operations.
```

### 2.6 — Launcher: configurability & robustness

```text
TASK: Improve the integrated SPT launcher.

Current behavior: process-based launcher that waits for "Server is ready" or "Server is running" in the server console output before launching the client, with a double-launch guard.

Requirements:
1. Configurable server launch arguments and client launch arguments (persisted settings).
2. Timeout handling: if the ready marker doesn't appear within N minutes (default 5), abort the chain, show the captured console tail in an error dialog, and never launch the client.
3. Capture full server console output to a rotating log file (keep last 5 runs).
4. Handle these failure modes explicitly: server exe missing, client exe missing, server exits before ready, user cancels mid-wait. Each must reset the double-launch guard so the launcher isn't wedged.
5. Optional: detect Fika installations and display a Fika badge state consistent with existing badges in Dark.xaml.
6. Keep marker strings configurable in one place in code, since SPT updates may change "Server is ready" / "Server is running" wording.

Acceptance: unit tests using a fake process stream for the marker wait, timeout, and early-exit paths.
```

### 2.7 — Config editor: backups & multi-file search

```text
TASK: Extend the in-app config editor.

Current behavior: modal editor scanning .json, .jsonc, .cfg, .yaml; direct disk writes; dirty-state tracking.

Requirements:
1. Automatic backup before each save: copy the original to a backups folder with timestamp, keep last N (default 10) per file, and add a "restore backup" action.
2. Multi-file search: search across all discovered config files, showing matches with file name and line number; clicking a result opens that file focused at that line.
3. Dirty-state guard on window close and app shutdown (prompt to save/discard) — currently only tracked in the modal.
4. Validate JSON/JSONC files after edit and warn (with line number) before saving invalid content; allow force-save.
5. Do not change the modal's opening flow or the file-scan locations.

Acceptance: harness tests for backup rotation and the JSON validation warning path.
```

### 2.8 — Diagnostics bundle export

```text
TASK: Add a "Export diagnostics bundle" action (no telemetry, purely local).

Requirements:
1. Bundle into a single zip on the user's desktop: app version string, OS version, detected SPT installation path + detected layout version (legacy vs 4.x), launcher logs, extraction error logs, conflict-detector summary, and the active profile list (names only).
2. Exclude: any mod file contents, any user config values, any personal folders outside the game/app directories.
3. Never include the 7za binaries or the game's own files.
4. Add the action to the existing chrome/menu consistent with MainWindow.xaml styling; use the standard modal pattern.
5. If any source file is locked (AV), skip it, note the skip inside the bundle, and continue.

Acceptance: harness test that builds a bundle from fixture folders and asserts the manifest contents and exclusions.
```

### 2.9 — Publish output verification script

```text
TASK: Create a PowerShell verification script (verify-publish.ps1) that validates a release build output.

The script must:
1. Run dotnet publish with the project's existing single-file settings (do not modify the csproj unless a flag is genuinely missing — if you must change it, explain why first).
2. Assert: BlacksiteModManager.exe exists and is a single-file bundle; tools/7zip/win/7za.exe and 7za.dll exist as LOOSE files next to the exe (post-publish target working); app.ico embedded (check file size heuristic + report); no "Dragon Den" strings in the built resources.
3. Assert the version string "Blacksite Mod Manager - ALPHA v1.8.0" appears in the app resources (update the expected string via a -ExpectedVersion parameter so future bumps don't break the script).
4. Exit non-zero with a clear failure list if any check fails; print a green PASS summary otherwise.
5. Add a harness test or documentation line describing how to run it.
```

### 2.10 — Test harness expansion for the two riskiest services

```text
TASK: Expand the test harness coverage for SptLayoutMigrator.cs and SevenZipService.cs.

Current state: harness suite (QueueSmokeTest, FilterSmokeTest, etc.) with 147+ assertions, BAML audit, binding audit.

Requirements:
1. SptLayoutMigrator: fixture-based tests building temp directory trees that mimic real SPT installs (legacy and 4.x). Cover: clean legacy migration, already-migrated idempotency (running twice = no-op), partial migration (some mods moved), mods in both locations, EscapeFromTarkov_Data overlay merge, empty vs non-empty legacy folder cleanup.
2. SevenZipService: cover zip/7z/rar inputs, archives with nested folders, archives containing SPT_Runtime structures, password-protected archives (graceful error), and corrupt archives (graceful error + fallback path).
3. Assert final directory layouts exactly (no stray temp dirs left behind; bs-staging-*/bs-extract-* cleaned).
4. Keep the whole suite runnable in one command and report the new total assertion count.
5. Do not modify production code except where a test exposes a genuine bug — if you find one, fix it and call it out explicitly.
```

---

## 3. Reusable templates

### 3.A — Bug fix

```text
TASK: Bug fix.

SYMPTOM: <what the user sees, exact error text, and which screen/button>
REPRO STEPS: <numbered steps from launch>
EXPECTED: <correct behavior>
ACTUAL: <wrong behavior>

CONTEXT: Blacksite Mod Manager, WPF/.NET 8 single-file build. Relevant code likely in <file(s)>.

RULES:
1. Diagnose root cause first and explain it in one paragraph before fixing.
2. Smallest possible fix; no drive-by refactors, no branding/layout changes.
3. Keep the title string exactly "Blacksite Mod Manager - ALPHA v1.8.0".
4. After fixing: build, run the harness (147+ assertions), and add one regression test that fails without your fix.
```

### 3.B — New feature

```text
TASK: New feature — <one-line description>.

USER STORY: As a user, I want <capability> so that <benefit>.

REQUIREMENTS:
1. <requirement>
2. <requirement>
3. <requirement>

CONTEXT & CONSTRAINTS:
- Blacksite Mod Manager, WPF/.NET 8, single-file publish; UI layout lives in MainWindow.xaml, theme/cards in Dark.xaml.
- Follow existing patterns: staging via bs-staging-*/bs-extract-* dirs, atomic Directory.Move finalization, background scans updating card badges, modal dialogs for editors.
- Keep the mandated title string "Blacksite Mod Manager - ALPHA v1.8.0" unchanged.
- Do not restructure the grid, card layout, or window chrome.

ACCEPTANCE:
- Build passes; full harness (147+ assertions) green; BAML and binding audits clean.
- New feature covered by at least <N> harness assertions.
- Brief usage note appended to the app's README/notes if one exists.
```

### 3.C — Refactor (behavior-preserving)

```text
TASK: Refactor — <what and why>. Zero behavior change.

SCOPE: <files/classes>. Do NOT touch: MainWindow.xaml layout structure, Dark.xaml card design, branding strings, csproj publish targets.

RULES:
1. Public behavior, log output, file layout on disk, and temp folder naming must be identical before/after.
2. Prove it: run the full harness before and after, and state both results.
3. If you discover a latent bug, stop refactoring that area, report it, and wait for my go-ahead.
```

### 3.D — Code review / audit

```text
TASK: Audit — do not write production code in this task.

Review <area, e.g., "the extraction pipeline" or "SptLayoutMigrator.cs"> for:
1. Correctness: race conditions, partial-failure handling, AV-lock scenarios, temp dir cleanup.
2. Constraint compliance: staging dirs named bs-staging-*/bs-extract-*; atomic Directory.Move; no direct writes to live game folders; safe migration (never delete non-empty folders).
3. SPT 4.x routing: server mods -> SPT_Runtime/user/mods, client plugins -> BepInEx/plugins, EscapeFromTarkov_Data -> game root.

Deliverable: a findings list ranked by severity, each with file/line, why it matters, and a suggested fix. Wait for my approval before implementing anything.
```

### 3.E — Regression sweep

```text
TASK: Full regression sweep before I test a build by hand.

1. Build Release.
2. Run the complete harness; report pass/fail counts and any new failures vs the 147+ baseline.
3. Run the BAML audit (zero "Dragon Den" strings) and binding audit (all bindings resolved).
4. Grep the repo for: leftover "Dragon Den" branding, hard-coded absolute paths, direct extraction into live game folders, and any change to the version string.
5. dotnet publish and verify single-file exe + loose tools/7zip/win/* next to it.
6. Summarize as a checklist I can eyeball in 30 seconds.
```

---

## 4. Standing constraints (append to any prompt)

```text
STANDING CONSTRAINTS (always apply):
- UI title must be exactly "Blacksite Mod Manager - ALPHA v1.8.0" unless this task explicitly bumps the version.
- Never regress "Dragon Den" -> "Blacksite" branding (BAML audit must stay clean).
- WPF/.NET 8, Windows x64, single-file publish to BlacksiteModManager.exe; keep the AfterTargets="Publish" tools-copy target and CopyToOutputDirectory="PreserveNewest" for tools/7zip/win/.
- Never delete non-empty folders during migration; never extract directly into live game folders; keep bs-staging-*/bs-extract-* temp naming.
- Preserve the extraction engine's Parallel.ForEachAsync + 150ms throttle + 1MB async/sequential buffers + atomic Directory.Move design.
- All harness assertions (147+) plus BAML and binding audits must pass before you report done.
- One task per response cycle: plan first, then implement, then verify and report.
```

---

## 5. Feature backlog prompts (roadmap)

> **⚠️ REPO-CALIBRATED (2026-09-18 audit):** the code is further along than the original handoff summary. **Already shipped:** live sp-mod.com catalog (~1,900 mods, `SpModApiClient.cs`), dependency resolution (`DependencyDialog`, `GET /mods/dependencies`), semver version selection (`SemVer.cs`), live update checks, config editor, install queue engine. **Top real finding: the test harness is NOT hermetic** — it downloads live mod archives, references hardcoded `/tmp/*` fixture paths from the original dev's machine, pins assertions to live catalog state (already failing), and crashes via unhandled exceptions. **Run 5.0 before any feature work.**

Priorities grounded in the current SPT ecosystem (2026): mods are distributed via **SPT Forge** (forge.sp-tarkov.com) and **sp-mod.com**, which track per-release SPT compatibility flags; Fika co-op groups run **headless clients** (a second full SPT instance that needs mod parity with the host); and at least one competing open-source manager already ships "Forge integration" — its public changelog is full of path-detection bugs, which is exactly where Blacksite's migration engine is strongest.

| # | Feature | Priority | Why |
|-----|---------|----------|-----|
| 5.0 | **Hermetic test harness** | **P0 — DO FIRST** | Audit finding #1: current suite crashes on any machine but the original dev's |
| 5.1 | Startup layout audit & self-heal | P0 | Differentiator; competitor ships exactly these bugs |
| 5.2 | sp-mod.com / Forge client hardening | P1 | Catalog integration **exists** — needs offline fallback + recorded fixtures (audit finding #3) |
| 5.3 | Update flow: config-safe updates | P1 | Update *checks* exist; config-safe apply + batch update still needed |
| 5.4 | Ownership manifest + clean uninstall + orphan sweeper | P1 | Most mod managers uninstall incompletely |
| 5.5 | Install snapshots (full-state rollback) | P2 | Pairs with 5.3/5.4 |
| 5.6 | Fika headless / second-instance mod sync | P2 | Big for co-op groups; few tools do it well |
| 5.7 | Crash log triage | P2 | High wow-factor, moderate effort |
| 5.8 | Dependency hardening | P2 | Resolution **exists** — add version-range checks + disabled-dep detection |
| 5.9 | Quick wins: drag-drop install, URL paste, in-app server console | P3 | Cheap UX wins |

Also: repo has a single commit and no CI (audit finding #2) — instruct the agent to commit after every task.

Each prompt below is pasted after the Master Context Prompt, like any Section 2 task.

### 5.0 — Make the test harness hermetic (DO THIS FIRST)

```text
TASK: Make the smoke-test harness hermetic so it runs identically on any machine, with no live network and no machine-specific paths. This is a blocking task — nothing else ships until the suite is reproducible.

Audit evidence (already reproduced on a clean machine):
- QueueSmokeTest crashes at section E: FileNotFoundException /tmp/medatt.zip (fixture downloaded from sp-mod.com mod ID 147, then referenced via hardcoded /tmp paths — see QueueSmokeTest/Program.cs:83-105, 275 and InstalledSmokeTest/Program.cs:26-34).
- InstalledSmokeTest fails Detect() assertions for /tmp/voicepatcher.rar, /tmp/freecam.zip, /tmp/realism.zip (files that don't exist off the original dev's machine), then crashes on /tmp/medatt.zip.
- FilterSmokeTest: 67 pass, 2 FAIL — "contains 4.1.5 (newest)" and "versions are unique" assert against LIVE catalog data that has since changed.

Requirements:
1. Fixtures into the repo: check in the small real archives the tests rely on under tests/fixtures/ (medatt.zip, voicepatcher.rar, freecam.zip, etc.). If any fixture is too large, generate a minimal synthetic archive with the same structural properties (same wrapper layout, same archive kind) and document the mapping. Copy fixtures to the test output dir via csproj — NEVER reference /tmp paths.
2. Record/replay for API tests: add an optional recorded-JSON mode to SpModApiClient tests (store real API responses as fixture files; tests run offline against them). Live-network tests may remain but must be opt-in via a flag/env var, and must SKIP with a clear "[SKIP] reason" line when the flag is off or the network fails.
3. Unpin live-data assertions: no test may assert a specific version is "newest" or assert exact catalog contents. Assert structural properties (monotonic ordering, uniqueness where the data model guarantees it, filter behavior against constructed inputs).
4. No unhandled crashes: one failing section must not abort the run. Wrap sections so every Check() reports, then print a final "RESULT: N passed, M failed, K skipped" and exit non-zero only on real failures.
5. Add a run-all script (run-tests.ps1 + run-tests.sh) that builds and runs all four harnesses and prints a combined summary. The baseline after your fix must be: 0 crashes, 0 network dependencies, all previously-green checks still green.
6. Commit your work with a clear message (repo currently has a single commit; start building real history — commit after every task from now on).

Report: the new baseline numbers (passed/failed/skipped per harness) and a list of every test you changed or replaced.
```

### 5.1 — Startup layout audit & self-heal

```text
TASK: Add a startup layout audit that detects and optionally repairs mod files in wrong locations.

Context: Blacksite already detects SPT 4.x layouts and routes server mods to SPT_Runtime/user/mods, client plugins to BepInEx/plugins, and EscapeFromTarkov_Data overlays to the game root. Competing managers have shipped bugs where mods land in the wrong place after a layout change (e.g., leftover user/mods in the game root, stale saved install paths).

Requirements:
1. On startup (after the existing temp sweep), run a fast audit that flags: a legacy user/mods folder in the game root, mod DLLs/packages in pre-4.x locations, and any saved install path that no longer exists or no longer looks like an SPT install.
2. If issues are found, show a non-blocking banner: "N layout issues detected — Review". The review dialog lists each issue in plain language with a per-item Fix action and a Fix All, reusing SptLayoutMigrator's safe-move rules (never delete non-empty folders, atomic Directory.Move).
3. If nothing is wrong, the audit must be invisible (no dialogs, < 1s on typical installs).
4. Persist audit results so cards for mods that were moved keep their correct state.
5. Extend the harness with fixture trees: healthy 4.x install (zero findings), legacy leftovers (findings + successful repair), stale path settings.

Do not modify SptLayoutMigrator's move logic — call into it.
```

### 5.2 — sp-mod.com / Forge client hardening

> **Calibration:** basic catalog browsing + one-click install via sp-mod.com **already exists** (`SpModApiClient.cs`, `https://sp-mod.com/api/v0/`). This prompt is now about hardening it (audit finding #3). Re-run after modifying it: "Audit the SpModApiClient against the live API and report schema drift" is a good follow-up.

```text
TASK: Harden the sp-mod.com catalog client (SpModApiClient.cs) for offline resilience and schema drift.

Requirements:
1. A catalog view (new tab/dialog, styled per Dark.xaml) listing Forge mods with name, author, download count, short description, and the per-release SPT compatibility flag Forge publishes.
2. Detail view with description and available releases; each release shows its declared SPT compatibility.
3. One-click install: download the archive to the standard temp staging dirs, then run the EXISTING extraction + routing pipeline (7za-first, staging dirs, atomic Directory.Move). No new extraction logic.
4. Compatibility gate: if a release's declared SPT version does not match the detected install, show a clear warning but allow override.
5. Fika badge: if Forge marks a release Fika-compatible, the resulting card gets the existing Fika badge automatically.
6. Network layer: all requests must have timeouts, retries with backoff, and a clear offline/error state. Cache catalog JSON locally for fast startup.
7. Do not scrape HTML if a JSON/API endpoint exists — investigate Forge's API first and document which endpoints you used in the code.

Acceptance: harness tests with recorded/fixture API responses covering install success, compatibility warning, and API failure fallback. Real network calls must be mockable.
```

### 5.3 — Update flow: config-safe updates

> **Calibration:** live update *checks* already exist (per csproj description and README). The new value here is the **config-safe apply** path (preserve user configs across an update, back up old version, batch update) and rollback. Adjust step 2 to "reuse the existing update-check mechanism" rather than building one.

```text
TASK: Add mod update checking and config-safe updating.

Requirements:
1. Detect installed mod versions: server mods from package.json in SPT_Runtime/user/mods, client plugins from BepInEx plugin metadata (or DLL version info). Store per-card.
2. Check installed versions against Forge latest (reuse 5.2's network layer; if 5.2 isn't built yet, check against a local JSON manifest the user can paste/edit).
3. Cards with updates get a distinct badge consistent with the existing yellow conflict badge system (different color, e.g., blue).
4. "Update" action must be config-safe: before replacing a mod's files, preserve its user config (server mod config folders, BepInEx plugin cfg files), install the new version via the standard pipeline, then restore configs, skipping files the new version ships (new version wins). Back up the old version's entire folder to a backups dir first.
5. Batch "Update All" with per-mod progress and a summary of what succeeded/failed.
6. Never update while server/client is running (respect launcher state).

Acceptance: harness tests for version detection, config preservation on update (config edited by user survives), and rollback when the new version fails to extract.
```

### 5.4 — Ownership manifest, clean uninstall & orphan sweeper

```text
TASK: Track file ownership per mod so uninstalls are complete, and detect orphaned files.

Requirements:
1. During every install (all sources: manual archive, Forge, update), record a manifest: mod identity, installed file list with relative paths and hashes, install date, source archive name. Store under the app's data folder.
2. Uninstall deletes exactly the manifest's files, then removes now-empty parent dirs (only empty dirs). For pre-manifest installs ("unknown ownership"), uninstall falls back to deleting the mod's top-level folder and warns that leftovers may remain.
3. Background orphan sweeper (like the conflict scanner): scans live mod paths for files not claimed by any manifest and not part of a clean base install; shows an "Orphans" review dialog with per-file ignore/delete (delete to recycle bin where possible). NEVER flag or delete files belonging to SPT itself, BepInEx core, or Fika core — maintain a protected-paths list.
4. The manifest is also the source of truth for the conflict detector's duplicate DLL/package reporting — refactor it to read ownership, and note any behavioral changes.
5. Manifest writes must be crash-safe (write-temp-then-rename).

Acceptance: harness tests for install->uninstall round-trip (directory tree identical to pre-install except empty dirs), orphan detection with a protected file left untouched, and corrupted-manifest recovery.
```

### 5.5 — Install snapshots (full-state rollback)

```text
TASK: Add named snapshots of the entire mod state with one-click restore.

Design:
1. A snapshot = manifest of every installed mod (ownership manifests), the active profile, and content hashes of all owned files. Store hashes, not full copies, plus a per-mod backup of files that are hard to re-acquire (user-modified configs, mods not on Forge).
2. "Create snapshot" runs after any install/update optionally (setting, default on for updates).
3. "Restore snapshot": reverts via the atomic Directory.Move staging pattern — disabled/conflicting mods removed or restored to their exact prior state. If a file's hash matches the snapshot, skip; if it differs and the mod exists on the user's disk archive cache, restore from cache; otherwise prompt.
4. UI: snapshots listed in a dialog with date, mod count, and note field; restore requires confirmation and idle launcher state.
5. Snapshots must never restore INTO a running server/client, and must validate free disk space before starting (estimate first, abort safely if insufficient — nothing half-moved).

Acceptance: harness tests for restore-after-bad-update (state byte-identical to snapshot), snapshot with insufficient disk (simulated), and crash mid-restore recovery via the staging dir pattern.
```

### 5.6 — Fika headless / second-instance mod sync

```text
TASK: Support a second SPT installation (e.g., a Fika headless client) with mod syncing.

Requirements:
1. Multi-install support: the install registry holds N named SPT installs (e.g., "Main", "Headless"), each with its own detected layout, card grid filter, and launcher settings. Keep the current single-install flow as the default; second installs are opt-in via settings.
2. "Sync mods to..." action: pushes selected mods (or the whole active profile) from the main install to another install through the standard extraction/staging pipeline — never raw cross-folder moves between installs, to respect AV and partial-failure safety.
3. Part awareness: when syncing, flag mods that have server-only parts (server package without BepInEx plugin) vs client-needed parts, and show a summary "Headless is missing client plugin X" so co-op groups stay in sync.
4. Conflict detection and config editor must scope to the selected install.
5. Disk space check before any sync; never leave an install half-synced (staging + atomic moves per mod, journal per sync run).

Acceptance: harness tests with two fixture installs: sync happy path, partial sync failure recovery, and missing-client-part reporting.
```

### 5.7 — Crash log triage

```text
TASK: Add crash log triage that maps errors back to installed mods.

Requirements:
1. Watch for BepInEx LogOutput.log and SPT server logs (locations per detected layout). After the client or server exits non-zero, or the user opens "Diagnose last crash", parse the most recent log.
2. Extract: exception type, stack trace top frames, and the assembly/module names involved. Map assemblies to installed mods via the ownership manifest (5.4) or BepInEx plugin metadata as fallback.
3. Present a triage report dialog: likely culprit mod(s) ranked by involvement, the key error lines verbatim, and suggested actions (disable culprit, open its config, open its page).
4. Keep the report local-only. Offer "copy report" and "attach to diagnostics bundle" (integrates with the existing diagnostics export if present).
5. Handle: no log, log locked by AV, unparseable content, errors with no mod involvement (show "not mod-related" with generic guidance).

Acceptance: harness tests with fixture logs: clean exit, crash inside a known mod, crash inside game code, and a locked-log scenario.
```

### 5.8 — Dependency hardening

> **Calibration:** dependency resolution via `GET /mods/dependencies` and the install-time dependency dialog **already exist** (`DependencyDialog.xaml`). This prompt is now about deepening checks (version ranges, disabled-dep detection) rather than building detection from scratch.

```text
TASK: Detect and surface mod dependencies.

Requirements:
1. Server mods: read package.json dependencies (mod loader convention) — each dependency has a package name and version range.
2. Client plugins: read BepInEx plugin metadata dependencies where declared in the DLL.
3. Background check (with conflict scanner): missing dependency, dependency present but below required version (use a conservative semver comparison), and dependency present but disabled in the active profile.
4. Show a red "missing dependency" badge state on cards and a details dialog listing what to install/enable.
5. When installing from Forge (5.2), if the mod page declares dependencies, offer to install them together.
6. No automatic dependency installation outside the Forge flow — manual installs just warn.

Acceptance: harness tests for missing/old/disabled dependency detection and semver edge cases (prerelease tags, wildcard ranges).
```

### 5.9 — Quick-win batch

```text
TASK: Implement three small UX wins.

1. Drag-and-drop install: dropping archive file(s) onto the window queues them through the existing install pipeline, with the same progress UI as normal installs. Validate extensions before queueing.
2. Install from URL: an input in the toolbar/modal accepting a direct archive URL or a Forge mod page URL — download to staging, then standard pipeline. Timeouts + progress + cancel required.
3. In-app server console: a slide-up panel showing the live server console output the launcher is already capturing, with pause/copy/clear and a "reveal log file" link. Must not impact launcher performance (bounded buffer, UI virtualization).
All three must respect the mandated title string, Dark.xaml styling, and one-task-per-cycle verification rules. Add harness coverage where practical (drop validation, URL parsing).
```

---
