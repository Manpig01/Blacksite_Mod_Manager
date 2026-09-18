using System.IO;
using System.Text;
using Blacksite.Models;
using Blacksite.Services;

// =====================================================================================
// Live smoke test #2 — Installed Mods manager: archive engine (zip/rar/7z/HTML),
// layout planning, disk scanner (package.json + [BepInPlugin] PE metadata),
// enable/disable/uninstall file ops, and the live /mods/updates check + 1-click update.
// All operations run on real files and the real sp-mod.com API.
// =====================================================================================

int failures = 0;
void Check(bool condition, string label, string? detail = null)
{
    Console.WriteLine((condition ? "  PASS  " : "  FAIL  ") + label + (detail is null ? "" : $"  [{detail}]"));
    if (!condition) failures++;
}

string sandbox = Path.Combine(Path.GetTempPath(), "dd-smoke2");
if (Directory.Exists(sandbox)) { ArchiveExtractor.DeleteDirectoryRobust(sandbox); }
Directory.CreateDirectory(sandbox);
string R(string name) { string p = Path.Combine(sandbox, name); Directory.CreateDirectory(p); return p; }

Console.WriteLine("== A. Archive format detection (real downloaded files) ==");
Check(ArchiveExtractor.Detect("/tmp/medatt.zip") == ArchiveKind.Zip, "medatt.zip → Zip");
Check(ArchiveExtractor.Detect("/tmp/biggerstash.zip") == ArchiveKind.Zip, "biggerstash → Zip (site re-packaged the former RAR)");
Check(ArchiveExtractor.Detect("/tmp/voicepatcher.rar") == ArchiveKind.Rar, "wtt-voice-patcher → Rar (v5)");
Check(ArchiveExtractor.Detect("/tmp/freecam.zip") == ArchiveKind.SevenZip, "freecam → SevenZip");
Check(ArchiveExtractor.Detect("/tmp/realism.zip") == ArchiveKind.Html, "dead-link realism download → Html");

Console.WriteLine("== B. Layout analysis (wrappers, backslashes, payloads) ==");
{
    var medatt = ArchiveExtractor.Analyze("/tmp/medatt.zip", ArchiveKind.Zip);
    Check(medatt.HasRootStructuredEntries && medatt.HasWrappedEntries && !medatt.HasPayloadEntries,
        "medatt: root-structured + SPT/ wrapper stripped", medatt.ToString());

    var commonlib = ArchiveExtractor.Analyze("/tmp/commonlib.zip", ArchiveKind.Zip);
    Check(commonlib.HasRootStructuredEntries && commonlib.HasWrappedEntries && !commonlib.HasPayloadEntries,
        "commonlib: backslash paths normalized + wrapper", commonlib.ToString());

    var svm = ArchiveExtractor.Analyze("/tmp/svm.zip", ArchiveKind.Zip);
    Check(svm.HasRootStructuredEntries && svm.HasPayloadEntries && svm.PayloadTopFolder is null,
        "svm: wrapper structure + loose Greed.exe payload", svm.ToString());

    var scavcat = ArchiveExtractor.Analyze("/tmp/31.zip", ArchiveKind.Zip);
    Check(!scavcat.HasRootStructuredEntries && scavcat.PayloadTopFolder == "ScavCat" && !scavcat.PayloadLooksClient,
        "scavcat: bare payload folder, server-classified (data/ marker)", scavcat.ToString());
}

Console.WriteLine("== C. Smart extraction placement (incl. RAR5 + 7z via SharpCompress) ==");
string rootC1 = R("c1-medatt"), rootC2 = R("c2-commonlib"), rootC3 = R("c3-scavcat"), rootC4 = R("c4-freecam7z"), rootC5 = R("c5-voicepatcher-rar");
{
    await ArchiveExtractor.ExtractSmartAsync("/tmp/medatt.zip", ArchiveKind.Zip, rootC1);
    Check(File.Exists(Path.Combine(rootC1, "BepInEx/plugins/MedicalAttention-Client.dll")), "medatt → BepInEx/plugins client dll");
    Check(File.Exists(Path.Combine(rootC1, "user/mods/MedicalAttention/MedicalAttention-Server.dll")), "medatt → user/mods server part (SPT_Runtime/ wrapper stripped)");

    await ArchiveExtractor.ExtractSmartAsync("/tmp/commonlib.zip", ArchiveKind.Zip, rootC2);
    Check(File.Exists(Path.Combine(rootC2, "BepInEx/plugins/WTT-ClientCommonLib/WTT-ClientCommonLib.dll")), "commonlib backslash entries → correct dirs");
    Check(File.Exists(Path.Combine(rootC2, "user/mods/WTT-ServerCommonLib/WTT-ServerCommonLib.dll")), "commonlib wrapper → user/mods");

    // catalog-install path: bare payload must be routed to user/mods by classification
    await InstallService.ExtractDownloadedArchiveAsync("/tmp/31.zip", rootC3, "Scav Cat Trader Mod");
    Check(File.Exists(Path.Combine(rootC3, "user/mods/ScavCat/ScavCat.dll")), "scavcat payload → user/mods/ScavCat (not root!)");
    Check(!Directory.Exists(Path.Combine(rootC3, "ScavCat")), "no stray payload folder at SPT root");

    var kind7z = ArchiveExtractor.Detect("/tmp/freecam.zip");
    await ArchiveExtractor.ExtractSmartAsync("/tmp/freecam.zip", kind7z, rootC4);
    int c4Files = Directory.GetFiles(rootC4, "*", SearchOption.AllDirectories).Length;
    Check(c4Files > 0, "freecam 7z extracted via SharpCompress", $"{c4Files} files");
    foreach (string f in Directory.GetFiles(rootC4, "*", SearchOption.AllDirectories).Take(6))
        Console.WriteLine("        " + Path.GetRelativePath(rootC4, f));

    var kindRar = ArchiveExtractor.Detect("/tmp/voicepatcher.rar");
    await ArchiveExtractor.ExtractSmartAsync("/tmp/voicepatcher.rar", kindRar, rootC5);
    int c5Files = Directory.GetFiles(rootC5, "*", SearchOption.AllDirectories).Length;
    Check(c5Files > 0, "wtt-voice-patcher RAR5 extracted via SharpCompress", $"{c5Files} files");
    Check(File.Exists(Path.Combine(rootC5, "BepInEx/plugins/WTT-VoicePatcher.dll")), "RAR5 wrapper → BepInEx/plugins placement");
    foreach (string f in Directory.GetFiles(rootC5, "*", SearchOption.AllDirectories).Take(6))
        Console.WriteLine("        " + Path.GetRelativePath(rootC5, f));
}

Console.WriteLine("== D. Local scanner on a realistic SPT tree ==");
string root = R("spt-root");
List<InstalledModInfo> scanned;
{
    // assemble a realistic tree from the real archives
    Directory.CreateDirectory(Path.Combine(root, "user", "mods"));
    Directory.CreateDirectory(Path.Combine(root, "BepInEx", "plugins"));
    await ArchiveExtractor.ExtractSmartAsync("/tmp/medatt.zip", ArchiveKind.Zip, root);
    await ArchiveExtractor.ExtractSmartAsync("/tmp/qe.zip", ArchiveKind.Zip, root);

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

Console.WriteLine("== E. Enable/disable + uninstall (real renames/deletes) ==");
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

Console.WriteLine("== F. Live update check via GET /mods/updates ==");
using var api = new SpModApiClient();
UpdateCheckOutcome? svmOutcome = null;
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

Console.WriteLine("== G. Live 1-click update (real 5.7 MB download + staged replace) ==");
{
    var svc = new InstalledModsService(api, new SettingsService());
    var current = new LocalModScanner().Scan(root);
    var svm = current.First(m => m.PackageId == "fika.ghostfenixx.svm");
    string oldDir = svm.InstallPath;

    var progress = new Progress<InstallProgress>(p => Console.WriteLine($"        [{p.Stage}] {p.StatusText} {p.SpeedText}"));
    var result = await svc.UpdateAsync(svm, svmOutcome!.Link!, svmOutcome.ContentLength, root, progress, CancellationToken.None, svmOutcome.NewVersion);

    Check(result.Success, "update pipeline succeeded", result.Message);
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

Console.WriteLine("== H. Dead-link download rejected with a clear error ==");
{
    var svc = new InstalledModsService(api, new SettingsService());
    var current = new LocalModScanner().Scan(root);
    var target = current.First(m => m.PackageId == "com.test.pkgmod");
    var result = await svc.UpdateAsync(target, "https://sp-mod.com/mod/download/416/spt-realism-mod/0.14.11", null, root,
        new Progress<InstallProgress>(), CancellationToken.None);
    Check(!result.Success && result.Message.Contains("web page"), "HTML response detected, install untouched", result.Message);
    Check(Directory.Exists(target.InstallPath), "existing mod directory untouched after failed update");
}

try { ArchiveExtractor.DeleteDirectoryRobust(sandbox); } catch { }
Console.WriteLine();
Console.WriteLine(failures == 0 ? "ALL INSTALLED-MODS SMOKE TESTS PASSED ✔" : $"{failures} TEST(S) FAILED ✘");
return failures == 0 ? 0 : 1;
