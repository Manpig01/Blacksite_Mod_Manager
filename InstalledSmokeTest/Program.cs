using System.IO;
using System.Net.Http;
using System.Text;
using Blacksite.Models;
using Blacksite.Services;
using Blacksite.ViewModels;

// =====================================================================================
// Live smoke test #2 — Installed Mods manager: archive engine (zip/rar/7z/HTML),
// layout planning, disk scanner (package.json + [BepInPlugin] PE metadata),
// enable/disable/uninstall file ops, and the live /mods/updates check + 1-click update.
// All operations run on real files and the real sp-mod.com API.
// =====================================================================================

int failures = 0, passed = 0;
void Check(bool condition, string label, string? detail = null)
{
    Console.WriteLine((condition ? "  PASS  " : "  FAIL  ") + label + (detail is null ? "" : $"  [{detail}]"));
    if (condition) passed++; else failures++;
}

// Hermetic harness: sections A-E run entirely from tests/fixtures (copied next to the test
// binary). Live-network sections F-H are OPT-IN via BLACKSITE_LIVE_TESTS=1 and are skipped otherwise.
bool live = Environment.GetEnvironmentVariable("BLACKSITE_LIVE_TESTS") == "1";
int skipped = 0;
void Skip(string label)
{
    skipped++;
    Console.WriteLine("  [SKIP] " + label);
}
string Fixture(string name) => Path.Combine(AppContext.BaseDirectory, "fixtures", name);

string sandbox = Path.Combine(Path.GetTempPath(), "dd-smoke2");
if (Directory.Exists(sandbox)) { ArchiveExtractor.DeleteDirectoryRobust(sandbox); }
Directory.CreateDirectory(sandbox);
string R(string name) { string p = Path.Combine(sandbox, name); Directory.CreateDirectory(p); return p; }

Console.WriteLine("== A. Batched WPF collection updates ==");
try
{
    var range = new ObservableRangeCollection<int>();
    int notifications = 0;
    range.CollectionChanged += (_, _) => notifications++;
    range.ReplaceRange(Enumerable.Range(0, 1000));
    Check(range.Count == 1000 && notifications == 1,
        "replacing 1,000 bound items raises one collection Reset", $"count={range.Count}, notifications={notifications}");
}
catch (Exception ex) { Check(false, "batched collection section crashed", ex.GetType().Name + ": " + ex.Message); }

Console.WriteLine("== A. Archive format detection (real downloaded files) ==");
try
{
Check(ArchiveExtractor.Detect(Fixture("medatt.zip")) == ArchiveKind.Zip, "medatt.zip → Zip");
Check(ArchiveExtractor.Detect(Fixture("biggerstash.zip")) == ArchiveKind.Zip, "biggerstash → Zip (site re-packaged the former RAR)");
Check(ArchiveExtractor.Detect(Fixture("voicepatcher.rar")) == ArchiveKind.Rar, "wtt-voice-patcher → Rar (v5)");
Check(ArchiveExtractor.Detect(Fixture("freecam.zip")) == ArchiveKind.SevenZip, "freecam → SevenZip");
Check(ArchiveExtractor.Detect(Fixture("realism.zip")) == ArchiveKind.Html, "dead-link realism download → Html (checked-in fixture)");
}
catch (Exception ex) { Check(false, "section A crashed", ex.GetType().Name + ": " + ex.Message); }

Console.WriteLine("== B. Layout analysis (wrappers, backslashes, payloads) ==");
try
{
    var medatt = ArchiveExtractor.Analyze(Fixture("medatt.zip"), ArchiveKind.Zip);
    Check(medatt.HasRootStructuredEntries && medatt.HasWrappedEntries && !medatt.HasPayloadEntries,
        "medatt: root-structured + SPT/ wrapper stripped", medatt.ToString());

    var commonlib = ArchiveExtractor.Analyze(Fixture("commonlib.zip"), ArchiveKind.Zip);
    Check(commonlib.HasRootStructuredEntries && commonlib.HasWrappedEntries && !commonlib.HasPayloadEntries,
        "commonlib: backslash paths normalized + wrapper", commonlib.ToString());

    var svm = ArchiveExtractor.Analyze(Fixture("svm-synthetic.zip"), ArchiveKind.Zip);
    Check(svm.HasRootStructuredEntries && svm.HasPayloadEntries && svm.PayloadTopFolder is null,
        "svm: wrapper structure + loose Greed.exe payload (synthetic structural stand-in, see FIXTURES.md)", svm.ToString());

    var scavcat = ArchiveExtractor.Analyze(Fixture("31.zip"), ArchiveKind.Zip);
    Check(!scavcat.HasRootStructuredEntries && scavcat.PayloadTopFolder == "ScavCat" && !scavcat.PayloadLooksClient,
        "scavcat: bare payload folder, server-classified (data/ marker)", scavcat.ToString());
}
catch (Exception ex) { Check(false, "section B crashed", ex.GetType().Name + ": " + ex.Message); }

Console.WriteLine("== C. Smart extraction placement (incl. RAR5 + 7z via SharpCompress) ==");
string rootC1 = R("c1-medatt"), rootC2 = R("c2-commonlib"), rootC3 = R("c3-scavcat"), rootC4 = R("c4-freecam7z"), rootC5 = R("c5-voicepatcher-rar");
try
{
    await ArchiveExtractor.ExtractSmartAsync(Fixture("medatt.zip"), ArchiveKind.Zip, rootC1);
    Check(File.Exists(Path.Combine(rootC1, "BepInEx/plugins/MedicalAttention-Client.dll")), "medatt → BepInEx/plugins client dll");
    Check(File.Exists(Path.Combine(rootC1, "user/mods/MedicalAttention/MedicalAttention-Server.dll")), "medatt → user/mods server part (SPT_Runtime/ wrapper stripped)");

    await ArchiveExtractor.ExtractSmartAsync(Fixture("commonlib.zip"), ArchiveKind.Zip, rootC2);
    Check(File.Exists(Path.Combine(rootC2, "BepInEx/plugins/WTT-ClientCommonLib/WTT-ClientCommonLib.dll")), "commonlib backslash entries → correct dirs");
    Check(File.Exists(Path.Combine(rootC2, "user/mods/WTT-ServerCommonLib/WTT-ServerCommonLib.dll")), "commonlib wrapper → user/mods");

    // catalog-install path: bare payload must be routed to user/mods by classification
    await InstallService.ExtractDownloadedArchiveAsync(Fixture("31.zip"), rootC3, "Scav Cat Trader Mod");
    Check(File.Exists(Path.Combine(rootC3, "user/mods/ScavCat/ScavCat.dll")), "scavcat payload → user/mods/ScavCat (not root!)");
    Check(!Directory.Exists(Path.Combine(rootC3, "ScavCat")), "no stray payload folder at SPT root");

    var kind7z = ArchiveExtractor.Detect(Fixture("freecam.zip"));
    await ArchiveExtractor.ExtractSmartAsync(Fixture("freecam.zip"), kind7z, rootC4);
    int c4Files = Directory.GetFiles(rootC4, "*", SearchOption.AllDirectories).Length;
    Check(c4Files > 0, "freecam 7z extracted via SharpCompress", $"{c4Files} files");
    foreach (string f in Directory.GetFiles(rootC4, "*", SearchOption.AllDirectories).Take(6))
        Console.WriteLine("        " + Path.GetRelativePath(rootC4, f));

    var kindRar = ArchiveExtractor.Detect(Fixture("voicepatcher.rar"));
    await ArchiveExtractor.ExtractSmartAsync(Fixture("voicepatcher.rar"), kindRar, rootC5);
    int c5Files = Directory.GetFiles(rootC5, "*", SearchOption.AllDirectories).Length;
    Check(c5Files > 0, "wtt-voice-patcher RAR5 extracted via SharpCompress", $"{c5Files} files");
    Check(File.Exists(Path.Combine(rootC5, "BepInEx/plugins/WTT-VoicePatcher.dll")), "RAR5 wrapper → BepInEx/plugins placement");
    foreach (string f in Directory.GetFiles(rootC5, "*", SearchOption.AllDirectories).Take(6))
        Console.WriteLine("        " + Path.GetRelativePath(rootC5, f));
}
catch (Exception ex) { Check(false, "section C crashed", ex.GetType().Name + ": " + ex.Message); }

Console.WriteLine("== D. Local scanner on a realistic SPT tree ==");
string root = R("spt-root");
List<InstalledModInfo> scanned = new();
try
{
    // assemble a realistic tree from the real archives
    Directory.CreateDirectory(Path.Combine(root, "user", "mods"));
    Directory.CreateDirectory(Path.Combine(root, "BepInEx", "plugins"));
    await ArchiveExtractor.ExtractSmartAsync(Fixture("medatt.zip"), ArchiveKind.Zip, root);
    await ArchiveExtractor.ExtractSmartAsync(Fixture("qe.zip"), ArchiveKind.Zip, root);

    // freecam (client plugin) into BepInEx/plugins — copy whatever the 7z produced
    foreach (string dir in Directory.GetDirectories(rootC4, "*", SearchOption.AllDirectories))
        Console.WriteLine("        freecam7z dir: " + Path.GetRelativePath(rootC4, dir));
    string freecamPluginsSrc = Path.Combine(rootC4, "BepInEx", "plugins");
    if (Directory.Exists(freecamPluginsSrc))
        ArchiveExtractor.CopyDirectoryMerge(freecamPluginsSrc, Path.Combine(root, "BepInEx", "plugins"));
    else
    {
        // payload-style 7z: copy the produced user/mods-style payload into plugins for the client test
        foreach (string d in Directory.GetDirectories(rootC4))
            ArchiveExtractor.CopyDirectoryMerge(d, Path.Combine(root, "BepInEx", "plugins", Path.GetFileName(d)));
    }

    // synthetic server mod with a REAL SPT-style package.json
    string pkgDir = Path.Combine(root, "user", "mods", "TestPkgMod");
    Directory.CreateDirectory(pkgDir);
    File.WriteAllText(Path.Combine(pkgDir, "package.json"), """
    {
      "name": "com.test.pkgmod",
      "version": "1.2.3",
      "sptVersion": "4.0.12",
      "loadOn": "spt",
      "main": "TestPkgMod.dll",
      "author": "Tester",
      "description": "synthetic scanner probe"
    }
    """);
    File.WriteAllText(Path.Combine(pkgDir, "TestPkgMod.dll"), "not-a-real-dll");

    // Exercise the selective UTF-8 scanner path for authors supplied as strings and objects.
    string authorsDir = Path.Combine(root, "user", "mods", "AuthorsArrayMod");
    Directory.CreateDirectory(authorsDir);
    File.WriteAllText(Path.Combine(authorsDir, "package.json"), """
    { "name": "com.test.authors", "version": 2.5, "authors": ["Alice", {"name":"Bob"}, {"username":"Cy"}] }
    """);

    // disabled server mod + loose legacy script + fake SPT core folder
    string disDir = Path.Combine(root, "user", "mods", "DisabledExample.disabled");
    Directory.CreateDirectory(disDir);
    File.WriteAllText(Path.Combine(disDir, "package.json"), """{"name":"com.test.disabled","version":"0.9.0"}""");
    File.WriteAllText(Path.Combine(root, "user", "mods", "legacy-script.js"), "// legacy");
    Directory.CreateDirectory(Path.Combine(root, "BepInEx", "plugins", "spt"));
    File.WriteAllText(Path.Combine(root, "BepInEx", "plugins", "spt", "SPT.Core.dll"), "core");

    // synthetic SVM at an OLD version (package.json guid the update API knows)
    string svmDir = Path.Combine(root, "user", "mods", "SvmServer");
    Directory.CreateDirectory(svmDir);
    File.WriteAllText(Path.Combine(svmDir, "package.json"), """
    { "name": "fika.ghostfenixx.svm", "version": "2.0.0", "sptVersion": "4.0.12", "main": "ServerValueModifier.dll", "author": "SVN" }
    """);
    File.WriteAllText(Path.Combine(svmDir, "ServerValueModifier.dll"), "old-placeholder");

    scanned = new LocalModScanner().Scan(root);
    foreach (InstalledModInfo m in scanned)
        Console.WriteLine($"        [{m.Kind,-6}] {(m.IsDisabled ? "OFF" : "on ")} {m.DisplayName,-34} id={m.PackageId ?? "—",-28} v={m.Version ?? "—",-10} src={m.InfoSource}");

    Check(scanned.Any(m => m.PackageId == "com.test.pkgmod" && m.Version == "1.2.3" && m.Authors == "Tester"
        && m.MainEntry == "TestPkgMod.dll" && m.SptVersionHint == "4.0.12" && !m.IsDisabled && m.InfoSource == "package.json"),
        "package.json parsed (id/version/author/main/sptVersion)");
    Check(scanned.Any(m => m.PackageId == "com.test.authors" && m.Version == "2.5" && m.Authors == "Alice, Bob, Cy"),
        "Utf8JsonReader handles numeric versions and string/object authors arrays");
    Check(scanned.Any(m => m.DisplayName == "DisabledExample" && m.IsDisabled && m.Kind == InstalledModKind.Server),
        "disabled server mod detected (.disabled suffix)");
    Check(scanned.Any(m => m.DisplayName == "legacy-script" && !m.IsDirectory), "loose legacy .js script detected");
    Check(!scanned.Any(m => m.DisplayName.Equals("spt", StringComparison.OrdinalIgnoreCase)), "SPT core folder excluded from client scan");
    Check(scanned.Any(m => m.Kind == InstalledModKind.Server && m.DisplayName == "MedicalAttention"), "MedicalAttention server part detected");
    Check(scanned.Any(m => m.Kind == InstalledModKind.Client &&
                           (m.PackageId?.Contains("questsextended", StringComparison.OrdinalIgnoreCase) ?? false)),
        "QuestsExtended client part detected via [BepInPlugin]");
    var freecamRow = scanned.FirstOrDefault(m => m.PackageId == "com.terkoiz.freecam");
    Check(freecamRow is not null, "freecam detected via [BepInPlugin] PE metadata", freecamRow is null ? "not found" : $"v{freecamRow.Version} src={freecamRow.InfoSource}");
}
catch (Exception ex) { Check(false, "section D crashed", ex.GetType().Name + ": " + ex.Message); }

Console.WriteLine("== E. Enable/disable + uninstall (real renames/deletes) ==");
try
{
    var svc = new InstalledModsService(null!, new SettingsService());
    var pkg = scanned.First(m => m.PackageId == "com.test.pkgmod");
    svc.SetEnabled(pkg, enable: false);
    Check(Directory.Exists(Path.Combine(root, "user", "mods", "TestPkgMod.disabled")) &&
          !Directory.Exists(Path.Combine(root, "user", "mods", "TestPkgMod")),
        "disable → folder renamed to TestPkgMod.disabled");

    var rescanned = new LocalModScanner().Scan(root);
    Check(rescanned.Any(m => m.PackageId == "com.test.pkgmod" && m.IsDisabled), "rescan reports it disabled");

    svc.SetEnabled(rescanned.First(m => m.PackageId == "com.test.pkgmod"), enable: true);
    Check(Directory.Exists(Path.Combine(root, "user", "mods", "TestPkgMod")), "enable → renamed back");

    svc.Uninstall(rescanned.First(m => m.DisplayName == "legacy-script"));
    Check(!File.Exists(Path.Combine(root, "user", "mods", "legacy-script.js")), "uninstall loose script → file deleted");

    svc.Uninstall(rescanned.First(m => m.DisplayName == "DisabledExample"));
    Check(!Directory.Exists(Path.Combine(root, "user", "mods", "DisabledExample.disabled")), "uninstall disabled folder → recursively deleted");

    bool threw = false;
    try { svc.Uninstall(new InstalledModInfo { Kind = InstalledModKind.Server, InstallPath = "/etc", IsDirectory = true, ParentDirectory = root, DisplayName = "evil", IsDisabled = false, InfoSource = "x" }); }
    catch (UnauthorizedAccessException) { threw = true; }
    Check(threw, "uninstall refuses paths outside user\\mods / BepInEx\\plugins");
}
catch (Exception ex) { Check(false, "section E crashed", ex.GetType().Name + ": " + ex.Message); }

Console.WriteLine("== F. Live update check via GET /mods/updates ==");
using var api = new SpModApiClient(); // constructing the client performs no network I/O
UpdateCheckOutcome? svmOutcome = null;
if (!live) { Skip("F queries the live /mods/updates endpoint (opt in with BLACKSITE_LIVE_TESTS=1)"); }
else
try
{
    var svc = new InstalledModsService(api, new SettingsService());
    var current = new LocalModScanner().Scan(root);
    var svm = current.First(m => m.PackageId == "fika.ghostfenixx.svm");
    var unknown = current.First(m => m.PackageId == "com.test.pkgmod");

    var outcomes = await svc.CheckUpdatesAsync(
        new[] { (svm, "fika.ghostfenixx.svm"), (unknown, "com.test.pkgmod") },
        "4.0.12", CancellationToken.None);

    Check(outcomes.TryGetValue(svm.IdentityKey, out svmOutcome) && svmOutcome.Status == UpdateStatus.UpdateAvailable,
        "SVM 2.0.0 flagged as update available", svmOutcome is null ? "no outcome" : $"→ v{svmOutcome.NewVersion} reason={svmOutcome.Reason}");
    Check(svmOutcome is { Link: not null, CatalogModId: 236 }, "recommended download link + catalog id returned", svmOutcome?.Link);
    Check(!outcomes.ContainsKey(unknown.IdentityKey), "unknown local mod → no false update");
}
catch (Exception ex) { Check(false, "section F crashed", ex.GetType().Name + ": " + ex.Message); }

Console.WriteLine("== G. Live 1-click update (real 5.7 MB download + staged replace) ==");
if (!live) { Skip("G performs a real mod download + staged replace (opt in with BLACKSITE_LIVE_TESTS=1)"); }
else if (svmOutcome is null) { Skip("G skipped: section F did not produce an update outcome"); }
else
try
{
    var svc = new InstalledModsService(api, new SettingsService());
    var current = new LocalModScanner().Scan(root);
    var svm = current.First(m => m.PackageId == "fika.ghostfenixx.svm");
    string oldDir = svm.InstallPath;

    var progress = new Progress<InstallProgress>(p => Console.WriteLine($"        [{p.Stage}] {p.StatusText} {p.SpeedText}"));
    var result = await svc.UpdateAsync(svm, svmOutcome!.Link!, svmOutcome.ContentLength, root, progress, CancellationToken.None, svmOutcome.NewVersion,
        catalogModId: svmOutcome.CatalogModId, releaseId: svmOutcome.ReleaseId);

    Check(result.Success, "update pipeline succeeded", result.Message);
    Check(string.Equals(result.VerifiedVersion, svmOutcome.NewVersion, StringComparison.Ordinal),
        "verified version read back from the destination after the LIVE update",
        result.VerifiedVersion is null ? "null" : $"v{result.VerifiedVersion}");
    if (svmOutcome.CatalogModId is int liveSvmId)
    {
        var afterRecord = new SettingsService();
        Check(afterRecord.Settings.InstalledMods.TryGetValue(liveSvmId, out Blacksite.Services.InstalledModRecord? liveRec) &&
              string.Equals(liveRec.Version, svmOutcome.NewVersion, StringComparison.Ordinal),
            "LIVE update persisted to the tracking record (survives restart)",
            afterRecord.Settings.InstalledMods.TryGetValue(liveSvmId, out Blacksite.Services.InstalledModRecord? liveRec2)
                ? $"record v{liveRec2.Version}" : "no record");
    }
    Check(!File.Exists(Path.Combine(oldDir, "package.json")) && !File.Exists(Path.Combine(oldDir, "ServerValueModifier.dll")),
        "old versioned files removed (no stale package.json/placeholder dll)");
    Check(File.Exists(Path.Combine(root, "user/mods/[SVM] Server Value Modifier/ServerValueModifier.dll")),
        "new server files merged into user/mods (wrapper stripped)");
    string newDll = Path.Combine(root, "user/mods/[SVM] Server Value Modifier/ServerValueModifier.dll");
    byte[] dllHead = new byte[2];
    using (var fs = File.OpenRead(newDll)) fs.ReadExactly(dllHead);
    Check(new FileInfo(newDll).Length > 100_000 && dllHead[0] == 'M' && dllHead[1] == 'Z',
        "updated DLL is the real new PE build", $"{new FileInfo(newDll).Length:N0} bytes");
    var after = new LocalModScanner().Scan(root);
    Check(!after.Any(m => m.PackageId == "fika.ghostfenixx.svm" && m.Version == "2.0.0"), "scanner no longer reports the old version");
    foreach (string f in Directory.GetFiles(Path.Combine(root, "user", "mods"), "*", SearchOption.AllDirectories).Take(10))
        Console.WriteLine("        user/mods: " + Path.GetRelativePath(root, f));
}
catch (Exception ex) { Check(false, "section G crashed", ex.GetType().Name + ": " + ex.Message); }

Console.WriteLine("== H. Dead-link download rejected with a clear error ==");
if (!live) { Skip("H downloads from a live dead-link URL (opt in with BLACKSITE_LIVE_TESTS=1)"); }
else
try
{
    var svc = new InstalledModsService(api, new SettingsService());
    var current = new LocalModScanner().Scan(root);
    var target = current.First(m => m.PackageId == "com.test.pkgmod");
    var result = await svc.UpdateAsync(target, "https://sp-mod.com/mod/download/416/spt-realism-mod/0.14.11", null, root,
        new Progress<InstallProgress>(), CancellationToken.None);
    Check(!result.Success && result.Message.Contains("web page"), "HTML response detected, install untouched", result.Message);
    Check(Directory.Exists(target.InstallPath), "existing mod directory untouched after failed update");
}
catch (Exception ex) { Check(false, "section H crashed", ex.GetType().Name + ": " + ex.Message); }

// =====================================================================================
// I. Update persistence — the "outdated again after restart" bug. Hermetic: loopback HTTP
//    for the real download pipeline, XDG-isolated settings.json. Reproduces the reported
//    scenario end-to-end: mod installed at v2.0.0 (disk + tracking record), a 1-click update
//    downloads v3.0.0 and replaces the files, then the app "restarts" — a fresh
//    SettingsService reads the same settings.json and the Browse card rebuilds from the
//    persisted InstalledMods record. The badge must NOT come back as outdated.
// =====================================================================================
Console.WriteLine("== I. Update persists the installed version across a restart ==");
try
{
    string settingsDirI = R("i-settings");
    Environment.SetEnvironmentVariable("XDG_CONFIG_HOME", settingsDirI);
    var settingsI = new SettingsService(); // also becomes SettingsService.Instance (last ctor wins)

    string rootI = R("i-spt");
    string svmDirI = Path.Combine(rootI, "user", "mods", "svm-synthetic");
    Directory.CreateDirectory(svmDirI);
    await File.WriteAllTextAsync(Path.Combine(svmDirI, "package.json"),
        "{\"name\":\"ServerValueModifier\",\"guid\":\"fika.ghostfenixx.svm\",\"version\":\"2.0.0\"}");
    await File.WriteAllTextAsync(Path.Combine(svmDirI, "old-stale.txt"), "stale 2.0.0 leftover");
    settingsI.RecordInstall(97, "Synthetic SVM", "2.0.0"); // what the fresh-install path recorded

    // The v3.0.0 update archive: real zip bytes, SPT wrapper layout, same mod guid.
    string updateZipI = Path.Combine(sandbox, "i-update.zip");
    await using (var ms = new MemoryStream())
    {
        using (var zip = new System.IO.Compression.ZipArchive(ms, System.IO.Compression.ZipArchiveMode.Create, leaveOpen: true))
        {
            System.IO.Compression.ZipArchiveEntry pkg = zip.CreateEntry("SPT/user/mods/svm-synthetic/package.json");
            using (var w = new StreamWriter(pkg.Open()))
                await w.WriteAsync("{\"name\":\"ServerValueModifier\",\"guid\":\"fika.ghostfenixx.svm\",\"version\":\"3.0.0\"}");
            System.IO.Compression.ZipArchiveEntry fresh = zip.CreateEntry("SPT/user/mods/svm-synthetic/new-file.txt");
            using (var w = new StreamWriter(fresh.Open()))
                await w.WriteAsync("fresh 3.0.0 content");
        }
        await File.WriteAllBytesAsync(updateZipI, ms.ToArray());
    }
    long updateSizeI = new FileInfo(updateZipI).Length;

    // Loopback HTTP server — the real SpModApiClient download path against real HTTP, no external network.
    System.Net.HttpListener? listenerI = null;
    for (int bindAttempt = 0; bindAttempt < 12 && listenerI is null; bindAttempt++)
    {
        try
        {
            var candidate = new System.Net.HttpListener();
            candidate.Prefixes.Add($"http://127.0.0.1:{Random.Shared.Next(20000, 40000)}/");
            candidate.Start();
            listenerI = candidate;
        }
        catch (System.Net.HttpListenerException) { }
    }
    Check(listenerI is not null, "loopback download server started");
    if (listenerI is not null)
    {
        byte[] updateBytesI = await File.ReadAllBytesAsync(updateZipI);
        var serveI = Task.Run(async () =>
        {
            while (listenerI.IsListening)
            {
                try
                {
                    var ctx = await listenerI.GetContextAsync();
                    ctx.Response.ContentType = "application/zip";
                    ctx.Response.ContentLength64 = updateBytesI.Length;
                    await ctx.Response.OutputStream.WriteAsync(updateBytesI);
                    ctx.Response.Close();
                }
                catch (Exception) when (!listenerI.IsListening) { break; }
                catch (ObjectDisposedException) { break; }
            }
        });
        try
        {
            string urlI = listenerI.Prefixes.First() + "svm-update.zip";
            var svcI = new InstalledModsService(new SpModApiClient(), settingsI);
            var beforeI = new LocalModScanner().Scan(rootI);
            var svmRowI = beforeI.First(m => m.InstallPath.EndsWith("svm-synthetic", StringComparison.OrdinalIgnoreCase));
            var resultI = await svcI.UpdateAsync(svmRowI, urlI, updateSizeI, rootI,
                new Progress<InstallProgress>(), CancellationToken.None, "3.0.0",
                catalogModId: 97, releaseId: 222);

            Check(resultI.Success, "1-click update succeeds (download + staged replace)", resultI.Message);
            Check(!File.Exists(Path.Combine(svmDirI, "old-stale.txt")),
                "stale 2.0.0 files do not survive the replace");
            string diskPkgI = await File.ReadAllTextAsync(Path.Combine(svmDirI, "package.json"));
            Check(diskPkgI.Contains("3.0.0"), "on-disk package.json is the new 3.0.0 build");

            // ---- RESTART SIMULATION ------------------------------------------------------
            // A fresh SettingsService reading the same settings.json = the next app launch.
            // The Browse tab rebuilds its cards from the persisted InstalledMods record
            // (MainViewModel: fresh.InstalledVersion = record.Version).
            var restartedI = new SettingsService();
            bool hasRecordI = restartedI.Settings.InstalledMods.TryGetValue(97, out Blacksite.Services.InstalledModRecord? recordI);
            Check(hasRecordI && string.Equals(recordI?.Version, "3.0.0", StringComparison.Ordinal),
                "RESTART: tracked version persisted as 3.0.0 (badge must not say outdated)",
                hasRecordI ? $"record still says v{recordI?.Version}" : "no record for mod 97");
            Check(hasRecordI && !string.Equals(recordI?.Version, "2.0.0", StringComparison.Ordinal),
                "RESTART: recorded version is not the stale 2.0.0",
                hasRecordI ? $"record says v{recordI?.Version}" : "no record for mod 97");
            Check(string.Equals(resultI.VerifiedVersion, "3.0.0", StringComparison.Ordinal),
                "verified version read back from the destination package.json",
                resultI.VerifiedVersion is null ? "null" : $"v{resultI.VerifiedVersion}");
            Check(hasRecordI && recordI?.ReleaseId == 222,
                "Forge release id persisted with the install record",
                hasRecordI ? $"releaseId={recordI?.ReleaseId}" : "no record");

            Check(Directory.GetDirectories(rootI, "bs-staging-old-*").Length == 0,
                "no bs-staging-old-* aside residue in the SPT root after the update");

            // ---- SELF-HEAL: a record left stale by an older build (the exact state this bug
            //      left real users in) corrects itself from the disk on the next scan.
            settingsI.Settings.InstalledMods[97].Version = "1.0.0"; // simulate the pre-fix damage
            settingsI.Save();
            List<InstalledModInfo> scannedI = new LocalModScanner().Scan(rootI);
            var catalogBridgeI = new Mod { Id = 97, Guid = "fika.ghostfenixx.svm", Slug = "svm-synthetic" };
            List<(int ModId, string Version)> healedI = svcI.ReconcileInstallRecordsWithDisk(
                scannedI, id => id == 97 ? catalogBridgeI : null);
            Check(healedI.Any(h => h.ModId == 97 && string.Equals(h.Version, "3.0.0", StringComparison.Ordinal)),
                "stale record self-heals to the on-disk package.json version",
                string.Join(", ", healedI.Select(h => $"#{h.ModId} → v{h.Version}")));
            var healedReadI = new SettingsService();
            Check(healedReadI.Settings.InstalledMods.TryGetValue(97, out Blacksite.Services.InstalledModRecord? rec2I) &&
                  string.Equals(rec2I.Version, "3.0.0", StringComparison.Ordinal),
                "healed record persisted (fresh settings read = next app launch)");
        }
        finally
        {
            listenerI.Stop();
            try { await serveI; } catch { }
        }
    }
}
catch (Exception ex) { Check(false, "section I crashed", ex.GetType().Name + ": " + ex.Message); }

// =====================================================================================
// J. Client+Server component consolidation — the "two cards for one mod" bug. A mod with
//    both a server part (user\mods\Tyfon.WeaponCustomizer.Server) and a client part
//    (BepInEx\plugins\Tyfon.WeaponCustomizer) must render as ONE card. Grouping key: the
//    Forge catalog mod id when known; otherwise a fuzzy author/name match that strips
//    .server/.client component suffixes. Uninstall/Disable must hit ALL component paths.
// =====================================================================================
Console.WriteLine("== J. Client+Server components consolidate into one card ==");
try
{
    // ---- J1: real dual-component install (medatt.zip carries user/mods + BepInEx/plugins).
    string rootJ = R("j-spt");
    Directory.CreateDirectory(Path.Combine(rootJ, "user", "mods"));
    Directory.CreateDirectory(Path.Combine(rootJ, "BepInEx", "plugins"));
    await ArchiveExtractor.ExtractArchiveWithProgressAsync(Fixture("medatt.zip"), rootJ, new Progress<double>());
    List<InstalledModInfo> rawJ = new LocalModScanner().Scan(rootJ);
    int rawServerJ = rawJ.Count(r => r.Kind == InstalledModKind.Server);
    int rawClientJ = rawJ.Count(r => r.Kind == InstalledModKind.Client);
    Check(rawServerJ >= 1 && rawClientJ >= 1,
        "raw scan still reports server and client components separately (the disk truth)",
        $"server={rawServerJ}, client={rawClientJ}");

    List<InstalledModInfo> mergedJ = InstalledModsService.ConsolidateComponents(rawJ, _ => 42);
    Check(mergedJ.Count == 1,
        "catalog-bridge: dual-component install consolidates to ONE card", $"{mergedJ.Count} cards");
    if (mergedJ.Count == 1)
    {
        InstalledModInfo m = mergedJ[0];
        Check(m.HasServerMod && m.HasClientPlugin, "merged card carries both component flags");
        Check(m.ServerPath is not null && m.ServerPath.Contains("mods") && Directory.Exists(m.ServerPath),
            "merged card exposes the server path", m.ServerPath ?? "null");
        Check(m.ClientPath is not null && m.ClientPath.Contains("plugins") && (Directory.Exists(m.ClientPath) || File.Exists(m.ClientPath)),
            "merged card exposes the client path", m.ClientPath ?? "null");
        Check(m.Components is { Count: >= 2 }, "merged card lists every component",
            m.Components?.Count.ToString() ?? "null");
    }

    // ---- J2: the reported Tyfon shape, UNMANAGED (no catalog match) → fuzzy author/name merge.
    string rootJ2 = R("j2-spt");
    string serverDirJ2 = Path.Combine(rootJ2, "user", "mods", "Tyfon.WeaponCustomizer.Server");
    Directory.CreateDirectory(serverDirJ2);
    await File.WriteAllTextAsync(Path.Combine(serverDirJ2, "package.json"),
        "{\"name\":\"Tyfon.WeaponCustomizer.Server\",\"version\":\"1.2.0\",\"author\":\"Tyfon\"}");
    string clientDirJ2 = Path.Combine(rootJ2, "BepInEx", "plugins", "Tyfon.WeaponCustomizer");
    Directory.CreateDirectory(clientDirJ2);
    await File.WriteAllTextAsync(Path.Combine(clientDirJ2, "manifest.json"),
        "{\"name\":\"WeaponCustomizer\",\"namespace\":\"Tyfon\",\"version_number\":\"1.2.0\"}");
    await File.WriteAllTextAsync(Path.Combine(clientDirJ2, "Tyfon.WeaponCustomizer.dll"), "not a real dll");
    List<InstalledModInfo> rawJ2 = new LocalModScanner().Scan(rootJ2);
    Check(rawJ2.Count == 2, "Tyfon shape scans as two raw components", $"{rawJ2.Count} rows");

    List<InstalledModInfo> mergedJ2 = InstalledModsService.ConsolidateComponents(rawJ2);
    Check(mergedJ2.Count == 1,
        "fuzzy: Tyfon.WeaponCustomizer + Tyfon.WeaponCustomizer.Server merge to ONE card (no catalog needed)",
        $"{mergedJ2.Count} cards");
    if (mergedJ2.Count == 1)
    {
        InstalledModInfo m2 = mergedJ2[0];
        Check(m2.HasServerMod && m2.HasClientPlugin, "fuzzy merged card carries both component flags");
        Check(string.Equals(m2.PackageId, "Tyfon.WeaponCustomizer.Server", StringComparison.Ordinal),
            "primary component is the server half (identity + version carrier)", m2.PackageId ?? "null");
        Check(m2.ServerPath == serverDirJ2 && m2.ClientPath == clientDirJ2,
            "fuzzy merged card exposes both exact paths");
    }

    // ---- J3: no false merges — unrelated mods stay separate.
    string rootJ3 = R("j3-spt");
    foreach (string rel in new[] { Path.Combine("user", "mods", "Foo"), Path.Combine("user", "mods", "Bar"),
                                   Path.Combine("BepInEx", "plugins", "Baz") })
        Directory.CreateDirectory(Path.Combine(rootJ3, rel));
    List<InstalledModInfo> mergedJ3 = InstalledModsService.ConsolidateComponents(new LocalModScanner().Scan(rootJ3));
    Check(mergedJ3.Count == 3, "unrelated mods never merge", $"{mergedJ3.Count} cards");

    // ---- J4: same-kind lookalikes stay separate (only cross-kind components merge without a catalog id).
    string rootJ4 = R("j4-spt");
    foreach (string rel in new[] { Path.Combine("user", "mods", "Tyfon.WeaponCustomizer"),
                                   Path.Combine("user", "mods", "Tyfon.WeaponCustomizer.Server") })
    {
        Directory.CreateDirectory(Path.Combine(rootJ4, rel));
        await File.WriteAllTextAsync(Path.Combine(rootJ4, rel, "package.json"),
            "{\"name\":\"" + Path.GetFileName(rel) + "\",\"version\":\"1.0.0\"}");
    }
    List<InstalledModInfo> mergedJ4 = InstalledModsService.ConsolidateComponents(new LocalModScanner().Scan(rootJ4));
    Check(mergedJ4.Count == 2, "two same-kind mods with similar names stay separate", $"{mergedJ4.Count} cards");

    // ---- J5: actions on a consolidated card hit EVERY component path.
    var svcJ = new InstalledModsService(null!, new SettingsService());
    InstalledModInfo? cardJ2 = InstalledModsService.ConsolidateComponents(new LocalModScanner().Scan(rootJ2)).FirstOrDefault();
    if (cardJ2 is null) { Check(false, "J5 needs the merged Tyfon card"); }
    else
    {
        svcJ.SetEnabled(cardJ2, false);
        Check(Directory.Exists(serverDirJ2 + ".disabled") && Directory.Exists(clientDirJ2 + ".disabled"),
            "Disable renames BOTH component folders to .disabled");

        // Like the app, a fresh scan runs between toggles — SetEnabled operates on current rows.
        InstalledModInfo? disabledCardJ2 = InstalledModsService.ConsolidateComponents(new LocalModScanner().Scan(rootJ2)).FirstOrDefault();
        if (disabledCardJ2 is null) { Check(false, "J5 rescan after disable found no card"); }
        else
        {
            Check(disabledCardJ2.IsDisabled, "merged card reports disabled only when EVERY component is disabled");
            svcJ.SetEnabled(disabledCardJ2, true);
            Check(Directory.Exists(serverDirJ2) && Directory.Exists(clientDirJ2),
                "Enable restores BOTH component folders");

            InstalledModInfo? enabledCardJ2 = InstalledModsService.ConsolidateComponents(new LocalModScanner().Scan(rootJ2)).FirstOrDefault();
            if (enabledCardJ2 is null) { Check(false, "J5 rescan after enable found no card"); }
            else
            {
                svcJ.Uninstall(enabledCardJ2);
                Check(!Directory.Exists(serverDirJ2) && !Directory.Exists(clientDirJ2),
                    "Uninstall removes BOTH component folders");
            }
        }
    }
}
catch (Exception ex) { Check(false, "section J crashed", ex.GetType().Name + ": " + ex.Message); }

// =====================================================================================
// K. Update-button arbitration — the false "Update" on up-to-date mods. Version strings
//    must be NORMALIZED (strip "v" prefixes, prerelease suffixes) before comparison, and
//    the Update verdict must require Parsed(ForgeVersion) > Parsed(LocalVersion) strictly.
// =====================================================================================
Console.WriteLine("== K. Update verdicts use semantic version comparison, not raw strings ==");
try
{
    InstalledModInfo LocalRow(string version) => new InstalledModInfo
    {
        Kind = InstalledModKind.Server,
        InstallPath = Path.Combine("x", "Tyfon.WeaponCustomizer.Server"),
        IsDirectory = true,
        ParentDirectory = "x",
        DisplayName = "Tyfon.WeaponCustomizer.Server",
        PackageId = "Tyfon.WeaponCustomizer.Server",
        Version = version,
        IsDisabled = false,
        InfoSource = "package.json"
    };

    async Task<(Dictionary<string, UpdateCheckOutcome> Outcomes, string SentUrl)> CheckUpdatesAsync(
        string localVersion, string recommendedVersion, string list)
    {
        var handler = new FakeUpdatesHandler(recommendedVersion, list);
        var api = new SpModApiClient(handler, "https://sp-mod.com/api/v0/");
        var outcomes = await new InstalledModsService(api, new SettingsService())
            .CheckUpdatesAsync(new List<(InstalledModInfo, string)> { (LocalRow(localVersion), "Tyfon.WeaponCustomizer.Server") },
                "4.1.5", CancellationToken.None);
        return (outcomes, handler.LastUrl ?? "");
    }

    // K1: "v4.1.0" local vs "v4.1.0" recommended — SAME version, different formatting → NOT an update.
    var (k1, _) = await CheckUpdatesAsync("v4.1.0", "v4.1.0", "updates");
    Check(k1.TryGetValue("Server:tyfon.weaponcustomizer.server", out UpdateCheckOutcome? o1) && o1.Status == UpdateStatus.UpToDate,
        "v4.1.0 local vs v4.1.0 forge → Up to date (no false Update button)",
        o1 is null ? "no outcome" : o1.Status.ToString());

    // K2: the version SENT to the API is normalized ("4.1.0", not "v4.1.0").
    var (_, sentUrl) = await CheckUpdatesAsync("v4.1.0", "4.1.1", "updates");
    Check(sentUrl.Contains("mods=Tyfon.WeaponCustomizer.Server%3A4.1.0", StringComparison.Ordinal),
        "normalized version string is sent to the update API", sentUrl);

    // K3: a genuinely newer recommended version still IS an update.
    var (k3, _) = await CheckUpdatesAsync("v4.1.0", "4.1.1", "updates");
    Check(k3.TryGetValue("Server:tyfon.weaponcustomizer.server", out UpdateCheckOutcome? o3) && o3.Status == UpdateStatus.UpdateAvailable,
        "v4.1.0 local vs 4.1.1 forge → Update available (strictly greater)",
        o3 is null ? "no outcome" : o3.Status.ToString());

    // K4: prerelease-style suffixes on the local version must not create false updates.
    var (k4, _) = await CheckUpdatesAsync("4.1.0-release", "4.1.0", "updates");
    Check(k4.TryGetValue("Server:tyfon.weaponcustomizer.server", out UpdateCheckOutcome? o4) && o4.Status == UpdateStatus.UpToDate,
        "4.1.0-release local vs 4.1.0 forge → Up to date (suffix stripped)",
        o4 is null ? "no outcome" : o4.Status.ToString());

    // K5: the parser itself — prefixes, prereleases, garbage.
    Check(SemVersion.TryParse("v4.1.0", out SemVersion? v5) && v5 is not null && v5.Major == 4 && v5.Minor == 1 && v5.Patch == 0,
        "SemVersion parses 'v4.1.0' (leading v stripped)");
    Check(SemVersion.TryParse("4.1.0-beta.1", out SemVersion? v5b) && v5b?.Prerelease == "beta.1",
        "SemVersion keeps genuine prerelease tags");
    Check(SemVersion.TryParse("v4.1.0", out SemVersion? a5) && SemVersion.TryParse("4.1.0-release", out SemVersion? b5)
          && a5 is not null && b5 is not null && a5.CompareCoreTo(b5) == 0,
        "core comparison ignores prefixes and release suffixes");
    Check(!SemVersion.TryParse("not-a-version", out _),
        "non-version strings still fail to parse");

    // K6: the server's own up_to_date verdict is preserved.
    var (k6, _) = await CheckUpdatesAsync("4.1.0", "4.1.0", "up_to_date");
    Check(k6.TryGetValue("Server:tyfon.weaponcustomizer.server", out UpdateCheckOutcome? o6) && o6.Status == UpdateStatus.UpToDate,
        "server-reported up_to_date stays UpToDate", o6 is null ? "no outcome" : o6.Status.ToString());
}
catch (Exception ex) { Check(false, "section K crashed", ex.GetType().Name + ": " + ex.Message); }

// =====================================================================================
// L. The definitive false-⬆-Update-button characterization: the button must require a
//    STRICTLY NEWER PARSED remote version — equal, older, or unparseable remote versions
//    must never show it, no matter what the server verdict or a stale outcome says.
// =====================================================================================
Console.WriteLine("== L. Update button requires a strictly newer parsed version ==");
try
{
    InstalledModInfo RowL(string version) => new InstalledModInfo
    {
        Kind = InstalledModKind.Server,
        InstallPath = Path.Combine("x", "Tyfon.WeaponCustomizer.Server"),
        IsDirectory = true,
        ParentDirectory = "x",
        DisplayName = "Tyfon.WeaponCustomizer.Server",
        PackageId = "Tyfon.WeaponCustomizer.Server",
        Version = version,
        IsDisabled = false,
        InfoSource = "package.json"
    };

    // ---- L1 (service): an unparseable recommended version ("4.1.0 RC2") must not flag an
    //      update — the server's string matching cannot be trusted with author formatting drift.
    var l1Handler = new FakeUpdatesHandler("4.1.0 RC2", "updates");
    var l1Api = new SpModApiClient(l1Handler, "https://sp-mod.com/api/v0/");
    var l1 = await new InstalledModsService(l1Api, new SettingsService())
        .CheckUpdatesAsync(new List<(InstalledModInfo, string)> { (RowL("4.1.0"), "Tyfon.WeaponCustomizer.Server") },
            "4.1.5", CancellationToken.None);
    Check(l1.TryGetValue("Server:tyfon.weaponcustomizer.server", out UpdateCheckOutcome? l1o) && l1o.Status != UpdateStatus.UpdateAvailable,
        "service: unparseable recommended version never flags an update",
        l1o is null ? "no outcome" : l1o.Status.ToString());

    // ---- L3 (view model): the ⬆ Update button itself — HasUpdate — is the last line of
    //      defense and must demand a strictly greater PARSED version.
    InstalledModViewModel VmL(string localVersion) => new(RowL(localVersion),
        _ => Task.CompletedTask, _ => Task.CompletedTask, _ => Task.CompletedTask);

    var vmEqual = VmL("4.1.0");
    vmEqual.Outcome = new UpdateCheckOutcome { Status = UpdateStatus.UpdateAvailable, NewVersion = "4.1.0", Link = "https://example.com/u.zip" };
    Check(!vmEqual.HasUpdate, "VM: UpdateAvailable outcome + EQUAL version hides the button (the reported bug)",
        $"HasUpdate={vmEqual.HasUpdate}");
    Check(!vmEqual.CanUpdateNow, "VM: equal version disables the update command");
    Check(!vmEqual.HasUpdate && vmEqual.UpdateBadgeText.Contains("Up to date", StringComparison.Ordinal),
        "VM: equal version badge reads Up to date, not Update available", vmEqual.UpdateBadgeText);

    var vmReal = VmL("4.1.0");
    vmReal.Outcome = new UpdateCheckOutcome { Status = UpdateStatus.UpdateAvailable, NewVersion = "4.1.1", Link = "https://example.com/u.zip" };
    Check(vmReal.HasUpdate && vmReal.CanUpdateNow, "VM: a strictly newer version still shows + enables the button");

    var vmJunk = VmL("4.1.0");
    vmJunk.Outcome = new UpdateCheckOutcome { Status = UpdateStatus.UpdateAvailable, NewVersion = "4.1.0 RC2", Link = "https://example.com/u.zip" };
    Check(!vmJunk.HasUpdate, "VM: unparseable remote version hides the button", $"HasUpdate={vmJunk.HasUpdate}");

    var vmPrefixed = VmL("v4.1.0");
    vmPrefixed.Outcome = new UpdateCheckOutcome { Status = UpdateStatus.UpdateAvailable, NewVersion = "4.1.0", Link = "https://example.com/u.zip" };
    Check(!vmPrefixed.HasUpdate, "VM: 'v'-prefixed local vs unprefixed remote (equal) hides the button", $"HasUpdate={vmPrefixed.HasUpdate}");

    // ---- L7 (staleness): the mod updates on disk to the recommended version but the outcome
    //      is still the OLD verdict — the button must fall away the moment Info refreshes.
    var vmStale = VmL("4.1.0");
    vmStale.Outcome = new UpdateCheckOutcome { Status = UpdateStatus.UpdateAvailable, NewVersion = "4.1.1", Link = "https://example.com/u.zip" };
    Check(vmStale.HasUpdate, "VM: stale-outcome setup shows the button first");
    vmStale.Update(RowL("4.1.1")); // the post-update rescan delivers the new on-disk version
    Check(!vmStale.HasUpdate, "VM: once the local version catches up, the stale button disappears");

    // ---- VersionUtils: the central sanitizer/parser itself.
    Version? Parsed(string? raw) => VersionUtils.ParseVersion(raw);
    Check(Parsed("v4.1.0") is { } v1 && v1.Major == 4 && v1.Minor == 1 && v1.PatchOrZero() == 0,
        "VersionUtils: 'v4.1.0' → 4.1.0");
    Check(Parsed("v1.2.3") is { } v10 && v10.Major == 1 && v10.Minor == 2 && v10.Build == 0,
        "VersionUtils: 'v1.2.3' parses the numeric core");
    Check(Parsed("1.2.3-beta") is { } v11 && v11.Major == 1 && v11.Minor == 2 && v11.Build == 0,
        "VersionUtils: prerelease suffix ignored");
    Check(Parsed("ver 1.2.3") is { } v12 && v12.Major == 1 && v12.Minor == 2 && v12.Build == 0,
        "VersionUtils: 'ver 1.2.3' prefix accepted");
    Check(Parsed("1.2.3_rc1") is { } v13 && v13.Major == 1 && v13.Minor == 2 && v13.Build == 0,
        "VersionUtils: underscore annotation ignored");
    Check(Parsed("1.2.3") is { } compact && compact.Equals(Parsed("1.2.3.0")),
        "VersionUtils: absent fourth component is normalized to zero");
    Check(Parsed("V 2.5") is { } v2 && v2.Major == 2 && v2.Minor == 5, "VersionUtils: 'V 2.5' → 2.5");
    Check(Parsed("ver-2.5") is { } v3 && v3.Major == 2 && v3.Minor == 5, "VersionUtils: 'ver-2.5' → 2.5");
    Check(Parsed("version 3.0") is { } v4 && v4.Major == 3, "VersionUtils: 'version 3.0' → 3.0");
    Check(Parsed("  4.1.0 ") is { } v5 && v5.Minor == 1, "VersionUtils: surrounding whitespace stripped");
    Check(Parsed("4.1.0-release") is { } v6 && v6.Major == 4 && v6.Minor == 1 && v6.PatchOrZero() == 0,
        "VersionUtils: '-release' suffix ignored");
    Check(Parsed("4.1.0 RC2") is { } v7 && v7.Major == 4 && v7.Minor == 1, "VersionUtils: ' RC2' annotation ignored");
    Check(Parsed("2") is { } v8 && v8.Major == 2 && v8.Minor == 0, "VersionUtils: integer fallback ('2' → 2.0)");
    Check(Parsed("4.1.0+aki-37x") is { } v9 && v9.Minor == 1, "VersionUtils: build metadata ignored");
    Check(Parsed("garbage") is null && Parsed("") is null && Parsed(null) is null && Parsed("latest") is null,
        "VersionUtils: non-version strings parse to null");

    Check(VersionUtils.IsNewer("v4.1.1", "4.1.0"), "IsNewer: strictly greater remote → true");
    Check(!VersionUtils.IsNewer("4.1.0", "v4.1.0"), "IsNewer: equal (differing formatting) → false");
    Check(!VersionUtils.IsNewer("4.1.0", "4.1.0.0"), "IsNewer: equal modulo build precision → false");
    Check(!VersionUtils.IsNewer("4.1.0.0", "4.1.0"), "IsNewer: equal versions with omitted build → false");
    Check(!VersionUtils.IsNewer("1.2.3-beta", "v1.2.3"), "IsNewer: prerelease annotation alone → false");
    Check(!VersionUtils.IsNewer("4.1.0 RC2", "4.1.0"), "IsNewer: annotation-only difference → false");
    Check(!VersionUtils.IsNewer("4.0.9", "4.1"), "IsNewer: older remote → false");
    Check(!VersionUtils.IsNewer(null, "1.0"), "IsNewer: missing remote → false");
    Check(!VersionUtils.IsNewer("1.0", null), "IsNewer: missing local → false");
    Check(VersionUtils.IsNewer("v2", "1.9.9"), "IsNewer: integer remote works");
}
catch (Exception ex) { Check(false, "section L crashed", ex.GetType().Name + ": " + ex.Message); }

try { ArchiveExtractor.DeleteDirectoryRobust(sandbox); } catch { }
Console.WriteLine();
Console.WriteLine(failures == 0
    ? (skipped == 0 ? "ALL INSTALLED-MODS SMOKE TESTS PASSED ✔" : $"ALL RUN INSTALLED-MODS TESTS PASSED ✔ ({skipped} SKIPPED — live sections are opt-in via BLACKSITE_LIVE_TESTS=1)")
    : $"{failures} TEST(S) FAILED ✘ ({skipped} skipped)");
Console.WriteLine($"RESULT: {passed} passed, {failures} failed, {skipped} skipped");
return failures == 0 ? 0 : 1;

internal static class VersionTestExtensions
{
    public static int PatchOrZero(this Version v) => v.Build < 0 ? 0 : v.Build;
}

/// <summary>Fake API pipeline for the update-check section: records the request URL and serves
/// a canned /mods/updates response that lists the mod under "updates" or "up_to_date".</summary>
sealed class FakeUpdatesHandler : HttpMessageHandler
{
    private readonly string _recommendedVersion;
    private readonly string _list;
    public string? LastUrl { get; private set; }

    public FakeUpdatesHandler(string recommendedVersion, string list)
    {
        _recommendedVersion = recommendedVersion;
        _list = list;
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        LastUrl = request.RequestUri?.ToString() ?? "";
        string guid = "Tyfon.WeaponCustomizer.Server";
        string entry = _list == "updates"
            ? "{\"updates\":[{\"current_version\":{\"guid\":\"" + guid + "\"},\"recommended_version\":{\"id\":5,\"version\":\"" + _recommendedVersion + "\",\"link\":\"https://example.com/u.zip\"}}],\"up_to_date\":[],\"blocked_updates\":[],\"incompatible_with_spt\":[]}"
            : "{\"updates\":[],\"up_to_date\":[{\"id\":1,\"mod_id\":null,\"guid\":\"" + guid + "\",\"name\":null,\"slug\":null,\"version\":\"" + _recommendedVersion + "\"}],\"blocked_updates\":[],\"incompatible_with_spt\":[]}";
        string body = "{\"success\":true,\"data\":" + entry + "}";
        var response = new HttpResponseMessage(System.Net.HttpStatusCode.OK)
        {
            Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json")
        };
        return Task.FromResult(response);
    }
}
