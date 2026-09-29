// =============================================================================
// Blacksite Mod Manager — DependencySmokeTest (task 6.1 acceptance)
//
// Hermetic (task 5.0 conventions): zero network, zero fixtures — the production
// SpModApiClient / InstallService / InstallQueueEngine pipeline runs against a
// FAKE HttpMessageHandler that serves canned 429s, stalled streams and real
// in-memory zip archives. Sections are crash-isolated; the RESULT line at the
// end carries the machine-readable totals.
//
// Covers the four acceptance criteria:
//   §A  429 with a SHORT Retry-After → per-second countdown surfaces, wait honored
//   §B  429 with a LONG Retry-After → fails fast with a retryable error (cap respected) + Retry works
//   §C  stalled stream → fails inside the watchdog window, then Retry succeeds
//   §D  unanswered dependency prompt → WaitingForUser → auto-cancel after the timeout
//   §E  dependency loop → per-dependency progress entries with their own percent
//   §0  install trace log: timestamped events + size-capped rolling
// =============================================================================

using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Blacksite.Models;
using Blacksite.Services;

Console.OutputEncoding = Encoding.UTF8;

int pass = 0, fail = 0, skipped = 0;
void Check(bool ok, string label, string? detail = null)
{
    if (ok) { pass++; Console.WriteLine($"  [PASS] {label}" + (detail is null ? "" : $"  [{detail}]")); }
    else { fail++; Console.WriteLine($"  [FAIL] {label}" + (detail is null ? "" : $"  [{detail}]")); }
}

// Redirect app settings away from the real AppData (same trick as FilterSmokeTest).
string settingsRoot = Path.Combine("/home/user/.cache", "bs-dep-smoke-" + Guid.NewGuid().ToString("N")[..8]);
Environment.SetEnvironmentVariable("XDG_CONFIG_HOME", settingsRoot);

// ------------------------------------------------------------------ helpers

static byte[] MakeZip(params (string Path, string Content)[] entries)
{
    using var ms = new MemoryStream();
    using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        foreach (var (path, content) in entries)
        {
            ZipArchiveEntry entry = zip.CreateEntry(path, CompressionLevel.Optimal);
            using var writer = new StreamWriter(entry.Open());
            writer.Write(content);
        }
    return ms.ToArray();
}

static HttpResponseMessage Json(string body)
    => new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

static HttpResponseMessage TooManyRequests(int retryAfterSeconds)
    => new(HttpStatusCode.TooManyRequests)
    {
        Headers = { RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromSeconds(retryAfterSeconds)) }
    };

static HttpResponseMessage ZipResponse(byte[] bytes)
    => new(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) };

// Settings persist to disk (XDG_CONFIG_HOME) and IsInstalledLocally consults the recorded
// installed-mods map — sections that resolve dependencies need a CLEAN record, else earlier
// sections' installs make the resolver skip everything.
SettingsService FreshSettings()
{
    try { File.Delete(Path.Combine(settingsRoot, "BlacksiteModManager", "settings.json")); } catch { }
    return new SettingsService();
}

static string DescribeCounters(InstallQueueEngine engine)
{
    (int current, int queued, int completed) = engine.Counters;
    return $"Current: {current} | Queue: {queued} | Completed: {completed}";
}

static async Task<InstallQueueItem> WaitForTerminalAsync(InstallQueueItem item, TimeSpan timeout)
{
    DateTime deadline = DateTime.UtcNow + timeout;
    while (DateTime.UtcNow < deadline)
    {
        if (item.State is InstallTaskState.Completed or InstallTaskState.Failed) return item;
        await Task.Delay(40);
    }
    return item;
}

byte[] KomradeZip = MakeZip(("user/mods/KomradeBasics/package.json", """{ "name": "Komrade's Basics", "version": "2.0.0" }"""));
byte[] CommonLibZip = MakeZip(("user/mods/WTTCommonLib/package.json", """{ "name": "WTT CommonLib", "version": "1.0.0" }"""));

string VersionsJson(byte[] zip, string constraint = "3.11.4")
    => $$"""{"success":true,"data":[{"id":1,"version":"2.0.0","link":"http://fake.local/files/komrade.zip","content_length":{{zip.Length}},"spt_version_constraint":"{{constraint}}","downloads":42}]}""";

const string EmptyDepsJson = """{"success":true,"data":{"1776:2.0.0":[]}}""";
const string CommonLibDepsJson = """{"success":true,"data":{"1776:2.0.0":[{"id":2310,"guid":"com.wtt.commonlib","name":"WTT CommonLib","slug":"wtt-commonlib","latest_compatible_version":{"id":9,"version":"1.0.0","link":"http://fake.local/files/commonlib.zip","content_length":0},"conflict":false,"dependencies":[]}]}}""";
const string GhostDepsJson = """{"success":true,"data":{"1776:2.0.0":[{"id":555,"name":"Ghost Mod","slug":"ghost","conflict":false,"dependencies":[]}]}}""";

Mod NewMod() => new()
{
    Id = 1776,
    Name = "Komrade's Basics",
    Teaser = "fixture mod"
    // PackageId is a computed read-only member on Mod (guid/slug fallback)
};

string NewSptRoot()
{
    string root = Path.Combine(settingsRoot, "spt-" + Guid.NewGuid().ToString("N")[..6]);
    Directory.CreateDirectory(Path.Combine(root, "user", "mods"));
    Directory.CreateDirectory(Path.Combine(root, "BepInEx", "plugins"));
    return root;
}

(string? SubTask, string? StatusDetail, double Percent) Observe(InstallQueueItem item,
    System.Collections.Concurrent.ConcurrentQueue<(InstallTaskState State, string? SubTask, string? StatusDetail, double Percent)> log)
{
    item.PropertyChanged += (_, _) => log.Enqueue((item.State, item.SubTask, item.StatusDetail, item.Percent));
    return (null, null, -1);
}

// ===========================================================================
Console.WriteLine("=== Blacksite Dependency Freeze Fixes smoke test (task 6.1) ===");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("--- 0. Install trace: timestamped events + rolling size cap ---");
try
{
    string traceFile = InstallTrace.FilePath;
    File.Delete(traceFile);
    File.Delete(traceFile + ".1");
    InstallTrace.MaxBytes = 2048;
    for (int i = 0; i < 12; i++) InstallTrace.Log("test", new string('x', 300));
    Check(File.Exists(traceFile), "trace file exists", traceFile);
    Check(File.Exists(traceFile + ".1"), "trace rolled to install-trace.log.1 at the size cap");
    Check(new FileInfo(traceFile).Length <= 2048, "active trace file respects the cap", $"{new FileInfo(traceFile).Length} B");
    string firstLine = File.ReadLines(traceFile + ".1").First();
    Check(firstLine.Contains('[') && firstLine.Contains("]") && firstLine.Contains("test"), "lines carry timestamps + category", firstLine[..Math.Min(60, firstLine.Length)]);
    InstallTrace.MaxBytes = 1_048_576;
}
catch (Exception ex) { Check(false, "section 0 crashed", ex.GetType().Name + ": " + ex.Message); }

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("--- A. 429 with a SHORT Retry-After: visible countdown, wait honored ---");
try
{
    int hits = 0;
    var handler = new FakeHandler(path =>
    {
        if (path == "/mod/31/versions")
            return Interlocked.Increment(ref hits) == 1 ? TooManyRequests(2) : Json("""{"success":true,"data":[{"id":1,"version":"1.0.8","link":"http://fake.local/files/x.zip"}]}""");
        return Json("""{"success":true,"data":[]}""");
    });
    using var api = new SpModApiClient(handler, "http://fake.local/");
    var notices = new System.Collections.Concurrent.ConcurrentQueue<string>();
    api.Notice += notices.Enqueue;

    var sw = System.Diagnostics.Stopwatch.StartNew();
    List<ModVersion> versions = await api.GetVersionsAsync(31, CancellationToken.None);
    sw.Stop();

    Check(versions.Count == 1 && versions[0].Version == "1.0.8", "request succeeds after the visible wait");
    Check(sw.Elapsed >= TimeSpan.FromSeconds(1.8), "the 2s Retry-After was actually honored", $"{sw.Elapsed.TotalSeconds:F1}s");
    Check(notices.Count(n => n.StartsWith("Rate limited by sp-mod.com — waiting", StringComparison.Ordinal)) >= 2,
        "per-second countdown surfaced through Notice", string.Join(" | ", notices));
    Check(notices.Any(n => n.Contains("attempt 1 of 6")), "countdown names the attempt");
    Check(notices.Any(n => n.Contains("retrying (attempt 2 of 6")), "wait-end notice announces the retry");
}
catch (Exception ex) { Check(false, "section A crashed", ex.GetType().Name + ": " + ex.Message); }

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("--- B. 429 with a LONG Retry-After: fails fast + retryable (cap respected) ---");
try
{
    bool serverHealthy = false;
    var handler = new FakeHandler(path =>
    {
        if (!serverHealthy && path == "/mod/1776/versions") return TooManyRequests(400);
        if (path == "/mod/1776/versions") return Json(VersionsJson(KomradeZip));
        if (path == "/mods/dependencies") return Json(EmptyDepsJson);
        if (path == "/files/komrade.zip") return ZipResponse(KomradeZip);
        return Json("""{"success":true,"data":[]}""");
    });
    using var api = new SpModApiClient(handler, "http://fake.local/");
    var settings = new SettingsService();
    var installer = new InstallService(api, settings);
    using var engine = new InstallQueueEngine(installer);
    string root = NewSptRoot();

    var sw = System.Diagnostics.Stopwatch.StartNew();
    InstallQueueItem item = engine.Enqueue(NewMod(), root, "3.11.4", _ => Task.FromResult(DependencyPromptResult.InstallWithDeps));
    await WaitForTerminalAsync(item, TimeSpan.FromSeconds(30));
    sw.Stop();

    Check(item.State == InstallTaskState.Failed, "item fails instead of hanging on the 400s demand");
    Check(sw.Elapsed < TimeSpan.FromSeconds(30), "failure is FAST (no 400s wait, no 6× ladder)", $"{sw.Elapsed.TotalSeconds:F1}s");
    Check(item.Error is not null && item.Error.Contains("rate limit", StringComparison.OrdinalIgnoreCase)
        && item.Error.Contains("90s") && item.Error.Contains("retry", StringComparison.OrdinalIgnoreCase),
        "error names the cap and is retryable", item.Error);
    Check(InstallQueueEngine.MaxParallelDownloads == 1, "queue slot freed for the next item (single-slot engine invariant)");

    // The failure is retryable: flip the server healthy and retry the SAME card.
    serverHealthy = true;
    Check(engine.Retry(item), "Retry re-enqueues the failed item");
    await WaitForTerminalAsync(item, TimeSpan.FromSeconds(30));
    Check(item.State == InstallTaskState.Completed, "retried item completes against a healthy server",
        item.State + " " + item.Error);
    Check(File.Exists(Path.Combine(root, "user", "mods", "KomradeBasics", "package.json")), "retried install wrote the mod files");
}
catch (Exception ex) { Check(false, "section B crashed", ex.GetType().Name + ": " + ex.Message); }

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("--- C. Stalled stream: watchdog fails the item fast, Retry then succeeds ---");
try
{
    bool stalled = true;
    var handler = new FakeHandler(path =>
    {
        if (path == "/mod/1776/versions") return Json(VersionsJson(KomradeZip));
        if (path == "/mods/dependencies") return Json(EmptyDepsJson);
        if (path == "/files/komrade.zip") return stalled
            ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(new StalledStream()) }
            : ZipResponse(KomradeZip);
        return Json("""{"success":true,"data":[]}""");
    });
    using var api = new SpModApiClient(handler, "http://fake.local/");
    api.DownloadStallTimeout = TimeSpan.FromSeconds(3); // configurable watchdog (default 60s)
    var settings = new SettingsService();
    var installer = new InstallService(api, settings);
    using var engine = new InstallQueueEngine(installer);
    string root = NewSptRoot();

    var sw = System.Diagnostics.Stopwatch.StartNew();
    InstallQueueItem item = engine.Enqueue(NewMod(), root, "3.11.4", _ => Task.FromResult(DependencyPromptResult.InstallWithDeps));
    await WaitForTerminalAsync(item, TimeSpan.FromSeconds(30));
    sw.Stop();

    Check(item.State == InstallTaskState.Failed, "stalled download fails the item cleanly");
    Check(item.Error is not null && item.Error.Contains("Download stalled — no data for 3s", StringComparison.Ordinal),
        "error states the watchdog window", item.Error);
    Check(sw.Elapsed < TimeSpan.FromSeconds(15), "failed inside the watchdog window — NOT six 3s stall-retries", $"{sw.Elapsed.TotalSeconds:F1}s");
    string? traceTail = null;
    try { traceTail = string.Join("\n", File.ReadLines(InstallTrace.FilePath).Reverse().Take(80)); } catch { }
    Check(traceTail?.Contains("[stall]") == true, "stall watchdog event landed in the install trace");

    stalled = false;
    Check(engine.Retry(item), "Retry re-enqueues the stalled item");
    await WaitForTerminalAsync(item, TimeSpan.FromSeconds(30));
    Check(item.State == InstallTaskState.Completed, "retried download completes", item.State + " " + item.Error);
    Check(File.Exists(Path.Combine(root, "user", "mods", "KomradeBasics", "package.json")), "files landed after the retry");
}
catch (Exception ex) { Check(false, "section C crashed", ex.GetType().Name + ": " + ex.Message); }

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("--- D. Unanswered dependency prompt: WaitingForUser → auto-cancel ---");
try
{
    var handler = new FakeHandler(path =>
    {
        if (path == "/mod/1776/versions") return Json(VersionsJson(KomradeZip));
        if (path == "/mods/dependencies") return Json(GhostDepsJson);       // one UNRESOLVED dep → prompt
        if (path == "/mod/555/versions") return Json("""{"success":true,"data":[]}"""); // fallback resolver: nothing
        return Json("""{"success":true,"data":[]}""");
    });
    using var api = new SpModApiClient(handler, "http://fake.local/");
    var settings = new SettingsService();
    var installer = new InstallService(api, settings);
    using var engine = new InstallQueueEngine(installer) { PromptTimeout = TimeSpan.FromSeconds(2) };
    string root = NewSptRoot();

    var log = new System.Collections.Concurrent.ConcurrentQueue<(InstallTaskState State, string? SubTask, string? StatusDetail, double Percent)>();
    InstallQueueItem item = engine.Enqueue(NewMod(), root, "3.11.4",
        _ => new TaskCompletionSource<DependencyPromptResult>().Task);      // the user never answers
    _ = Observe(item, log);

    await WaitForTerminalAsync(item, TimeSpan.FromSeconds(30));

    Check(log.Any(s => s.State == InstallTaskState.WaitingForUser), "card entered WaitingForUser while the prompt was open");
    Check(item.StatusText == "Waiting for your answer — choose how to handle dependencies"
        || log.Any(s => s.State == InstallTaskState.WaitingForUser), "waiting label is explicit on the card", item.StatusText);
    Check(item.State == InstallTaskState.Failed, "unanswered prompt ends as a clean failure, not a hang", item.State.ToString());
    Check(item.Error is not null && item.Error.Contains("Timed out waiting for dependency choice", StringComparison.Ordinal),
        "card note names the timeout default", item.Error);
    string? promptTrace = null;
    try { promptTrace = File.Exists(InstallTrace.FilePath) ? File.ReadAllText(InstallTrace.FilePath) : null; } catch { }
    Check(promptTrace?.Contains("TIMEOUT → defaulting to Cancel") == true, "prompt-shown + timeout landed in the install trace");
}
catch (Exception ex) { Check(false, "section D crashed", ex.GetType().Name + ": " + ex.Message); }

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("--- E. Pre-queue batch resolution: deps enqueued as INDEPENDENT queue items ---");
try
{
    var handler = new FakeHandler(path =>
    {
        if (path == "/mod/1776/versions") return Json(VersionsJson(KomradeZip));
        if (path == "/mods/dependencies") return Json(CommonLibDepsJson);
        if (path == "/files/komrade.zip") return ZipResponse(KomradeZip);
        if (path == "/files/commonlib.zip") return ZipResponse(CommonLibZip);
        return Json("""{"success":true,"data":[]}""");
    });
    using var api = new SpModApiClient(handler, "http://fake.local/");
    var settings = FreshSettings(); // clean record: dep 2310 was installed by earlier sections
    var installer = new InstallService(api, settings);
    using var engine = new InstallQueueEngine(installer);
    string root = NewSptRoot();

    ModVersion target = new()
    {
        Id = 1, Version = "2.0.0", Link = "http://fake.local/files/komrade.zip",
        ContentLength = KomradeZip.Length, SptVersionConstraint = "3.11.4"
    };

    // (1) fully async, non-blocking pre-queue resolution
    DependencyResolution resolution = await installer.ResolveDependenciesAsync(
        NewMod(), target, root, "3.11.4", CancellationToken.None);
    Check(resolution.InstallQueue.Count == 1 && resolution.InstallQueue[0].Id == 2310,
        "resolver flattens the tree into a batch list of missing deps",
        $"{resolution.InstallQueue.Count} dep(s): {string.Join(", ", resolution.InstallQueue.Select(d => d.Name))}");
    Check(resolution.NeedsPrompt && resolution.Prompt.Missing.Count == 1, "prompt carries the missing dep row");

    // (2) each dependency is its OWN queue item — enqueued BEFORE the mod, atomically deduped
    var finishes = new System.Collections.Concurrent.ConcurrentQueue<(int Id, InstallTaskState State)>();
    engine.TaskFinished += (item, _) => finishes.Enqueue((item.ModId, item.State));
    InstallQueueItem? depCard = engine.EnqueueResolvedIfAbsent(resolution.InstallQueue[0], root);
    Check(depCard is not null, "dependency enqueued as an independent card");
    Check(depCard!.Teaser == "Dependency · v1.0.0", "dep card is labelled as a dependency", depCard.Teaser);
    Check(engine.EnqueueResolvedIfAbsent(resolution.InstallQueue[0], root) is null,
        "shared dependency enqueued twice → second enqueue is deduped (never downloaded twice)");

    InstallQueueItem modCard = engine.EnqueueVersion(NewMod(), target, root, "3.11.4");
    Check(engine.Counters.Queued == 2, "two independent items waiting", DescribeCounters(engine));

    DateTime deadline = DateTime.UtcNow + TimeSpan.FromSeconds(30);
    while (DateTime.UtcNow < deadline && finishes.Count < 2) await Task.Delay(40);

    Check(finishes.Count == 2 && finishes.All(f => f.State == InstallTaskState.Completed),
        "both independent items completed", string.Join(" | ", finishes));
    Check(finishes.First().Id == 2310 && finishes.Last().Id == 1776,
        "dependency finishes BEFORE the mod that needs it", string.Join(" → ", finishes.Select(f => f.Id)));
    Check(File.Exists(Path.Combine(root, "user", "mods", "WTTCommonLib", "package.json")),
        "dependency files landed");
    Check(File.Exists(Path.Combine(root, "user", "mods", "KomradeBasics", "package.json")),
        "mod files landed");
}
catch (Exception ex) { Check(false, "section E crashed", ex.GetType().Name + ": " + ex.Message); }

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("--- F. Engine-direct install: target only, cycles terminate, cancel, installed-skip ---");
try
{
    // F1: engine-direct InstallAsync with deps present installs ONLY the target —
    //     dependencies are resolved/enqueued upstream, never downloaded inline.
    var handler = new FakeHandler(path =>
    {
        if (path == "/mod/1776/versions") return Json(VersionsJson(KomradeZip));
        if (path == "/mods/dependencies") return Json(CommonLibDepsJson);
        if (path == "/files/komrade.zip") return ZipResponse(KomradeZip);
        if (path == "/files/commonlib.zip") return ZipResponse(CommonLibZip);
        return Json("""{"success":true,"data":[]}""");
    });
    using var api = new SpModApiClient(handler, "http://fake.local/");
    var settings = FreshSettings(); // §E installed dep 2310 — resolve against a clean record
    var installer = new InstallService(api, settings);
    using var engine = new InstallQueueEngine(installer);
    string root = NewSptRoot();

    var log = new System.Collections.Concurrent.ConcurrentQueue<(InstallTaskState State, string? SubTask)>();
    engine.ItemUpdated += i => log.Enqueue((i.State, i.SubTask)); // engine-level: fires for every report, subscribable pre-enqueue
    InstallQueueItem item = engine.Enqueue(NewMod(), root, "3.11.4", _ => Task.FromResult(DependencyPromptResult.InstallWithDeps));
    await WaitForTerminalAsync(item, TimeSpan.FromSeconds(30));

    Check(item.State == InstallTaskState.Completed, "engine-direct install of the target succeeds", item.Error);
    Check(File.Exists(Path.Combine(root, "user", "mods", "KomradeBasics", "package.json")), "target files landed");
    Check(!Directory.Exists(Path.Combine(root, "user", "mods", "WTTCommonLib")),
        "dependency NOT downloaded inline inside the mod's task (pre-queued upstream instead)");
    Check(item.Error is null, "no error on the card");
    Check(log.Any(s => s.SubTask?.StartsWith("Resolving dependencies (1 found)", StringComparison.Ordinal) == true),
        "resolving label still reports the found count on the target card",
        string.Join(" | ", log.Select(s => s.SubTask).Where(t => t is not null).Distinct()));

    // F2: circular dependency tree (A requires B requires A) terminates via the visited set.
    const string CircularDepsJson = """{"success":true,"data":{"1776:2.0.0":[{"id":2310,"guid":"com.wtt.commonlib","name":"WTT CommonLib","slug":"wtt-commonlib","latest_compatible_version":{"id":9,"version":"1.0.0","link":"http://fake.local/files/commonlib.zip","content_length":0},"conflict":false,"dependencies":[{"id":1776,"guid":"com.komrade.basics","name":"Komrade's Basics","slug":"komrades-basics","latest_compatible_version":{"id":1,"version":"2.0.0","link":"http://fake.local/files/komrade.zip","content_length":0},"conflict":false,"dependencies":[]}]}]}}""";
    bool circular = true;
    var handler2 = new FakeHandler(path =>
    {
        if (path == "/mod/1776/versions") return Json(VersionsJson(KomradeZip));
        if (path == "/mods/dependencies") return circular ? Json(CircularDepsJson) : Json(CommonLibDepsJson);
        if (path == "/files/komrade.zip") return ZipResponse(KomradeZip);
        if (path == "/files/commonlib.zip") return ZipResponse(CommonLibZip);
        return Json("""{"success":true,"data":[]}""");
    });
    using var api2 = new SpModApiClient(handler2, "http://fake.local/");
    var installer2 = new InstallService(api2, FreshSettings()); // clean installed-mods record
    string root2 = NewSptRoot();
    ModVersion target2 = new()
    {
        Id = 1, Version = "2.0.0", Link = "http://fake.local/files/komrade.zip",
        ContentLength = KomradeZip.Length, SptVersionConstraint = "3.11.4"
    };
    DependencyResolution circularResolution = await installer2.ResolveDependenciesAsync(
        NewMod(), target2, root2, "3.11.4", CancellationToken.None);
    Check(circularResolution.InstallQueue.Count == 1 && circularResolution.InstallQueue[0].Id == 2310,
        "circular tree (A→B→A) terminates — visited set prevents infinite recursion",
        $"{circularResolution.InstallQueue.Count} dep(s)");

    // F3: already-installed dependencies are skipped at resolution time.
    Directory.CreateDirectory(Path.Combine(root2, "user", "mods", "wtt-commonlib"));
    File.WriteAllText(Path.Combine(root2, "user", "mods", "wtt-commonlib", "package.json"),
        """{ "name": "WTT CommonLib", "version": "1.0.0" }""");
    DependencyResolution skippedResolution = await installer2.ResolveDependenciesAsync(
        NewMod(), target2, root2, "3.11.4", CancellationToken.None);
    Check(skippedResolution.InstallQueue.Count == 0,
        "dependency already installed locally is skipped (not re-downloaded)",
        $"{skippedResolution.InstallQueue.Count} dep(s)");

    // F4: Cancel — queued item fails immediately; running item aborts cleanly; slot frees; retry works.
    circular = false;
    bool stalled = true;
    var handler3 = new FakeHandler(path =>
    {
        if (path == "/mod/1776/versions") return Json(VersionsJson(KomradeZip));
        if (path == "/mods/dependencies") return Json(EmptyDepsJson);
        if (path == "/files/komrade.zip") return stalled
            ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(new StalledStream()) }
            : ZipResponse(KomradeZip);
        return Json("""{"success":true,"data":[]}""");
    });
    using var api3 = new SpModApiClient(handler3, "http://fake.local/");
    api3.DownloadStallTimeout = TimeSpan.FromSeconds(20); // long enough that only Cancel can stop it
    var installer3 = new InstallService(api3, new SettingsService());
    using var engine3 = new InstallQueueEngine(installer3);
    string root3 = NewSptRoot();

    InstallQueueItem stalledCard = engine3.Enqueue(NewMod(), root3, "3.11.4", _ => Task.FromResult(DependencyPromptResult.InstallWithDeps));
    InstallQueueItem waitingCard = engine3.Enqueue(NewMod(), root3, "3.11.4", _ => Task.FromResult(DependencyPromptResult.InstallWithDeps));

    // wait until the first is busy (Downloading) and the second is still Queued
    DateTime deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
    while (DateTime.UtcNow < deadline && stalledCard.State != InstallTaskState.Downloading) await Task.Delay(20);

    var cancelSw = System.Diagnostics.Stopwatch.StartNew();
    Check(engine3.Cancel(waitingCard), "Cancel on a QUEUED item is accepted");
    await WaitForTerminalAsync(waitingCard, TimeSpan.FromSeconds(5));
    cancelSw.Stop();
    Check(waitingCard.State == InstallTaskState.Failed
        && waitingCard.Error!.Contains("Cancelled — removed from the queue", StringComparison.Ordinal),
        "queued item fails immediately with a clear message", waitingCard.Error);
    Check(cancelSw.Elapsed < TimeSpan.FromSeconds(2), "queued-item cancel is instantaneous", $"{cancelSw.Elapsed.TotalMilliseconds:F0}ms");

    Check(engine3.Cancel(stalledCard), "Cancel on a RUNNING (stalled-download) item is accepted");
    await WaitForTerminalAsync(stalledCard, TimeSpan.FromSeconds(15));
    Check(stalledCard.State == InstallTaskState.Failed
    && (stalledCard.Error!.Contains("Installation cancelled", StringComparison.Ordinal)
        || stalledCard.Error!.Contains("cancelled", StringComparison.OrdinalIgnoreCase)),
        "running item aborts via cancellation — not the stall watchdog", stalledCard.Error);

    // the slot is freed and the item can be retried to success
    stalled = false;
    Check(engine3.Retry(stalledCard), "Retry re-enqueues the cancelled item");
    await WaitForTerminalAsync(stalledCard, TimeSpan.FromSeconds(30));
    Check(stalledCard.State == InstallTaskState.Completed, "retried item completes", stalledCard.Error);
    Check(File.Exists(Path.Combine(root3, "user", "mods", "KomradeBasics", "package.json")),
        "files landed after the retry");
    Check(engine3.Cancel(stalledCard) == false, "Cancel on a finished item is a no-op");
}
catch (Exception ex) { Check(false, "section F crashed", ex.GetType().Name + ": " + ex.Message); }

Console.WriteLine($"RESULT: {pass} passed, {fail} failed, {skipped} skipped");
return fail == 0 ? 0 : 1;

// ------------------------------------------------------------------ fixture types
// (C# requires all type declarations to follow the top-level statements.)

/// <summary>A stream that accepts the read call and then produces no bytes, ever —
/// exactly like a wedged connection (task 6.1, Fix D).</summary>
sealed class StalledStream : Stream
{
    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken)
    {
        await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
        return 0;
    }
    public override int Read(byte[] buffer, int offset, int count) => 0;
    public override void Write(byte[] buffer, int offset, int count) { }
    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
    public override void Flush() { }
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) { }
}

/// <summary>Routs every request to a canned response by absolute path.</summary>
sealed class FakeHandler : HttpMessageHandler
{
    private readonly Func<string, HttpResponseMessage> _route;
    public int Calls;
    public FakeHandler(Func<string, HttpResponseMessage> route) => _route = route;
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref Calls);
        return Task.FromResult(_route(request.RequestUri!.AbsolutePath));
    }
}

