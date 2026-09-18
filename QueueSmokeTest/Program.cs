// =============================================================================
// Blacksite — Installation Queue & Real-Time Extraction Progress smoke test
//
// Everything runs against the LIVE sp-mod.com API, REAL file hosts and REAL
// disk operations (no mocks of application logic, no fake timers):
//
//   A. THE REPORTED BUG, LIVE: install "More Energy Drinks" v1.3.0 (117 MB) whose
//      API metadata (117,232,656) is 9 bytes larger than the real GitHub-hosted
//      file (117,232,647). Previously failed with
//      "Incomplete download: expected 117,232,656 bytes but got 117,232,647."
//      → must now install successfully (archive structural validation arbitrates).
//   B. Metadata-mismatch arbitration via a real local HTTP fixture:
//      stale-metadata + intact archive → success; stale metadata + truncated
//      archive (destroyed central directory) → hard failure.
//   C. InstallQueueEngine: enqueue 3 REAL mods + 1 dead-link mod → sequential
//      processing, live state transitions (Queued→Downloading→Extracting→
//      Completed/Failed), byte-accurate extraction percent reaching 100,
//      files merged into the SPT root, live counters, exact failure messages.
//   D. Byte-accurate extraction progress (spec path): ZipFile.OpenRead →
//      Σ entry.Length → per-entry ExtractToFile(overwrite) → exact % via
//      IProgress<double>; monotonic 0→100 on a real archive.
// =============================================================================

using System.Net;
using System.Net.Sockets;
using System.Text;
using Blacksite.Models;
using Blacksite.Services;

int pass = 0, fail = 0;
void Check(bool ok, string label, string? detail = null)
{
    Console.WriteLine((ok ? "  [PASS] " : "  [FAIL] ") + label + (detail is null ? "" : $"  [{detail}]"));
    if (ok) pass++; else fail++;
}

string settingsRoot = Path.Combine("/home/user/.cache", "bs-queue-smoke-" + Guid.NewGuid().ToString("N")[..8]);
Directory.CreateDirectory(settingsRoot);
Environment.SetEnvironmentVariable("XDG_CONFIG_HOME", settingsRoot);

Console.WriteLine("=== Blacksite Installation Queue smoke test ===");

using (var api = new SpModApiClient())
{
    var settings = new SettingsService();
    var installer = new InstallService(api, settings);

    // -------------------------------------------------------------------------
    Console.WriteLine();
    Console.WriteLine("--- A. THE REPORTED BUG (live): More Energy Drinks v1.3.0, metadata 9 bytes over reality ---");

    string rootA = Path.Combine(settingsRoot, "a-spt");
    Directory.CreateDirectory(Path.Combine(rootA, "user", "mods"));
    Directory.CreateDirectory(Path.Combine(rootA, "BepInEx", "plugins"));

    var progressSink = new CollectingProgress();
    Mod med = await api.GetModAsync(1688, CancellationToken.None);

    // Confirm the live drift is still exactly what the user hit (metadata vs real host bytes).
    long? metadataSize = (await api.GetVersionsAsync(1688, CancellationToken.None))
        .First(v => v.Version == "1.3.0").ContentLength;
    Check(metadataSize == 117_232_656, "API metadata still says 117,232,656 bytes for v1.3.0", $"metadata = {metadataSize:N0}");

    InstallResult result = await installer.InstallAsync(
        med, rootA, "4.1.5", progressSink, _ => Task.FromResult(DependencyPromptResult.InstallWithDeps), CancellationToken.None);

    Check(result.Success, "More Energy Drinks installs successfully (the reported error is fixed)", result.Message);
    Check(result.InstalledVersion == "1.3.0", "resolved the 4.1.x release (v1.3.0, the mismatched one)", $"v{result.InstalledVersion}");
    Check(progressSink.ExtractPercents.Count > 0 && progressSink.ExtractPercents[^1] >= 99.9,
        "extraction reported byte-accurate progress up to 100%",
        $"{progressSink.ExtractPercents.Count} reports, last = {progressSink.ExtractPercents.LastOrDefault():F1}%");
    Check(progressSink.ExtractPercents.SequenceEqual(progressSink.ExtractPercents.OrderBy(p => p)),
        "extraction percentages are monotonic");
    bool medOnDisk = Directory.EnumerateFileSystemEntries(Path.Combine(rootA, "user", "mods"), "*", SearchOption.AllDirectories).Any()
                  || Directory.EnumerateFileSystemEntries(Path.Combine(rootA, "BepInEx", "plugins"), "*", SearchOption.AllDirectories).Any();
    Check(medOnDisk, "installed files are on disk in the SPT root");

    // -------------------------------------------------------------------------
    Console.WriteLine();
    Console.WriteLine("--- B. Metadata-mismatch arbitration (local fixture, real archive bytes) ---");

    // Re-fetch a small real archive to serve from the fixture.
    string medattZip = Path.Combine(settingsRoot, "medatt.zip");
    List<ModVersion> medattVersions = await api.GetVersionsAsync(147, CancellationToken.None);
    string medattLink = medattVersions.OrderByDescending(v => v.Version, StringComparer.OrdinalIgnoreCase).First().Link!;
    using (var http = new HttpClient())
    using (var resp = await http.GetAsync(medattLink))
        await File.WriteAllBytesAsync(medattZip, await resp.Content.ReadAsByteArrayAsync());
    byte[] medattBytes = File.ReadAllBytes(medattZip);
    Check(ArchiveExtractor.IsStructurallyIntactArchive(medattZip), "fixture archive is structurally intact");

    // Truncated variant: cut the tail (End-of-Central-Directory + central directory gone).
    string truncatedZip = Path.Combine(settingsRoot, "medatt-truncated.zip");
    await File.WriteAllBytesAsync(truncatedZip, medattBytes[..(medattBytes.Length - 600)]);
    Check(!ArchiveExtractor.IsStructurallyIntactArchive(truncatedZip),
        "archive truncated by 600 bytes fails structural validation (zip EOCD/central directory destroyed)");

    var installedSvc = new InstalledModsService(api, settings);

    // B1: stale metadata (+9 bytes) + intact archive → update succeeds.
    using (var server = new StaticFileServer(medattBytes))
    {
        var target = MakeTarget(rootA2(server));
        var updateResult = await installedSvc.UpdateAsync(
            target, server.Url, expectedSize: medattBytes.Length + 9, rootA2(server), new NullProgress(),
            CancellationToken.None, "4.1.3");
        Check(updateResult.Success,
            "stale metadata (+9 bytes) + INTACT archive → install proceeds", updateResult.Message);
    }

    // B2: stale metadata + truncated archive → hard failure with both numbers.
    string rootB2 = Path.Combine(settingsRoot, "b2-spt");
    Directory.CreateDirectory(Path.Combine(rootB2, "user", "mods"));
    using (var server = new StaticFileServer(File.ReadAllBytes(truncatedZip)))
    {
        var target = MakeTarget(rootB2);
        var updateResult = await installedSvc.UpdateAsync(
            target, server.Url, expectedSize: File.ReadAllBytes(truncatedZip).Length + 609, rootB2, new NullProgress(),
            CancellationToken.None, "4.1.3");
        Check(!updateResult.Success && updateResult.Message.Contains("Incomplete download"),
            "stale metadata + TRUNCATED archive → hard failure", updateResult.Message);
        Check(File.Exists(Path.Combine(rootB2, "user", "mods", "MedicalAttention", "package.json")),
            "existing install untouched after the failed update");
    }

    string rootA2(StaticFileServer _) => Path.Combine(settingsRoot, "b1-spt");
    InstalledModInfo MakeTarget(string root)
    {
        string modDir = Path.Combine(root, "user", "mods", "MedicalAttention");
        Directory.CreateDirectory(modDir);
        File.WriteAllText(Path.Combine(modDir, "package.json"), """{"name":"MedicalAttention","version":"4.0.0","author":"Shrak"}""");
        return new InstalledModInfo
        {
            Kind = InstalledModKind.Server,
            InstallPath = modDir,
            IsDirectory = true,
            ParentDirectory = Path.Combine(root, "user", "mods"),
            DisplayName = "MedicalAttention",
            PackageId = "MedicalAttention",
            Version = "4.0.0",
            IsDisabled = false,
            InfoSource = "test"
        };
    }
    // Note: rootA2/MakeTarget declared after use in local functions is fine (hoisted local funcs).

    // -------------------------------------------------------------------------
    Console.WriteLine();
    Console.WriteLine("--- C. InstallQueueEngine: 3 real installs + 1 dead link, sequentially ---");

    string rootC = Path.Combine(settingsRoot, "c-spt");
    Directory.CreateDirectory(Path.Combine(rootC, "user", "mods"));
    Directory.CreateDirectory(Path.Combine(rootC, "BepInEx", "plugins"));

    var engine = new InstallQueueEngine(installer);

    var stateLog = new System.Collections.Concurrent.ConcurrentQueue<(int ModId, InstallTaskState State)>();
    var percentLog = new System.Collections.Concurrent.ConcurrentQueue<(int ModId, double Percent, InstallTaskState State)>();
    engine.ItemUpdated += item =>
    {
        stateLog.Enqueue((item.ModId, item.State));
        if (item.State is InstallTaskState.Extracting or InstallTaskState.Downloading)
            percentLog.Enqueue((item.ModId, item.Percent, item.State));
    };

    var finished = new System.Collections.Concurrent.ConcurrentQueue<(InstallQueueItem Item, InstallResult Result)>();
    var finishedSignal = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
    int finishedCount = 0;
    engine.TaskFinished += (item, result) =>
    {
        finished.Enqueue((item, result));
        if (Interlocked.Increment(ref finishedCount) == 4)
            finishedSignal.TrySetResult(4);
    };

    Mod scavcat = await api.GetModAsync(31, CancellationToken.None);
    Mod medattMod = await api.GetModAsync(147, CancellationToken.None);
    Mod freecam = await api.GetModAsync(164, CancellationToken.None);
    Mod deadLink = await api.GetModAsync(97, CancellationToken.None);

    InstallQueueItem i1 = engine.Enqueue(scavcat, rootC, "4.1.5", _ => Task.FromResult(DependencyPromptResult.InstallWithDeps));
    InstallQueueItem i2 = engine.Enqueue(medattMod, rootC, "4.1.5", _ => Task.FromResult(DependencyPromptResult.InstallWithDeps));
    InstallQueueItem i3 = engine.Enqueue(freecam, rootC, "4.1.5", _ => Task.FromResult(DependencyPromptResult.InstallWithDeps));
    InstallQueueItem i4 = engine.Enqueue(deadLink, rootC, "4.1.5", _ => Task.FromResult(DependencyPromptResult.InstallWithDeps));

    Check(i1.State == InstallTaskState.Queued && i2.State == InstallTaskState.Queued
       && i3.State == InstallTaskState.Queued && i4.State == InstallTaskState.Queued,
        "clicking Install back-to-back queues every task with status Queued");

    (int current, int queued, int completed) = engine.Counters;
    Check(queued == 4 && current == 0, "counters right after enqueue", $"Current: {current} | Queue: {queued} | Completed: {completed}");

    await finishedSignal.Task.WaitAsync(TimeSpan.FromMinutes(6));

    // Sequential processing: task 2 must not start downloading before task 1 finishes.
    var order = new List<int>();
    foreach (var (item, _) in finished) order.Add(item.ModId);
    Check(order.SequenceEqual(new[] { 31, 147, 164, 97 }),
        "tasks completed strictly in queue order (sequential consumer)",
        string.Join(" → ", order));

    Check(i1.State == InstallTaskState.Completed && i2.State == InstallTaskState.Completed && i3.State == InstallTaskState.Completed,
        "the three real installs reached Completed (green check + timestamp)",
        $"{i1.CompletedAt:HH:mm:ss}, {i2.CompletedAt:HH:mm:ss}, {i3.CompletedAt:HH:mm:ss}");
    Check(i1.State == InstallTaskState.Completed && i1.Percent >= 99.9, "task 1 extraction progress ended at 100%", $"{i1.Percent:F1}%");

    foreach (InstallQueueItem item in new[] { i1, i2, i3 })
    {
        var percents = percentLog.Where(p => p.ModId == item.ModId && p.State == InstallTaskState.Extracting).Select(p => p.Percent).ToList();
        Check(percents.Count > 0 && percents[^1] >= 99.9 && percents.SequenceEqual(percents.OrderBy(p => p)),
            $"{item.ModName}: extraction % monotonic to 100%", $"{percents.Count} reports, last {percents.LastOrDefault():F1}%");
        var dlStates = percentLog.Where(p => p.ModId == item.ModId && p.State == InstallTaskState.Downloading).Select(p => p.Percent).ToList();
        Check(dlStates.Count > 0 && dlStates[^1] >= 99.0, $"{item.ModName}: download % tracked live", $"last {dlStates.LastOrDefault():F1}%");
    }

    Check(i4.State == InstallTaskState.Failed && !string.IsNullOrWhiteSpace(i4.Error)
        && i4.Error!.Contains("web page or error payload", StringComparison.Ordinal),
        "dead-link task reached Failed with the exact exception message", i4.Error);

    (current, queued, completed) = engine.Counters;
    Check(current == 0 && queued == 0 && completed == 4,
        "final counters", $"Current: {current} | Queue: {queued} | Completed: {completed}");

    Check(Directory.Exists(Path.Combine(rootC, "user", "mods", "ScavCat")), "ScavCat merged into user/mods");
    Check(File.Exists(Path.Combine(rootC, "user", "mods", "MedicalAttention", "MedicalAttention-Server.dll")),
        "Medical Attention merged into user/mods (wrapper stripped)");
    Check(Directory.GetFiles(Path.Combine(rootC, "BepInEx", "plugins"), "*", SearchOption.AllDirectories).Length > 0,
        "Freecam 7z merged into BepInEx/plugins");

    // Clear Completed drops the finished items from bookkeeping/counters.
    engine.RemoveFinished(engine.FinishedItems);
    (current, queued, completed) = engine.Counters;
    Check(completed == 0, "Clear Completed resets the Completed counter", $"Completed: {completed}");

    // Temp cleanup: every downloaded temp archive must be gone from Path.GetTempPath() after extraction.
    string[] expectedTempFiles = { "31.zip", "147.zip", "164.zip", "97.zip", "1688.zip" };
    var leftovers = expectedTempFiles.Where(f => File.Exists(Path.Combine(Path.GetTempPath(), f))).ToList();
    Check(leftovers.Count == 0, "temp .zip archives deleted from Path.GetTempPath() after extraction",
        leftovers.Count == 0 ? string.Join(", ", expectedTempFiles) : "leftover: " + string.Join(", ", leftovers));

    // -------------------------------------------------------------------------
    Console.WriteLine();
    Console.WriteLine("--- D. Byte-accurate extraction progress (ZipFile.OpenRead spec path) ---");
    {
        string dest = Path.Combine(settingsRoot, "d-extract");
        var percents = new List<double>();
        await ArchiveExtractor.ExtractArchiveWithProgressAsync(medattZip, dest, new SyncCollector(percents.Add));
        var list = percents.ToList();
        Check(list.Count >= 2 && Math.Abs(list[0]) < 0.01, "first report is 0% (150 ms byte-gated dispatch)", $"{list.Count} reports");
        Check(list[^1] >= 99.99, "final report is exactly 100%", $"{list[^1]:F2}%");
        Check(list.SequenceEqual(list.OrderBy(p => p)), "percent sequence is monotonic");
        Check(File.Exists(Path.Combine(dest, "BepInEx", "plugins", "MedicalAttention-Client.dll")),
            "real files extracted by the progress path");

        // And the smart-layout path reports progress too.
        string dest2 = Path.Combine(settingsRoot, "d-extract-smart");
        var percents2 = new List<double>();
        await ArchiveExtractor.ExtractSmartAsync(medattZip, ArchiveKind.Zip, dest2, progress: new SyncCollector(percents2.Add));
        var list2 = percents2.ToList();
        Check(list2.Count >= 2 && list2[^1] >= 99.99, "ExtractSmart reports byte-accurate progress too",
            $"{list2.Count} reports, last {list2[^1]:F1}%");
        Check(File.Exists(Path.Combine(dest2, "user", "mods", "MedicalAttention", "MedicalAttention-Server.dll")),
            "ExtractSmart placed the server part correctly");
    }

// -------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("--- E. Local archive installs (.zip / .rar / .7z loaded from disk) ---");
{
    string rootE = Path.Combine(settingsRoot, "e-spt");
    Directory.CreateDirectory(Path.Combine(rootE, "user", "mods"));
    Directory.CreateDirectory(Path.Combine(rootE, "BepInEx", "plugins"));

    string localZip = Path.Combine(settingsRoot, "local-medatt.zip");
    File.Copy("/tmp/medatt.zip", localZip, overwrite: true);

    // E1: local .zip
    var progZip = new CollectingProgress();
    InstallResult rZip = await installer.InstallLocalArchiveAsync(localZip, rootE, progZip, CancellationToken.None);
    Check(rZip.Success, "local .zip installs (no download, direct read)", rZip.Message);
    Check(progZip.ExtractPercents.Count > 0 && progZip.ExtractPercents[^1] >= 99.9 && progZip.ExtractPercents.SequenceEqual(progZip.ExtractPercents.OrderBy(p => p)),
        "local .zip: byte-accurate extraction % monotonic to 100%", $"{progZip.ExtractPercents.Count} reports, last {progZip.ExtractPercents.LastOrDefault():F1}%");
    Check(File.Exists(Path.Combine(rootE, "user", "mods", "MedicalAttention", "MedicalAttention-Server.dll")),
        "local .zip: server part placed in user/mods");

    // E2: local .rar (RAR5 via SharpCompress)
    var rRar = await installer.InstallLocalArchiveAsync("/tmp/voicepatcher.rar", rootE, new NullProgress(), CancellationToken.None);
    Check(rRar.Success, "local .rar (RAR5) installs", rRar.Message);
    Check(File.Exists(Path.Combine(rootE, "BepInEx", "plugins", "WTT-VoicePatcher.dll")),
        "local .rar: wrapper routed to BepInEx/plugins");

    // E3: local .7z
    string local7z = Path.Combine(settingsRoot, "local-freecam.7z");
    File.Copy("/tmp/freecam.zip", local7z, overwrite: true);
    var r7z = await installer.InstallLocalArchiveAsync(local7z, rootE, new NullProgress(), CancellationToken.None);
    Check(r7z.Success, "local .7z installs", r7z.Message);
    Check(Directory.GetFiles(Path.Combine(rootE, "BepInEx", "plugins"), "*", SearchOption.AllDirectories).Length > 0,
        "local .7z: plugins extracted");

    // E4: overwrite — reinstalling the same archive must succeed and leave intact files
    var rZip2 = await installer.InstallLocalArchiveAsync(localZip, rootE, new NullProgress(), CancellationToken.None);
    Check(rZip2.Success, "re-install overwrites existing files without error", rZip2.Message);
    Check(File.Exists(Path.Combine(rootE, "user", "mods", "MedicalAttention", "MedicalAttention-Server.dll")),
        "overwritten install still has its files");

    // E5: SFX-style archive — 4 KB of junk before the zip signature defeats magic-byte
    //     detection; the .zip extension fallback must route it through the zip reader.
    string sfxZip = Path.Combine(settingsRoot, "sfx-prefixed.zip");
    await using (var sfxOut = new FileStream(sfxZip, FileMode.Create))
    {
        await sfxOut.WriteAsync(new byte[4096]);
        await sfxOut.WriteAsync(await File.ReadAllBytesAsync(localZip));
    }
    Check(ArchiveExtractor.Detect(sfxZip) == ArchiveKind.Unknown, "SFX-prefixed zip is not magic-detectable (as designed)");
    Check(ArchiveExtractor.DetectWithExtensionFallback(sfxZip) == ArchiveKind.Zip, "extension fallback routes it to the zip reader");
    string rootE5 = Path.Combine(settingsRoot, "e5-sfx-spt");
    Directory.CreateDirectory(rootE5);
    var rSfx = await installer.InstallLocalArchiveAsync(sfxZip, rootE5, new NullProgress(), CancellationToken.None);
    Check(rSfx.Success, "SFX-prefixed .zip installs via extension fallback", rSfx.Message);

    // E6: a non-archive file named .zip fails cleanly (no crash)
    string fakeZip = Path.Combine(settingsRoot, "definitely-not-an-archive.zip");
    await File.WriteAllTextAsync(fakeZip, "this is just text, not an archive at all");
    var rFake = await installer.InstallLocalArchiveAsync(fakeZip, rootE, new NullProgress(), CancellationToken.None);
    Check(!rFake.Success, "fake .zip (plain text) fails cleanly", rFake.Message);

    // E7: local archives flow through the QUEUE engine as live task cards
    string rootE7 = Path.Combine(settingsRoot, "e7-spt");
    Directory.CreateDirectory(Path.Combine(rootE7, "user", "mods"));
    var localDone = new TaskCompletionSource<InstallResult>(TaskCreationOptions.RunContinuationsAsynchronously);
    InstallQueueItem? localCard = null;
    engine.TaskFinished += OnLocalFinished;
    void OnLocalFinished(InstallQueueItem item, InstallResult result)
    {
        if (item.PackageId == localZip) localDone.TrySetResult(result);
    }
    localCard = engine.EnqueueLocal(localZip, rootE7);
    Check(localCard.State == InstallTaskState.Queued, "local archive enqueued as a live card (Pending…)");

    InstallResult localResult = await localDone.Task.WaitAsync(TimeSpan.FromMinutes(2));
    engine.TaskFinished -= OnLocalFinished;
    Check(localCard.State == InstallTaskState.Completed, "local archive card reached Completed",
        $"{localCard.StatusText}");
    Check(localResult.Success && Directory.Exists(Path.Combine(rootE7, "user", "mods", "MedicalAttention")),
        "local archive extracted into the SPT root via the queue");

    // E8: startup temp sweep removes crashed-run artifacts (staging dirs, .part files, orphaned pkgs)
    string staging = Path.Combine(Path.GetTempPath(), "bs-staging-smoketest");
    Directory.CreateDirectory(staging);
    await File.WriteAllTextAsync(Path.Combine(staging, "leftover.json"), "{}");
    string pkgLeftover = Path.Combine(Path.GetTempPath(), "smoke-sweep.update.pkg");
    string partLeftover = Path.Combine(Path.GetTempPath(), "smoke-sweep.zip.part");
    await File.WriteAllTextAsync(pkgLeftover, "x");
    await File.WriteAllTextAsync(partLeftover, "x");
    InstallService.SweepStaleTempFiles();
    Check(!Directory.Exists(staging), "startup sweep removes leftover bs-staging-* directories");
    Check(!File.Exists(pkgLeftover) && !File.Exists(partLeftover), "startup sweep removes orphaned .pkg/.part temp files");
}


// -------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("--- F. Version selection, changelogs & dependency resolution (live) ---");
{
    // F1: the real version list for Scav Cat — changelogs, downloads, dates, fika.
    List<ModVersion> scavVersions = await api.GetVersionsAsync(31, CancellationToken.None);
    Check(scavVersions.Count > 0, "GET /mod/31/versions returns releases", $"{scavVersions.Count} versions");
    ModVersion newest = scavVersions
        .OrderByDescending(v => SemVersion.TryParse(v.Version) ?? SemVersion.Zero)
        .ThenByDescending(v => v.PublishedAt ?? DateTimeOffset.MinValue)
        .First();
    Check(newest.Version == "1.0.8", "newest release resolved by semver", newest.Version);
    Check(scavVersions.Any(v => !string.IsNullOrWhiteSpace(v.Description)),
        "releases carry real changelog text (description field)");
    string changelog = HtmlText.ToPlainText(newest.Description);
    Check(changelog.Length > 0 && !changelog.Contains('<') && !changelog.Contains("</p>"),
        "changelog HTML converted to plain text", $"[{changelog.Length} chars] {HarnessUtil.Truncate(changelog, 80)}");
    Check(scavVersions.All(v => v.Downs() >= 0) && scavVersions.Sum(v => v.Downs()) > 0,
        "per-version download counts are real numbers", $"Σ={scavVersions.Sum(v => v.Downs())}");
    Check(scavVersions.Count(v => v.PublishedAt is not null) == scavVersions.Count,
        "publication dates present on every release");
    Check(scavVersions.All(v => v.FikaCompatibility is "compatible" or "unknown" or null or "incompatible"),
        "fika compatibility field parses to badge values", string.Join(", ", scavVersions.Select(v => v.FikaCompatibility ?? "null").Distinct()));

    // F2: pinned-version install — enqueue an OLDER, user-picked release and get exactly it.
    string rootF2 = Path.Combine(settingsRoot, "f2-spt");
    Directory.CreateDirectory(rootF2);
    List<ModVersion> pickerVersions = (await api.GetVersionsAsync(147, CancellationToken.None))
        .OrderByDescending(v => SemVersion.TryParse(v.Version) ?? SemVersion.Zero)
        .ThenByDescending(v => v.PublishedAt ?? DateTimeOffset.MinValue)
        .ToList();
    Check(pickerVersions.Count >= 2, "mod 147 has multiple releases to choose from", $"{pickerVersions.Count} versions");
    ModVersion pinned = pickerVersions[1]; // the second-newest — what a user picked in the modal
    var pinDone = new TaskCompletionSource<InstallResult>(TaskCreationOptions.RunContinuationsAsynchronously);
    InstallQueueItem? pinCard = null;
    void OnPinFinished(InstallQueueItem item, InstallResult result)
    {
        if (item.ModId == 147) pinDone.TrySetResult(result);
    }
    engine.TaskFinished += OnPinFinished;
    pinCard = engine.EnqueueVersion(medattMod, pinned, rootF2, null);
    Check(pinCard.State == InstallTaskState.Queued && pinCard.Teaser == $"Version {pinned.Version}",
        "pinned version enqueued as a live card", pinCard.Teaser);
    InstallResult pinResult = await pinDone.Task.WaitAsync(TimeSpan.FromMinutes(3));
    engine.TaskFinished -= OnPinFinished;
    Check(pinResult.Success && pinResult.InstalledVersion == pinned.Version,
        "pinned (non-latest) release installs and reports exactly the chosen version",
        $"installed={pinResult.InstalledVersion}, pinned={pinned.Version}, latest={pickerVersions[0].Version}");
    Check(pinResult.InstalledVersion != pickerVersions[0].Version, "the pinned release is NOT the latest");
    Check(Directory.GetFiles(rootF2, "*", SearchOption.AllDirectories).Length > 0, "pinned install extracted files");

    // F3: dependency resolution — Komrade Kid v2.0.0 needs WTT-CommonLib for SPT 4.1.5.
    Mod komrade = await api.GetModAsync(1776, CancellationToken.None);
    List<ModVersion> komradeVersions = await api.GetVersionsAsync(1776, CancellationToken.None);
    ModVersion komradeTarget = komradeVersions.First(v => v.Version == "2.0.0");
    string rootF3 = Path.Combine(settingsRoot, "f3-spt");
    Directory.CreateDirectory(rootF3);
    DependencyResolution resolution = await installer.ResolveDependenciesAsync(komrade, komradeTarget, rootF3, "4.1.5", CancellationToken.None);
    Check(resolution.NeedsPrompt, "resolver fires: real missing dependencies detected");
    Check(resolution.Prompt.Missing.Any(d => d.Name.Contains("CommonLib", StringComparison.OrdinalIgnoreCase)),
        "missing list names WTT - CommonLib", string.Join(", ", resolution.Prompt.Missing.Select(d => d.Name)));
    Check(resolution.Prompt.MissingCount == resolution.Prompt.Missing.Count,
        "prompt reports the dependency count for the dialog header", $"{resolution.Prompt.MissingCount}");
    InstallService.ResolvedDependency? commonLibDep = resolution.InstallQueue
        .FirstOrDefault(d => d.Name.Contains("CommonLib", StringComparison.OrdinalIgnoreCase));
    Check(commonLibDep is not null && commonLibDep.Id == 2310 && !string.IsNullOrWhiteSpace(commonLibDep.Url),
        "dependency resolved to a real downloadable release (mod 2310)",
        commonLibDep is null ? "not found" : $"v{commonLibDep.Version} from {HarnessUtil.Truncate(commonLibDep.Url, 60)}");

    // F4: "Install mod + dependencies" — deps queued FIRST, target after; strict finish order.
    if (commonLibDep is not null)
    {
        string rootF4 = Path.Combine(settingsRoot, "f4-spt");
        Directory.CreateDirectory(rootF4);
        var finishes = new List<(int Id, InstallTaskState State)>();
        void OnF4Finished(InstallQueueItem item, InstallResult result)
        {
            lock (finishes) finishes.Add((item.ModId, item.State));
        }
        engine.TaskFinished += OnF4Finished;
        InstallQueueItem depCard = engine.EnqueueResolved(commonLibDep, rootF4);
        InstallQueueItem modCard = engine.EnqueueVersion(komrade, komradeTarget, rootF4, "4.1.5");
        Check(depCard.Teaser.StartsWith("Dependency") && modCard.Teaser == "Version 2.0.0",
            "queue cards distinguish dependencies from the requested mod", $"{depCard.Teaser} | {modCard.Teaser}");
        await Task.Delay(1500); // let the consumer start; both tasks are queued behind any earlier work
        var deadline = DateTime.UtcNow + TimeSpan.FromMinutes(4);
        while (DateTime.UtcNow < deadline)
        {
            lock (finishes)
                if (finishes.Count >= 2) break;
            await Task.Delay(200);
        }
        engine.TaskFinished -= OnF4Finished;
        lock (finishes)
        {
            Check(finishes.Count == 2 && finishes[0].Id == 2310 && finishes[1].Id == 1776,
                "dependency finished BEFORE the mod that needs it", string.Join(" → ", finishes.Select(f => f.Id)));
            Check(finishes.All(f => f.State == InstallTaskState.Completed), "both dependency and mod completed");
        }
        Check(Directory.GetFiles(rootF4, "*", SearchOption.AllDirectories)
                .Any(p => p.Contains("CommonLib", StringComparison.OrdinalIgnoreCase)),
            "dependency files on disk (WTT-CommonLib)");
        Check(Directory.GetFiles(rootF4, "*", SearchOption.AllDirectories).Length > 3,
            "Komrade Kid (26 MB) extracted into the SPT root",
            $"{Directory.GetFiles(rootF4, "*", SearchOption.AllDirectories).Length} files");
    }

    // F5: HtmlText handles the real API's HTML shapes.
    Check(HtmlText.ToPlainText(null) == string.Empty, "null changelog → empty text");
    Check(HtmlText.ToPlainText("<p>Hello <strong>world</strong></p><p>line 2</p>") == "Hello world\n\nline 2",
        "block tags become paragraph breaks (one blank line)", HtmlText.ToPlainText("<p>Hello <strong>world</strong></p><p>line 2</p>").Replace("\n", " | "));
    Check(HtmlText.ToPlainText("a &amp; b &lt;c&gt; &nbsp; d") == "a & b <c>   d", "entities decoded");
}


// -------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("--- G. High-speed engine: throttled progress, custom paths, settings, temp/log cleanup ---");
{
    // G1: progress throttling on a real 400-file archive (one report per file would be 402 dispatches).
    string g1src = Path.Combine(settingsRoot, "g1-src");
    Directory.CreateDirectory(g1src);
    var rng = new Random(20260915);
    for (int i = 0; i < 400; i++)
    {
        var bytes = new byte[2048];
        rng.NextBytes(bytes);
        await File.WriteAllBytesAsync(Path.Combine(g1src, $"file{i:D3}.bin"), bytes);
    }
    string g1zip = Path.Combine(settingsRoot, "g1-400files.zip");
    System.IO.Compression.ZipFile.CreateFromDirectory(g1src, g1zip);
    string g1dest = Path.Combine(settingsRoot, "g1-out");
    var g1reports = new List<double>();
    await ArchiveExtractor.ExtractArchiveWithProgressAsync(g1zip, g1dest, new SyncCollector(g1reports.Add));
    Check(g1reports.Count >= 2 && g1reports.Count <= 103,
        "progress reports are THROTTLED by the 150 ms byte gate (400 files → a handful of dispatches, not 402)",
        $"{g1reports.Count} reports for 400 files");
    Check(g1reports[0] == 0.0, "throttled path still reports 0% first");
    Check(Math.Abs(g1reports[^1] - 100.0) < 0.001, "throttled path still ends at exactly 100%");
    Check(g1reports.SequenceEqual(g1reports.OrderBy(p => p)), "throttled percentages remain monotonic");
    Check(Directory.GetFiles(g1dest).Length == 400, "all 400 real files extracted by the async 1 MB-buffer path");
    byte[] expect3 = await File.ReadAllBytesAsync(Path.Combine(g1src, "file003.bin"));
    byte[] got3 = await File.ReadAllBytesAsync(Path.Combine(g1dest, "file003.bin"));
    Check(expect3.SequenceEqual(got3), "extracted bytes are identical to the source (copy integrity)");
    long extractedTotal = Directory.GetFiles(g1dest).Sum(f => new FileInfo(f).Length);
    Check(extractedTotal == 400 * 2048, "extracted total size matches source exactly", $"{extractedTotal:N0} bytes");

    // G2: custom mod paths — settings.json round-trip + real extraction into the configured folders.
    settings.Settings.ClientModPath = "BepInEx/customPlugins";
    settings.Settings.ServerModPath = "user/customMods";
    settings.Save();
    Check(File.Exists(Path.Combine(settings.AppDataDir, "settings.json")), "settings.json persisted to %AppData%");
    var reloaded = new SettingsService();
    Check(reloaded.ClientModPathEffective == "BepInEx/customPlugins" && reloaded.ServerModPathEffective == "user/customMods",
        "settings round-trip: reloaded service returns the configured paths",
        $"{reloaded.ClientModPathEffective} | {reloaded.ServerModPathEffective}");

    string rootG2 = Path.Combine(settingsRoot, "g2-spt");
    Directory.CreateDirectory(rootG2);
    string localZipG2 = Path.Combine(settingsRoot, "g2-medatt.zip");
    File.Copy("/tmp/medatt.zip", localZipG2, overwrite: true);
    var rG2 = await installer.InstallLocalArchiveAsync(localZipG2, rootG2, new NullProgress(), CancellationToken.None);
    Check(rG2.Success, "install succeeds with custom mod paths", rG2.Message);
    Check(File.Exists(Path.Combine(rootG2, "user", "customMods", "MedicalAttention", "MedicalAttention-Server.dll")),
        "server part routed to the CONFIGURED server path (user/customMods)");
    Check(!File.Exists(Path.Combine(rootG2, "user", "mods", "MedicalAttention", "MedicalAttention-Server.dll")),
        "canonical user/mods was NOT used while customized");
    string clientDllG2 = Path.Combine(rootG2, "BepInEx", "customPlugins", "MedicalAttention-Client.dll");
    Check(File.Exists(clientDllG2) || Directory.GetFiles(Path.Combine(rootG2, "BepInEx", "customPlugins"), "*", SearchOption.AllDirectories).Length > 0,
        "client part routed to the CONFIGURED client path (BepInEx/customPlugins)");

    var scanner = new Blacksite.Services.LocalModScanner();
    var scanned = scanner.Scan(rootG2);
    Check(scanned.Any(m => m.InstallPath.Contains("customMods", StringComparison.OrdinalIgnoreCase)),
        "installed-mods scanner sees mods in the configured path",
        string.Join(", ", scanned.Select(m => m.DisplayName).Take(4)));

    // restore defaults and prove canonical routing returns (via the ambient instance —
    // the static extraction layer reads SettingsService.Instance, which the reload above replaced)
    var ambient = SettingsService.Instance!;
    ambient.Settings.ClientModPath = null;
    ambient.Settings.ServerModPath = null;
    ambient.Save();
    string rootG2b = Path.Combine(settingsRoot, "g2b-spt");
    Directory.CreateDirectory(rootG2b);
    var rG2b = await installer.InstallLocalArchiveAsync(localZipG2, rootG2b, new NullProgress(), CancellationToken.None);
    Check(rG2b.Success && File.Exists(Path.Combine(rootG2b, "user", "mods", "MedicalAttention", "MedicalAttention-Server.dll")),
        "after resetting to defaults, installs return to user/mods", rG2b.Message);

    // G3: SPT version auto-detection from package.json / server executables.
    string rootG3 = Path.Combine(settingsRoot, "g3-spt");
    Directory.CreateDirectory(rootG3);
    await File.WriteAllTextAsync(Path.Combine(rootG3, "package.json"), @"{ ""name"": ""spt-server"", ""version"": ""4.1.5"", ""description"": ""fixture"" }");
    Check(InstallService.TryDetectSptVersion(rootG3) == "4.1.5",
        "package.json version is detected", InstallService.TryDetectSptVersion(rootG3) ?? "null");
    string rootG3b = Path.Combine(settingsRoot, "g3b-spt");
    Directory.CreateDirectory(rootG3b);
    Check(InstallService.TryDetectSptVersion(rootG3b) is null, "empty folder → no version detected");

    // G4: Clear Temp Files — leftover archives/artifacts in Path.GetTempPath() are purged.
    // (The full purge also removes the harness's own /tmp sample archives — preserve them first
    // and restore afterwards so the suite stays re-runnable.)
    string[] sampleArchives = { "31.zip", "biggerstash.zip", "freecam.zip", "medatt.zip", "svm.zip",
        "commonlib.zip", "qe.zip", "voicepatcher.rar", "realism.zip" };
    var preserved = new Dictionary<string, byte[]>();
    foreach (string s in sampleArchives)
    {
        string p = Path.Combine(Path.GetTempPath(), s);
        if (File.Exists(p)) preserved[s] = await File.ReadAllBytesAsync(p);
    }

    string t1 = Path.Combine(Path.GetTempPath(), "g4leftover.zip");
    string t2 = Path.Combine(Path.GetTempPath(), "g4leftover.7z");
    string t3 = Path.Combine(Path.GetTempPath(), "g4leftover.rar");
    string t4 = Path.Combine(Path.GetTempPath(), "g4leftover.zip.part");
    await File.WriteAllTextAsync(t1, new string('z', 1000));
    await File.WriteAllTextAsync(t2, new string('z', 1000));
    await File.WriteAllTextAsync(t3, new string('z', 1000));
    await File.WriteAllTextAsync(t4, "partial");
    string stagingG4 = Path.Combine(Path.GetTempPath(), "bs-staging-g4");
    Directory.CreateDirectory(stagingG4);
    await File.WriteAllTextAsync(Path.Combine(stagingG4, "leftover.dll"), "x");
    (int clearedFiles, long clearedBytes) = InstallService.ClearLeftoverTempArchives();
    Check(!File.Exists(t1) && !File.Exists(t2) && !File.Exists(t3) && !File.Exists(t4) && !Directory.Exists(stagingG4),
        "Clear Temp Files removes leftover .zip/.7z/.rar, .part and bs-staging-* artifacts");
    Check(clearedFiles >= 5 && clearedBytes > 0, "cleanup reports real counts and bytes", $"{clearedFiles} items, {clearedBytes:N0} bytes");

    foreach (var (name, bytes) in preserved)
        await File.WriteAllBytesAsync(Path.Combine(Path.GetTempPath(), name), bytes);

    // G5: Clear Log Files — app log files are erased from the app-data dir.
    string fakeLog = Path.Combine(settings.AppDataDir, "crash.log");
    await File.WriteAllTextAsync(fakeLog, new string('l', 5000));
    (int logFiles, long logBytes) = settings.ClearLogFiles();
    Check(!File.Exists(fakeLog) && logFiles >= 1 && logBytes >= 5000,
        "Clear Log Files erases local log files", $"{logFiles} files, {logBytes:N0} bytes");
}


// -------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("--- H. Config editor, conflict detector & integrated SPT launcher ---");
{
    // H1: real config discovery on a real extracted mod (Medical Attention ships config.jsonc).
    string rootH1 = Path.Combine(settingsRoot, "h1-spt");
    Directory.CreateDirectory(rootH1);
    string h1zip = Path.Combine(settingsRoot, "h1-medatt.zip");
    File.Copy("/tmp/medatt.zip", h1zip, overwrite: true);
    var rH1 = await installer.InstallLocalArchiveAsync(h1zip, rootH1, new NullProgress(), CancellationToken.None);
    Check(rH1.Success, "fixture mod installed for config discovery", rH1.Message);
    List<ModConfigFile> configs = ModConfigService.FindConfigFiles(Path.Combine(rootH1, "user", "mods", "MedicalAttention"));
    Check(configs.Any(c => c.RelativePath == "config.jsonc"), "recursive scan finds the real config.jsonc",
        string.Join(", ", configs.Select(c => c.RelativePath)));
    Check(configs.All(c => c.SizeBytes > 0), "config files report real on-disk sizes");
    Check(ModConfigService.FindConfigFiles(Path.Combine(settingsRoot, "h1-no-such-dir")).Count == 0,
        "missing directory → empty discovery result");
    // nested discovery
    string nestedDir = Path.Combine(rootH1, "user", "mods", "NestedProbe", "src");
    Directory.CreateDirectory(nestedDir);
    await File.WriteAllTextAsync(Path.Combine(nestedDir, "config.yaml"), "key: value\n");
    await File.WriteAllTextAsync(Path.Combine(nestedDir, "ignored.txt"), "not a config");
    List<ModConfigFile> nested = ModConfigService.FindConfigFiles(Path.Combine(rootH1, "user", "mods", "NestedProbe"));
    Check(nested.Count == 1 && nested[0].RelativePath.Replace('\\', '/') == "src/config.yaml",
        "discovery recurses subfolders and filters by extension (.json/.jsonc/.cfg/.yaml/.yml)",
        string.Join(", ", nested.Select(n => n.RelativePath)));

    // H2: edit round-trip — read, modify, write, verify persisted on disk, restore.
    ModConfigFile jsonc = configs.First(c => c.RelativePath == "config.jsonc");
    string original = ModConfigService.ReadText(jsonc.FullPath);
    string modified = original.Replace("true", "false", StringComparison.Ordinal) + "\n// blacksite smoke edit";
    ModConfigService.WriteText(jsonc.FullPath, modified);
    string reread = ModConfigService.ReadText(jsonc.FullPath);
    Check(reread == modified && reread != original, "Save Changes writes the edited text directly back to disk");
    ModConfigService.WriteText(jsonc.FullPath, original);
    Check(ModConfigService.ReadText(jsonc.FullPath) == original, "restored original content byte-for-byte");

    // H3: conflict & duplicate detection on a real directory layout.
    string rootH3 = Path.Combine(settingsRoot, "h3-spt");
    foreach (string dir in new[] { "BepInEx/plugins/Foo", "BepInEx/plugins/Bar", "BepInEx/plugins/Baz", "BepInEx/plugins/Qux/nested", "user/mods/modA", "user/mods/modB", "user/mods/modC" })
        Directory.CreateDirectory(Path.Combine(rootH3, dir));
    await File.WriteAllTextAsync(Path.Combine(rootH3, "BepInEx/plugins/Foo/Foo.dll"), "foo-dll");
    await File.WriteAllTextAsync(Path.Combine(rootH3, "BepInEx/plugins/Bar/Bar.dll"), "bar-dll");
    await File.WriteAllTextAsync(Path.Combine(rootH3, "BepInEx/plugins/Baz/dup.dll"), "dup-1");
    await File.WriteAllTextAsync(Path.Combine(rootH3, "BepInEx/plugins/Qux/nested/dup.dll"), "dup-2");
    await File.WriteAllTextAsync(Path.Combine(rootH3, "user/mods/modA/package.json"), @"{ ""name"": ""com.dupe.pkg"", ""version"": ""1.0.0"" }");
    await File.WriteAllTextAsync(Path.Combine(rootH3, "user/mods/modB/package.json"), @"{ ""name"": ""com.dupe.pkg"", ""version"": ""2.0.0"" }");
    await File.WriteAllTextAsync(Path.Combine(rootH3, "user/mods/modC/package.json"), @"{ ""name"": ""com.unique.pkg"", ""version"": ""1.0.0"" }");

    List<ModConflict> conflicts = ConflictDetector.Detect(rootH3);
    Check(conflicts.Count == 2, "exactly 2 conflicts detected (1 client dll + 1 server package)",
        string.Join(" | ", conflicts.Select(c => $"{c.KindText}:{c.Key}")));
    ModConflict? clientConflict = conflicts.FirstOrDefault(c => c.Kind == InstalledModKind.Client);
    Check(clientConflict is not null && clientConflict.Key == "dup.dll" && clientConflict.Files.Count == 2,
        "client conflict: duplicate dup.dll filename across different subfolders",
        clientConflict is null ? "none" : string.Join(", ", clientConflict.Files.Select(Path.GetFileName)));
    ModConflict? serverConflict = conflicts.FirstOrDefault(c => c.Kind == InstalledModKind.Server);
    Check(serverConflict is not null && serverConflict.Key == "com.dupe.pkg" && serverConflict.Files.Count == 2,
        "server conflict: duplicate package id across mod folders",
        serverConflict is null ? "none" : string.Join(", ", serverConflict.Files.Select(Path.GetFileName)));
    Check(conflicts.All(c => c.Summary.Length > 0), "conflicts carry human-readable summaries");

    IReadOnlyList<ModConflict> forBaz = ConflictDetector.ForPath(conflicts, Path.Combine(rootH3, "BepInEx/plugins/Baz"));
    Check(forBaz.Count == 1 && forBaz[0].Key == "dup.dll", "badge mapping: plugin folder Baz maps to the dll conflict");
    IReadOnlyList<ModConflict> forModA = ConflictDetector.ForPath(conflicts, Path.Combine(rootH3, "user/mods/modA"));
    Check(forModA.Count == 1 && forModA[0].Key == "com.dupe.pkg", "badge mapping: modA maps to the package conflict");
    IReadOnlyList<ModConflict> forFoo = ConflictDetector.ForPath(conflicts, Path.Combine(rootH3, "BepInEx/plugins/Foo"));
    Check(forFoo.Count == 0, "clean mod folder → no conflict badge");

    // custom-path conflict scanning
    var ambient = SettingsService.Instance!;
    ambient.Settings.ClientModPath = "BepInEx/customPlugins";
    ambient.Save();
    string rootH3b = Path.Combine(settingsRoot, "h3b-spt");
    foreach (string dir in new[] { "BepInEx/customPlugins/One", "BepInEx/customPlugins/Two" })
        Directory.CreateDirectory(Path.Combine(rootH3b, dir));
    await File.WriteAllTextAsync(Path.Combine(rootH3b, "BepInEx/customPlugins/One/pair.dll"), "a");
    await File.WriteAllTextAsync(Path.Combine(rootH3b, "BepInEx/customPlugins/Two/pair.dll"), "b");
    List<ModConflict> customConflicts = ConflictDetector.Detect(rootH3b);
    Check(customConflicts.Any(c => c.Kind == InstalledModKind.Client && c.Key == "pair.dll"),
        "conflict scan follows the CONFIGURED client mod path");
    ambient.Settings.ClientModPath = null;
    ambient.Save();

    // H4: integrated launcher — exe discovery, ready-marker detection, and a REAL process chain.
    string rootH4 = Path.Combine(settingsRoot, "h4-spt");
    Directory.CreateDirectory(rootH4);
    Check(SptLauncher.FindServerExe(rootH4) is null && SptLauncher.FindLauncherExe(rootH4) is null,
        "no executables found in an empty root");
    await File.WriteAllTextAsync(Path.Combine(rootH4, "SPT.Server.exe"), "MZ fake");
    await File.WriteAllTextAsync(Path.Combine(rootH4, "SPT.Launcher.exe"), "MZ fake");
    Check(SptLauncher.FindServerExe(rootH4) == Path.Combine(rootH4, "SPT.Server.exe")
       && SptLauncher.FindLauncherExe(rootH4) == Path.Combine(rootH4, "SPT.Launcher.exe"),
        "SPT.Server.exe / SPT.Launcher.exe discovered");
    string rootH4b = Path.Combine(settingsRoot, "h4b-aki");
    Directory.CreateDirectory(rootH4b);
    await File.WriteAllTextAsync(Path.Combine(rootH4b, "Aki.Server.exe"), "MZ fake");
    await File.WriteAllTextAsync(Path.Combine(rootH4b, "Aki.Launcher.exe"), "MZ fake");
    Check(SptLauncher.FindServerExe(rootH4b)!.EndsWith("Aki.Server.exe")
       && SptLauncher.FindLauncherExe(rootH4b)!.EndsWith("Aki.Launcher.exe"),
        "legacy Aki.Server.exe / Aki.Launcher.exe discovered");

    Check(SptLauncher.IsReadyMarker("[12:00:00] Server is ready — happy playing") 
       && SptLauncher.IsReadyMarker("INFO: Server is running on port 6969")
       && SptLauncher.IsReadyMarker("Happy playing!!!"),
        "ready phrases detected (case-insensitive)");
    Check(!SptLauncher.IsReadyMarker("loading mods…") && !SptLauncher.IsReadyMarker(null) && !SptLauncher.IsReadyMarker(""),
        "ordinary console lines are not ready markers");

    // REAL process chain: shell scripts stand in for the exes — the very same Process +
    // RedirectStandardOutput + ready-marker + chained-launch code that runs the real Windows
    // executables on a user machine.
    string fakeServer = Path.Combine(settingsRoot, "fake-server.sh");
    string fakeLauncher = Path.Combine(settingsRoot, "fake-launcher.sh");
    string launcherMarker = Path.Combine(settingsRoot, "launcher-started.marker");
    await File.WriteAllTextAsync(fakeServer,
        "#!/bin/sh\necho '[info] fake server booting'\nsleep 0.4\necho 'Server is running'\nwhile true; do sleep 1; done\n");
    await File.WriteAllTextAsync(fakeLauncher,
        "#!/bin/sh\necho launched > '" + launcherMarker + "'\n");
    foreach (string script in new[] { fakeServer, fakeLauncher })
        System.Diagnostics.Process.Start("chmod", $"+x {script}").WaitForExit();

    var consoleLines = new List<string>();
    var consoleProgress = new StringProgress(consoleLines.Add);
    SptLaunchResult launch = await SptLauncher.LaunchAsync(fakeServer, fakeLauncher, consoleProgress,
        readyTimeout: TimeSpan.FromSeconds(20));
    Check(launch.Success, "launch chain succeeds: server process → ready phrase → launcher spawned",
        launch.Message);
    Check(consoleLines.Any(l => l.Contains("Server is running")), "server stdout was really monitored (redirected stream read)");
    bool markerAppeared = false;
    for (int i = 0; i < 40 && !markerAppeared; i++)
    {
        await Task.Delay(100);
        markerAppeared = File.Exists(launcherMarker);
    }
    Check(markerAppeared, "the launcher process really executed (marker file written by the spawned process)");

    SptLaunchResult second = await SptLauncher.LaunchAsync(fakeServer, fakeLauncher, null, readyTimeout: TimeSpan.FromSeconds(5));
    Check(!second.Success && second.Message.Contains("already running"),
        "double-launch guard: a second attempt while the server lives fails cleanly", second.Message);

    try { SptLauncher.CurrentServer?.Kill(); } catch (InvalidOperationException) { }
    await Task.Delay(300);

    // failure path: server exits before ready
    string dyingServer = Path.Combine(settingsRoot, "dying-server.sh");
    await File.WriteAllTextAsync(dyingServer, "#!/bin/sh\necho '[fatal] port in use'\nexit 3\n");
    System.Diagnostics.Process.Start("chmod", $"+x {dyingServer}").WaitForExit();
    SptLaunchResult died = await SptLauncher.LaunchAsync(dyingServer, fakeLauncher, null, readyTimeout: TimeSpan.FromSeconds(10));
    Check(!died.Success && died.Message.Contains("exited before becoming ready"),
        "server that exits before ready → clear failure with last console output", died.Message);
}

}






// -------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("--- I. SPT 4.x SPT_Runtime layout: install targeting, data overlays & legacy migration ---");

// A 4.1-style install: everything lives inside SPT_Runtime.
string rootI = Path.Combine(settingsRoot, "i-spt41");
string rtI = Path.Combine(rootI, "SPT_Runtime");
Directory.CreateDirectory(Path.Combine(rtI, "user", "mods"));
Directory.CreateDirectory(Path.Combine(rootI, "BepInEx", "plugins")); // BepInEx stays at the install root
File.WriteAllText(Path.Combine(rtI, "SPT.Server.exe"), "stub-server-exe");
File.WriteAllText(Path.Combine(rtI, "package.json"), "{\"name\":\"spt\",\"version\":\"4.1.5\"}");

Check(SettingsService.FindRuntimeFolderName(rootI) == "SPT_Runtime", "runtime folder detected (SPT_Runtime)");
SettingsService.Instance.Settings.SptDirectory = rootI;
Check(SettingsService.Instance.ServerModPathEffective == "SPT_Runtime/user/mods", "effective server path is runtime-prefixed", SettingsService.Instance.ServerModPathEffective);
Check(SettingsService.Instance.ClientModPathEffective == "BepInEx/plugins", "effective client path stays at the install root (BepInEx kept where it was)", SettingsService.Instance.ClientModPathEffective);

// Hybrid layout (BepInEx inside the runtime, none at the root) → client path IS runtime-prefixed.
string rootIHy = Path.Combine(settingsRoot, "i-hybrid");
Directory.CreateDirectory(Path.Combine(rootIHy, "SPT_Runtime", "user", "mods"));
Directory.CreateDirectory(Path.Combine(rootIHy, "SPT_Runtime", "BepInEx", "plugins"));
File.WriteAllText(Path.Combine(rootIHy, "SPT_Runtime", "SPT.Server.exe"), "stub-server-exe");
SettingsService.Instance.Settings.SptDirectory = rootIHy;
Check(SettingsService.Instance.ClientModPathEffective == "SPT_Runtime/BepInEx/plugins",
    "hybrid layout (runtime-internal BepInEx): client path is runtime-prefixed", SettingsService.Instance.ClientModPathEffective);
SettingsService.Instance.Settings.SptDirectory = rootI;
Check(InstallService.DirectoryLooksLikeSptRoot(rootI), "4.1 install root recognized as an SPT root");
Check(InstallService.TryDetectSptVersion(rootI) == "4.1.5", "SPT version read from runtime package.json", InstallService.TryDetectSptVersion(rootI));
Check(SptLauncher.FindServerExe(rootI) == Path.Combine(rtI, "SPT.Server.exe"), "server executable found inside SPT_Runtime");

// A classic-structured zip (user/mods + BepInEx/plugins + an EscapeFromTarkov_Data overlay) must
// land INSIDE the runtime, with the overlay merged into the root data folder.
string stageI = Path.Combine(settingsRoot, "i-stage-legacy");
Directory.CreateDirectory(Path.Combine(stageI, "user", "mods", "pkgLegacy"));
File.WriteAllText(Path.Combine(stageI, "user", "mods", "pkgLegacy", "package.json"), "{\"name\":\"legacy\",\"version\":\"1.0.0\"}");
Directory.CreateDirectory(Path.Combine(stageI, "BepInEx", "plugins"));
File.WriteAllText(Path.Combine(stageI, "BepInEx", "plugins", "LegacyPlugin.dll"), "dll-bytes");
Directory.CreateDirectory(Path.Combine(stageI, "EscapeFromTarkov_Data", "StreamingAssets"));
File.WriteAllText(Path.Combine(stageI, "EscapeFromTarkov_Data", "StreamingAssets", "overlay.bnk"), "audio");
string zipI = Path.Combine(settingsRoot, "i-legacy.zip");
System.IO.Compression.ZipFile.CreateFromDirectory(stageI, zipI);
await InstallService.ExtractDownloadedArchiveAsync(zipI, rootI, "Legacy Mod");
Check(File.Exists(Path.Combine(rtI, "user", "mods", "pkgLegacy", "package.json")), "classic zip: server mod installed into SPT_Runtime\\user\\mods");
Check(File.Exists(Path.Combine(rootI, "BepInEx", "plugins", "LegacyPlugin.dll")), "classic zip: plugin installed into the ROOT BepInEx\\plugins (kept where it was)");
Check(!File.Exists(Path.Combine(rtI, "BepInEx", "plugins", "LegacyPlugin.dll")), "classic zip: plugin NOT duplicated into the runtime");
Check(File.Exists(Path.Combine(rootI, "EscapeFromTarkov_Data", "StreamingAssets", "overlay.bnk")), "classic zip: data overlay merged into root EscapeFromTarkov_Data");
Check(!Directory.Exists(Path.Combine(rootI, "user", "mods", "pkgLegacy")), "classic zip: nothing leaked into the old root\\user\\mods");

// A 4.1-native zip (SPT_Runtime/… wrapper) lands in the same runtime locations.
string stageI2 = Path.Combine(settingsRoot, "i-stage-41");
Directory.CreateDirectory(Path.Combine(stageI2, "SPT_Runtime", "user", "mods", "pkg41"));
File.WriteAllText(Path.Combine(stageI2, "SPT_Runtime", "user", "mods", "pkg41", "package.json"), "{\"name\":\"p41\",\"version\":\"2.0.0\"}");
Directory.CreateDirectory(Path.Combine(stageI2, "SPT_Runtime", "BepInEx", "plugins"));
File.WriteAllText(Path.Combine(stageI2, "SPT_Runtime", "BepInEx", "plugins", "P41.dll"), "dll-bytes");
string zipI2 = Path.Combine(settingsRoot, "i-41.zip");
System.IO.Compression.ZipFile.CreateFromDirectory(stageI2, zipI2);
await InstallService.ExtractDownloadedArchiveAsync(zipI2, rootI, "Mod 41");
Check(File.Exists(Path.Combine(rtI, "user", "mods", "pkg41", "package.json")), "4.1-native zip: server mod installed into SPT_Runtime\\user\\mods");
Check(File.Exists(Path.Combine(rootI, "BepInEx", "plugins", "P41.dll")), "4.1-native zip: plugin installed into the ROOT BepInEx\\plugins (unified with the local layout)");

// Migration of a pre-existing mess (the reported situation): mods and a data overlay stranded
// in the classic locations while the game loads from SPT_Runtime.
string rootI2 = Path.Combine(settingsRoot, "i-spt41-mess");
Directory.CreateDirectory(Path.Combine(rootI2, "SPT_Runtime", "user", "mods"));
File.WriteAllText(Path.Combine(rootI2, "SPT_Runtime", "SPT.Server.exe"), "stub-server-exe");
Directory.CreateDirectory(Path.Combine(rootI2, "user", "mods", "com.example.oldmod"));
File.WriteAllText(Path.Combine(rootI2, "user", "mods", "com.example.oldmod", "package.json"), "{}");
Directory.CreateDirectory(Path.Combine(rootI2, "user", "mods", "EscapeFromTarkov_Data", "StreamingAssets"));
File.WriteAllText(Path.Combine(rootI2, "user", "mods", "EscapeFromTarkov_Data", "StreamingAssets", "new.bnk"), "x");
Directory.CreateDirectory(Path.Combine(rootI2, "user", "mods", "EscapeFromTarkov_Data", "sub"));
File.WriteAllText(Path.Combine(rootI2, "user", "mods", "EscapeFromTarkov_Data", "sub", "deep.txt"), "y");
Directory.CreateDirectory(Path.Combine(rootI2, "EscapeFromTarkov_Data", "StreamingAssets"));
File.WriteAllText(Path.Combine(rootI2, "EscapeFromTarkov_Data", "StreamingAssets", "existing.bnk"), "keep");
Directory.CreateDirectory(Path.Combine(rootI2, "BepInEx", "plugins"));
File.WriteAllText(Path.Combine(rootI2, "BepInEx", "plugins", "OldPlugin.dll"), "dll-bytes");

Check(SptLayoutMigrator.HasLegacyContent(rootI2), "migration offered when legacy content exists");
SptLayoutMigrator.MigrationResult mig = SptLayoutMigrator.Migrate(rootI2, "SPT_Runtime");
Check(mig.ItemsMoved == 1
      && File.Exists(Path.Combine(rootI2, "SPT_Runtime", "user", "mods", "com.example.oldmod", "package.json")),
      "migration: legacy server mod moved into SPT_Runtime\\user\\mods", $"{mig.ItemsMoved} moved / {mig.ItemsSkippedExisting} skipped");
Check(File.Exists(Path.Combine(rootI2, "BepInEx", "plugins", "OldPlugin.dll")),
      "migration: root BepInEx\\plugins untouched (correct SPT 4.1 location)");
Check(File.Exists(Path.Combine(rootI2, "EscapeFromTarkov_Data", "StreamingAssets", "new.bnk"))
      && File.Exists(Path.Combine(rootI2, "EscapeFromTarkov_Data", "sub", "deep.txt"))
      && File.Exists(Path.Combine(rootI2, "EscapeFromTarkov_Data", "StreamingAssets", "existing.bnk")),
      "migration: data overlay merged into root EscapeFromTarkov_Data (existing files kept)", $"{mig.DataFilesMerged} merged");
Check(mig.LegacyFoldersRemoved
      && !Directory.Exists(Path.Combine(rootI2, "user"))
      && Directory.Exists(Path.Combine(rootI2, "BepInEx")),
      "migration: emptied user\\mods removed; BepInEx folder left in place");
Check(!SptLayoutMigrator.HasLegacyContent(rootI2), "migration: no legacy content remains (prompt will not reappear)");

// A root with only BepInEx plugins is the CORRECT 4.1 layout — no migration prompt.
string rootIBo = Path.Combine(settingsRoot, "i-bepinex-only");
Directory.CreateDirectory(Path.Combine(rootIBo, "SPT_Runtime", "user", "mods"));
File.WriteAllText(Path.Combine(rootIBo, "SPT_Runtime", "SPT.Server.exe"), "stub-server-exe");
Directory.CreateDirectory(Path.Combine(rootIBo, "BepInEx", "plugins"));
File.WriteAllText(Path.Combine(rootIBo, "BepInEx", "plugins", "X.dll"), "dll-bytes");
Check(!SptLayoutMigrator.HasLegacyContent(rootIBo), "root BepInEx\\plugins alone is not legacy content (no prompt)");

// Collision handling + the 4.0-era runtime folder name ("SPT").
string rootI3 = Path.Combine(settingsRoot, "i-spt40");
Directory.CreateDirectory(Path.Combine(rootI3, "SPT", "user", "mods", "dupMod"));
File.WriteAllText(Path.Combine(rootI3, "SPT", "user", "mods", "dupMod", "package.json"), "{\"v\":\"runtime\"}");
File.WriteAllText(Path.Combine(rootI3, "SPT", "Aki.Server.exe"), "stub-server-exe");
Directory.CreateDirectory(Path.Combine(rootI3, "user", "mods", "dupMod"));
File.WriteAllText(Path.Combine(rootI3, "user", "mods", "dupMod", "package.json"), "{\"v\":\"legacy\"}");
Check(SettingsService.FindRuntimeFolderName(rootI3) == "SPT", "4.0-era runtime folder name (SPT) detected");
SptLayoutMigrator.MigrationResult mig2 = SptLayoutMigrator.Migrate(rootI3, "SPT");
Check(mig2.ItemsSkippedExisting == 1
      && File.ReadAllText(Path.Combine(rootI3, "SPT", "user", "mods", "dupMod", "package.json")).Contains("runtime")
      && File.Exists(Path.Combine(rootI3, "user", "mods", "dupMod", "package.json")),
      "migration: existing runtime mod wins — the legacy duplicate is left in place, nothing deleted", $"{mig2.ItemsSkippedExisting} skipped");

// Classic 3.x layout: no runtime folder → no prefix, behavior unchanged.
string rootI4 = Path.Combine(settingsRoot, "i-classic");
Directory.CreateDirectory(Path.Combine(rootI4, "user", "mods"));
Directory.CreateDirectory(Path.Combine(rootI4, "BepInEx", "plugins"));
SettingsService.Instance.Settings.SptDirectory = rootI4;
Check(SettingsService.FindRuntimeFolderName(rootI4) is null, "classic layout: no runtime folder detected");
Check(SettingsService.Instance.ServerModPathEffective == "user/mods" && SettingsService.Instance.ClientModPathEffective == "BepInEx/plugins",
      "classic layout: effective paths unchanged (no runtime prefix)", SettingsService.Instance.ServerModPathEffective + " | " + SettingsService.Instance.ClientModPathEffective);


// -------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("--- J. Standalone 7-Zip extraction (bundled 7za binaries + SevenZipService) ---");

// The bundled Windows binaries are the real official 7-Zip x64 console build.
string repoRootJ = Directory.Exists("/home/user/Blacksite") ? "/home/user/Blacksite"
    : Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "..", "Blacksite"));
byte[] ReadHeaderJ(string p) { using var fs = File.OpenRead(p); var b = new byte[4096]; int n = fs.Read(b, 0, b.Length); Array.Resize(ref b, n); return b; }
bool IsPeX64J(string p, bool expectDll)
{
    try
    {
        byte[] b = ReadHeaderJ(p);
        if (b.Length < 0x40 || b[0] != (byte)'M' || b[1] != (byte)'Z') return false;
        int peOff = BitConverter.ToInt32(b, 0x3C);
        if (peOff + 24 > b.Length || b[peOff] != (byte)'P' || b[peOff+1] != (byte)'E' || b[peOff+2] != 0 || b[peOff+3] != 0) return false;
        bool machineOk = BitConverter.ToUInt16(b, peOff + 4) == 0x8664;
        bool dllFlag = (BitConverter.ToUInt16(b, peOff + 22) & 0x2000) != 0;
        return machineOk && dllFlag == expectDll;
    }
    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return false; }
}
string bundledExeJ = Path.Combine(repoRootJ, "tools", "7zip", "win", "7za.exe");
string bundledDllJ = Path.Combine(repoRootJ, "tools", "7zip", "win", "7za.dll");
Check(File.Exists(bundledExeJ) && new FileInfo(bundledExeJ).Length > 500_000 && IsPeX64J(bundledExeJ, expectDll: false),
    "bundled 7za.exe is a genuine PE x86-64 executable", File.Exists(bundledExeJ) ? $"{new FileInfo(bundledExeJ).Length:N0} bytes" : "missing");
Check(File.Exists(bundledDllJ) && new FileInfo(bundledDllJ).Length > 200_000 && IsPeX64J(bundledDllJ, expectDll: true),
    "bundled 7za.dll is a genuine PE x86-64 DLL", File.Exists(bundledDllJ) ? $"{new FileInfo(bundledDllJ).Length:N0} bytes" : "missing");
Check(SevenZipService.GetBundledBinaryPath() ==
      Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "tools", "7zip", "win", "7za.exe"),
    "binary path resolves to <app>\\tools\\7zip\\win\\7za.exe", SevenZipService.GetBundledBinaryPath());

// Real extraction with the official 7-Zip engine (Linux build of the same 26.03 code) through
// the production SevenZipService code path, on a real sp-mod.com .7z archive.
string sevenZzJ = File.Exists("/home/user/Tools/7zz") ? "/home/user/Tools/7zz"
    : Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "..", "Tools", "7zz"));
Check(File.Exists(sevenZzJ), "official 7-Zip engine available for the harness");
var sevenZipJ = new SevenZipService(sevenZzJ);
Check(sevenZipJ.ResolveBinary() == sevenZzJ, "explicit binary override wins resolution", sevenZipJ.ResolveBinary());

string jRoot = Path.Combine(settingsRoot, "j-7zip");
string freecam7z = "/tmp/freecam.zip"; // real sp-mod.com archive in 7z format
if (!File.Exists(freecam7z))
{
    // refetch from the live API if the tmp sample was purged
    using var apiF = new SpModApiClient();
    var versionsF = await apiF.GetVersionsAsync(164, CancellationToken.None);
    string link = versionsF.OrderByDescending(v => SemVersion.TryParse(v.Version) ?? SemVersion.Zero).First().Link;
    using var httpF = new HttpClient();
    httpF.DefaultRequestHeaders.Add("User-Agent", "BlacksiteModManager/1.0 (+https://sp-mod.com)");
    byte[] bytesF = await httpF.GetByteArrayAsync(link);
    File.WriteAllBytes(freecam7z, bytesF);
}
Check(ArchiveExtractor.DetectWithExtensionFallback(freecam7z) == ArchiveKind.SevenZip, "sample is a real 7z archive", freecam7z);

// Deterministic real fixture: pack a nested tree with the official 7-Zip binary, then extract
// it back through the production service code path.
string jFixture = Path.Combine(jRoot, "fixture-src");
string[] jRelPaths = { "BepInEx/plugins/Pkg/Plugin.dll", "BepInEx/plugins/Pkg/deps.json", "user/mods/pkg/data/config.json", "user/mods/pkg/package.json", "user/mods/pkg/src/main.js", "readme.txt" };
foreach (string rel in jRelPaths)
{
    string p = Path.Combine(jFixture, rel.Replace('/', Path.DirectorySeparatorChar));
    Directory.CreateDirectory(Path.GetDirectoryName(p)!);
    File.WriteAllText(p, $"fixture content of {rel} — {Guid.NewGuid():N}");
}
string jFixtureArchive = Path.Combine(jRoot, "fixture.7z");
// Pack from inside the fixture directory so stored paths are relative ("BepInEx/…", "readme.txt").
var packJ = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
{
    FileName = sevenZzJ, Arguments = $"a -t7z \"{jFixtureArchive}\" . -bso0 -y",
    WorkingDirectory = jFixture,
    CreateNoWindow = true, UseShellExecute = false, RedirectStandardError = true,
})!;
string packErrJ = await packJ.StandardError.ReadToEndAsync();
await packJ.WaitForExitAsync();
Check(packJ.ExitCode == 0, "official 7-Zip packed the test fixture", packErrJ.Trim());

string rawDest = Path.Combine(jRoot, "raw extract with spaces");
bool okJ = await sevenZipJ.ExtractArchiveAsync(jFixtureArchive, rawDest);
List<string> rawFiles = Directory.Exists(rawDest) ? Directory.GetFiles(rawDest, "*", SearchOption.AllDirectories).ToList() : new();
Check(okJ && rawFiles.Count == jRelPaths.Length, "real 7z archive extracted with full directory tree (path with spaces)",
    $"{rawFiles.Count} files");
int exactPathsJ = jRelPaths.Count(rel => File.Exists(Path.Combine(rawDest, rel.Replace('/', Path.DirectorySeparatorChar))));
Check(exactPathsJ == jRelPaths.Length, "every extracted file sits at its exact archived path", $"{exactPathsJ}/{jRelPaths.Length}");
bool contentOkJ = jRelPaths.All(rel =>
{
    string archived = Path.Combine(jFixture, rel.Replace('/', Path.DirectorySeparatorChar));
    string extracted = Path.Combine(rawDest, rel.Replace('/', Path.DirectorySeparatorChar));
    return File.Exists(archived) && File.Exists(extracted) && File.ReadAllText(extracted) == File.ReadAllText(archived);
});
Check(contentOkJ, "extracted file contents are byte-identical to the packed originals");

// Live sp-mod.com .7z sample through the same path (host packaging may vary — tree is what matters).
string liveDest = Path.Combine(jRoot, "live-out");
bool liveOkJ = await sevenZipJ.ExtractArchiveAsync(freecam7z, liveDest);
List<string> liveFilesJ = Directory.Exists(liveDest) ? Directory.GetFiles(liveDest, "*", SearchOption.AllDirectories).ToList() : new();
Check(liveOkJ && liveFilesJ.Count >= 1 && liveFilesJ.All(f => f.StartsWith(liveDest)),
    "live sp-mod.com 7z archive extracts (tree preserved under destination)", $"{liveFilesJ.Count} files");

// Cross-engine verification: the same archive installed by the in-process extractor must
// produce every file the 7za extraction produced (content-identical, byte for byte).
string jInstallRoot = Path.Combine(jRoot, "install-root");
Directory.CreateDirectory(jInstallRoot);
await InstallService.ExtractDownloadedArchiveAsync(jFixtureArchive, jInstallRoot, "Fixture");
var installedHashes = new HashSet<string>();
foreach (string f in Directory.GetFiles(jInstallRoot, "*", SearchOption.AllDirectories))
    installedHashes.Add(Convert.ToHexString(await System.Security.Cryptography.SHA256.HashDataAsync(File.OpenRead(f))));
int matchedJ = 0;
foreach (string f in rawFiles)
    if (installedHashes.Contains(Convert.ToHexString(await System.Security.Cryptography.SHA256.HashDataAsync(File.OpenRead(f))))) matchedJ++;
Check(matchedJ == rawFiles.Count, "7za and in-process extraction agree byte-for-byte on every file",
    $"{matchedJ}/{rawFiles.Count} matched");

// -y auto-overwrite: extracting again into the same destination succeeds and keeps content valid.
bool againJ = await sevenZipJ.ExtractArchiveAsync(jFixtureArchive, rawDest);
int filesAfter = Directory.GetFiles(rawDest, "*", SearchOption.AllDirectories).Length;
Check(againJ && filesAfter == rawFiles.Count, "second extraction auto-overwrites (-y) without errors", $"{filesAfter} files");

// Destination directories are created on demand (nested, nonexistent).
string deepDest = Path.Combine(jRoot, "made", "on", "demand");
bool deepOk = await sevenZipJ.ExtractArchiveAsync(jFixtureArchive, deepDest);
Check(deepOk && Directory.GetFiles(deepDest, "*", SearchOption.AllDirectories).Length == rawFiles.Count,
    "nonexistent nested destination is created automatically");

// Corrupted archive → 7-Zip fatal exit code (2) → false (not an exception).
byte[] headJ; using (var fsJ = File.OpenRead(freecam7z)) { headJ = new byte[64]; fsJ.Read(headJ, 0, 64); }
string corruptJ = Path.Combine(jRoot, "corrupt.7z");
File.WriteAllBytes(corruptJ, headJ.Concat(System.Security.Cryptography.RandomNumberGenerator.GetBytes(64 * 1024)).ToArray());
bool corruptResult = await sevenZipJ.ExtractArchiveAsync(corruptJ, Path.Combine(jRoot, "corrupt-out"));
Check(!corruptResult, "corrupted archive → exit code 2 → false", $"result={corruptResult}");

// Missing archive and missing binary are handled errors (FileNotFoundException).
bool threwMissingArchive = false;
try { await sevenZipJ.ExtractArchiveAsync(Path.Combine(jRoot, "nope.7z"), Path.Combine(jRoot, "o")); }
catch (FileNotFoundException) { threwMissingArchive = true; }
Check(threwMissingArchive, "missing archive → handled FileNotFoundException");
var noBinaryJ = new SevenZipService(Path.Combine(jRoot, "does-not-exist"));
Check(noBinaryJ.ResolveBinary() is null, "no bundled/system binary → resolution returns null");
bool threwNoBinary = false;
try { await noBinaryJ.ExtractArchiveAsync(freecam7z, Path.Combine(jRoot, "o2")); }
catch (FileNotFoundException) { threwNoBinary = true; }
Check(threwNoBinary, "no 7-Zip available → handled FileNotFoundException");


// -------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("--- K. High-file-count parallel extraction (staged, byte-gated progress, atomic move) ---");

// The SPT worst case: 3,000 tiny database JSONs + 2 large bundles in one payload mod.
string rootK = Path.Combine(settingsRoot, "k-spt41");
string rtK = Path.Combine(rootK, "SPT_Runtime");
Directory.CreateDirectory(Path.Combine(rtK, "user", "mods"));
File.WriteAllText(Path.Combine(rtK, "SPT.Server.exe"), "stub-server-exe");
SettingsService.Instance.Settings.SptDirectory = rootK;

string kSrc = Path.Combine(settingsRoot, "k-src");
string kMod = Path.Combine(kSrc, "BigMod");
string[] kJsonRel = new string[3000];
for (int i = 0; i < 3000; i++)
{
    string rel = $"data/db/shard{i / 100:D2}/entry{i:D4}.json".Replace('/', Path.DirectorySeparatorChar);
    kJsonRel[i] = rel;
    string p = Path.Combine(kMod, rel);
    Directory.CreateDirectory(Path.GetDirectoryName(p)!);
    File.WriteAllText(p, $"{{\"id\": {i}, \"loot\": \"item-{Guid.NewGuid():N}\"}}");
}
File.WriteAllText(Path.Combine(kMod, "package.json"), "{\"name\":\"bigmod\",\"version\":\"1.0.0\"}");
byte[] kBig1 = System.Security.Cryptography.RandomNumberGenerator.GetBytes(4 * 1024 * 1024);
byte[] kBig2 = System.Security.Cryptography.RandomNumberGenerator.GetBytes(4 * 1024 * 1024);
Directory.CreateDirectory(Path.Combine(kMod, "media"));
File.WriteAllBytes(Path.Combine(kMod, "media", "bundle1.bundle"), kBig1);
File.WriteAllBytes(Path.Combine(kMod, "media", "bundle2.bundle"), kBig2);
string kZip = Path.Combine(settingsRoot, "k-bigmod.zip");
System.IO.Compression.ZipFile.CreateFromDirectory(kSrc, kZip);

var timingK = new TimingProgress();
string[] preStagingK = Directory.GetDirectories(Path.GetTempPath(), "bs-extract-*");
await InstallService.ExtractDownloadedArchiveAsync(kZip, rootK, "Big Mod", timingK);

string installedK = Path.Combine(rtK, "user", "mods", "BigMod");
int fileCountK = Directory.Exists(installedK) ? Directory.GetFiles(installedK, "*", SearchOption.AllDirectories).Length : 0;
Check(fileCountK == 3003, "3,003-file archive installed (payload folder → single atomic move)", $"{fileCountK} files");
Check(File.ReadAllText(Path.Combine(installedK, "package.json")).Contains("bigmod"), "payload root files landed correctly");
bool kJsonOk = kJsonRel.Take(50).All(rel =>
    File.ReadAllText(Path.Combine(installedK, rel)).StartsWith("{\"id\":"));
Check(kJsonOk, "tiny-file contents are intact across the parallel extraction");
Check(await File.ReadAllBytesAsync(Path.Combine(installedK, "media", "bundle1.bundle")) is var b1 && b1.SequenceEqual(kBig1)
      && await File.ReadAllBytesAsync(Path.Combine(installedK, "media", "bundle2.bundle")) is var b2 && b2.SequenceEqual(kBig2),
    "large sequential files are byte-identical (4 MB each)");

List<double> kValues = timingK.Values;
Check(kValues.Count >= 2 && Math.Abs(kValues[0]) < 0.01 && Math.Abs(kValues[^1] - 100.0) < 0.001,
    "progress: 0% first, exactly 100% last", $"{kValues.Count} reports");
Check(kValues.SequenceEqual(kValues.OrderBy(p => p)), "progress stays monotonic under concurrency");
long kElapsed = timingK.ElapsedMs;
Check(kValues.Count <= kElapsed / 150 + 3,
    "progress dispatch obeys the 150 ms gate (report count ≤ elapsed/150 + 3)", $"{kValues.Count} reports over {kElapsed} ms");
bool kGapsOk = true;
for (int i = 1; i < kValues.Count - 1; i++)  // terminal 0%/100% bypass the gate by design
    if (timingK.MsAt(i) - timingK.MsAt(i - 1) < 140) { kGapsOk = false; break; }
Check(kGapsOk, "non-terminal progress reports are ≥ ~150 ms apart (in-between updates dropped)");

string[] postStagingK = Directory.GetDirectories(Path.GetTempPath(), "bs-extract-*");
Check(postStagingK.Length == preStagingK.Length, "staging folder in %TEMP% fully cleaned up after install",
    $"{preStagingK.Length} before → {postStagingK.Length} after");

// Merge/overwrite: reinstalling into the now-existing tree must stay intact.
await InstallService.ExtractDownloadedArchiveAsync(kZip, rootK, "Big Mod");
int fileCountK2 = Directory.GetFiles(installedK, "*", SearchOption.AllDirectories).Length;
Check(fileCountK2 == 3003
      && File.ReadAllText(Path.Combine(installedK, "package.json")).Contains("bigmod")
      && (await File.ReadAllBytesAsync(Path.Combine(installedK, "media", "bundle1.bundle"))).SequenceEqual(kBig1),
    "reinstall merges/overwrites the existing tree without loss", $"{fileCountK2} files");

// Root-structured + wrapper archives still land correctly through the staged engine.
string kRootStruct = Path.Combine(settingsRoot, "k-rootstruct");
Directory.CreateDirectory(Path.Combine(kRootStruct, "SPT_Runtime", "user", "mods"));
File.WriteAllText(Path.Combine(kRootStruct, "SPT_Runtime", "SPT.Server.exe"), "stub-server-exe");
Directory.CreateDirectory(Path.Combine(kRootStruct, "BepInEx", "plugins"));
Directory.CreateDirectory(Path.Combine(kRootStruct, "user", "mods", "ExistingMod"));  // legacy content — must merge, not clobber

File.WriteAllText(Path.Combine(kRootStruct, "user", "mods", "ExistingMod", "keep.json"), "keep");
string kStage2 = Path.Combine(settingsRoot, "k-stage2");
Directory.CreateDirectory(Path.Combine(kStage2, "SPT", "user", "mods", "NewMod"));
File.WriteAllText(Path.Combine(kStage2, "SPT", "user", "mods", "NewMod", "package.json"), "{}");
Directory.CreateDirectory(Path.Combine(kStage2, "SPT", "BepInEx", "plugins"));
File.WriteAllText(Path.Combine(kStage2, "SPT", "BepInEx", "plugins", "P.dll"), "dll");
string kZip2 = Path.Combine(settingsRoot, "k-wrapped.zip");
System.IO.Compression.ZipFile.CreateFromDirectory(kStage2, kZip2);
SettingsService.Instance.Settings.SptDirectory = kRootStruct;
await InstallService.ExtractDownloadedArchiveAsync(kZip2, kRootStruct, "Wrapped");
Check(File.Exists(Path.Combine(kRootStruct, "SPT_Runtime", "user", "mods", "NewMod", "package.json")),
    "wrapped archive: server mod merged into SPT_Runtime\\user\\mods");
Check(File.Exists(Path.Combine(kRootStruct, "BepInEx", "plugins", "P.dll")),
    "wrapped archive: plugin merged into the root BepInEx\\plugins");
Check(File.Exists(Path.Combine(kRootStruct, "user", "mods", "ExistingMod", "keep.json")),
    "existing legacy content untouched by the merge");

// Startup sweep removes crashed extraction staging folders (bs-extract-*).
string fakeK = Path.Combine(Path.GetTempPath(), "bs-extract-crashed" + Guid.NewGuid().ToString("N")[..8]);
Directory.CreateDirectory(Path.Combine(fakeK, "BigMod", "data"));
File.WriteAllText(Path.Combine(fakeK, "BigMod", "data", "x.json"), "x");
InstallService.SweepStaleTempFiles();
Check(!Directory.Exists(fakeK), "startup sweep removes crashed bs-extract-* staging folders");

Console.WriteLine();
Console.WriteLine($"RESULT: {pass} passed, {fail} failed");
return fail == 0 ? 0 : 1;

// --------------------------------------------------------------------------- helpers

sealed class CollectingProgress : IProgress<InstallProgress>
{
    public List<double> ExtractPercents { get; } = new();
    public void Report(InstallProgress value)
    {
        if (value.Stage == InstallStage.Extracting && value.Percent >= 0)
            lock (ExtractPercents) ExtractPercents.Add(value.Percent);
    }
}

/// <summary>Synchronous IProgress&lt;string&gt; collector for console-stream assertions.</summary>
sealed class StringProgress : IProgress<string>
{
    private readonly Action<string> _collect;
    public StringProgress(Action<string> collect) => _collect = collect;
    public void Report(string value) => _collect(value);
}

internal static class HarnessUtil
{
    public static string Truncate(string? s, int len) =>
        string.IsNullOrEmpty(s) ? "" : (s.Length <= len ? s : s[..(len - 1)] + "…");
}

internal static class ModVersionExt
{
    public static int Downs(this ModVersion v) => v.Downloads;
}

sealed class NullProgress : IProgress<InstallProgress>
{
    public void Report(InstallProgress value) { }
}

/// <summary>Synchronous IProgress&lt;double&gt; collector — ordered, no thread-pool hop.</summary>
sealed class TimingProgress : IProgress<double>
{
    private readonly object _lock = new();
    private readonly List<double> _values = new();
    private readonly List<long> _ms = new();
    private readonly System.Diagnostics.Stopwatch _clock = System.Diagnostics.Stopwatch.StartNew();

    public void Report(double value)
    {
        lock (_lock) { _values.Add(value); _ms.Add(_clock.ElapsedMilliseconds); }
    }

    public List<double> Values { get { lock (_lock) return _values.ToList(); } }
    public long ElapsedMs { get { lock (_lock) return _ms.Count > 0 ? _ms[^1] : 0; } }
    public long MsAt(int index) { lock (_lock) return _ms[index]; }
}

sealed class SyncCollector : IProgress<double>
{
    private readonly Action<double> _collect;
    public SyncCollector(Action<double> collect) => _collect = collect;
    public void Report(double value) => _collect(value);
}

/// <summary>Serves fixed bytes (a REAL downloaded archive) over HTTP with a correct Content-Length.</summary>
sealed class StaticFileServer : IDisposable
{
    private readonly byte[] _content;
    private readonly TcpListener _listener;

    public string Url { get; }

    public StaticFileServer(byte[] content)
    {
        _content = content;
        _listener = new TcpListener(IPAddress.Loopback, 0);
        _listener.Start();
        Url = $"http://127.0.0.1:{((IPEndPoint)_listener.LocalEndpoint).Port}/file.bin";
        _ = Task.Run(AcceptLoop);
    }

    private async Task AcceptLoop()
    {
        try
        {
            while (true)
            {
                TcpClient client = await _listener.AcceptTcpClientAsync();
                _ = Task.Run(() => Handle(client));
            }
        }
        catch (ObjectDisposedException) { }
    }

    private async Task Handle(TcpClient client)
    {
        try
        {
            using NetworkStream stream = client.GetStream();
            var buffer = new byte[8192];
            var head = new StringBuilder();
            while (!head.ToString().Contains("\r\n\r\n", StringComparison.Ordinal))
            {
                int n = await stream.ReadAsync(buffer);
                if (n <= 0) return;
                head.Append(Encoding.ASCII.GetString(buffer, 0, n));
            }
            byte[] header = Encoding.ASCII.GetBytes(
                "HTTP/1.1 200 OK\r\n" +
                $"Content-Length: {_content.Length}\r\n" +
                "Content-Type: application/octet-stream\r\n" +
                "Connection: close\r\n\r\n");
            await stream.WriteAsync(header);
            await stream.WriteAsync(_content);
            await stream.FlushAsync();
        }
        catch (Exception) { }
        finally { client.Close(); }
    }

    public void Dispose() => _listener.Stop();
}
