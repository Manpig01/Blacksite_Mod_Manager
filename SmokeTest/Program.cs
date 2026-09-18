using System.Diagnostics;
using Blacksite.Models;
using Blacksite.Services;

// ============================================================================
// Live end-to-end smoke test of the Blacksite production logic (non-UI part)
// against the real https://sp-mod.com/api/v0 API. Nothing is mocked.
// ============================================================================

int failures = 0;
void Check(bool condition, string label, string? detail = null)
{
    Console.WriteLine((condition ? "  PASS  " : "  FAIL  ") + label + (detail is null ? "" : $"  [{detail}]"));
    if (!condition) failures++;
}

Console.WriteLine("== 1. SemVer / constraint engine ==");
{
    Check(SemVersion.TryParse("1.1.0+aki-37x", out var a) && a is { Major: 1, Minor: 1, Patch: 0 }, "parse 1.1.0+aki-37x");
    Check(SemVersion.TryParse("4.0.12") is not null && SemVersion.TryParse(" 4.0.10 ") is not null, "parse padded versions");
    var v451 = SemVersion.TryParse("4.5.1")!;
    var v450 = SemVersion.TryParse("4.5.0")!;
    Check(v451!.CompareTo(v450) > 0, "4.5.1 > 4.5.0");
    Check(VersionConstraint.Parse("~4.0.12").IsSatisfiedBy(SemVersion.TryParse("4.0.13")!), "~4.0.12 allows 4.0.13");
    Check(!VersionConstraint.Parse("~4.0.12").IsSatisfiedBy(SemVersion.TryParse("4.1.0")!), "~4.0.12 rejects 4.1.0");
    Check(VersionConstraint.Parse(">=4.0.13 <4.1.0").IsSatisfiedBy(SemVersion.TryParse("4.0.13")!), "range allows lower bound");
    Check(!VersionConstraint.Parse(">=4.0.13 <4.1.0").IsSatisfiedBy(SemVersion.TryParse("4.1.0")!), "range rejects upper bound");
    Check(VersionConstraint.Parse("4.1.3").IsSatisfiedBy(SemVersion.TryParse("4.1.3")!), "exact match");
    Check(VersionConstraint.Parse(" 4.0.10 ").IsSatisfiedBy(SemVersion.TryParse("4.0.10")!), "exact match w/ spaces");
    Check(VersionConstraint.Parse("*").IsSatisfiedBy(SemVersion.TryParse("9.9.9")!), "wildcard");
    Check(VersionConstraint.Parse("~3.7.0").IsSatisfiedBy(SemVersion.TryParse("3.7.6")!), "~3.7.0 allows 3.7.6");
}

Console.WriteLine("== 2. Rate limiter behaviour (burst 40/10s) ==");
{
    var limiter = new SlidingWindowRateLimiter();
    var sw = Stopwatch.StartNew();
    for (int i = 0; i < 42; i++) await limiter.WaitAsync();
    sw.Stop();
    // First 40 must pass instantly; requests 41+ must be held ~10s by the burst window.
    Check(sw.ElapsedMilliseconds >= 9_000, "limiter throttles past burst limit", $"{sw.ElapsedMilliseconds} ms for 42 slots");
}

Console.WriteLine("== 3. Live API: health, catalog, versions, dependencies ==");
using var api = new SpModApiClient();
api.Notice += n => Console.WriteLine($"  [api] {n}");
List<Mod>? catalog = null;
{
    var (online, detail) = await api.PingAsync(CancellationToken.None);
    Check(online, "API health probe", detail);

    var cts = new CancellationTokenSource(TimeSpan.FromSeconds(240));
    var progress = new Progress<CatalogProgress>(p => { });
    catalog = await api.GetCatalogAsync(new CatalogFilter(), progress, cts.Token);
    Check(catalog.Count > 1000, "full catalog paged through", $"{catalog.Count} mods");
    var sample = catalog.First(m => m.Id == 31);
    Check(sample.DisplayName == "Scav Cat Trader Mod" && sample.PackageId == "com.donut.scavcat", "mod fields parsed (name/guid)");
    Check(!string.IsNullOrEmpty(sample.Owner?.Name) && !string.IsNullOrEmpty(sample.Thumbnail), "owner + thumbnail parsed", sample.Owner?.Name);

    var versions = await api.GetVersionsAsync(791, CancellationToken.None); // SAIN
    Check(versions.Count > 0, "versions fetched for SAIN (791)", $"{versions.Count} versions");
    var best = VersionSelector.PickBest(versions, "4.1.3");
    Check(best is { CompatibleWithSpt: true } && SemVersion.TryParse(best.Version.Version, out _),
        "best version for SPT 4.1.3 resolved", best is null ? "none" : $"{best.Version.Version} compatible={best.CompatibleWithSpt}");
    Check(!string.IsNullOrEmpty(best!.Version.Link), "download link present", best.Version.Link);

    var deps = await api.GetDependenciesAsync(new[] { (791, best.Version.Version) }, "4.1.3", CancellationToken.None);
    Check(deps.TryGetValue($"791:{best.Version.Version}", out var depList) && depList.Count >= 2,
        "dependency lookup returns SAIN deps (Waypoints, BigBrain)", depList is null ? "missing key" : string.Join(", ", depList.Select(d => d.DisplayName)));
    Check(depList!.Any(d => d.LatestCompatibleVersion?.Link is not null), "dependency has resolvable download link");
}

Console.WriteLine("== 4. Real download + extract pipeline (mod 31, ~43 KB) ==");
{
    string fakeSpt = Path.Combine(Path.GetTempPath(), "dd-smoke-spt");
    Directory.CreateDirectory(Path.Combine(fakeSpt, "BepInEx"));
    Directory.CreateDirectory(Path.Combine(fakeSpt, "user"));

    string zip = Path.Combine(Path.GetTempPath(), "31.zip");
    if (File.Exists(zip)) File.Delete(zip);

    var dp = new Progress<DownloadProgress>(p => { });
    long bytes = await api.DownloadFileAsync("https://sp-mod.com/mod/download/31/scav-cat-trader-mod/1.0.8", zip, dp, CancellationToken.None);
    Check(bytes > 1000 && new FileInfo(zip).Length == bytes, "archive streamed to %TEMP%/31.zip", $"{bytes:N0} bytes");
    byte[] magic = new byte[2];
    using (var fs = File.OpenRead(zip)) fs.ReadExactly(magic);
    Check(magic[0] == 'P' && magic[1] == 'K', "file is a genuine ZIP (PK header)");

    InstallService.ExtractArchive(zip, fakeSpt);
    var extracted = Directory.GetFileSystemEntries(fakeSpt, "*", SearchOption.AllDirectories)
        .Where(p => !p.EndsWith("/BepInEx") && !p.EndsWith("/user")).ToList();
    Check(extracted.Count > 0, "extraction merged archive into SPT root", $"{extracted.Count} entries; e.g. {Path.GetRelativePath(fakeSpt, extracted.First())}");

    // second extract with overwrite must not throw (merge path, incl. read-only entries)
    InstallService.ExtractArchive(zip, fakeSpt);
    Check(true, "overwrite/merge re-extract works (read-only hardened path)");

    File.Delete(zip);
    Check(!File.Exists(zip), "temp zip cleaned up");
    Directory.Delete(fakeSpt, true);
}

Console.WriteLine("== 5. Full InstallService pipeline against live API (mod 147 → fake SPT root) ==");
{
    string fakeSpt = Path.Combine(Path.GetTempPath(), "dd-smoke-spt2");
    Directory.CreateDirectory(Path.Combine(fakeSpt, "BepInEx", "plugins"));
    Directory.CreateDirectory(Path.Combine(fakeSpt, "user", "mods"));
    Check(InstallService.DirectoryLooksLikeSptRoot(fakeSpt), "SPT root detection");

    var settings = new SettingsService();
    var installer = new InstallService(api, settings);
    var stages = new List<InstallStage>();
    var progress = new Progress<InstallProgress>(p => stages.Add(p.Stage));

    var mod = catalog!.First(m => m.Id == 147); // Medical Attention — small, real
    var result = await installer.InstallAsync(mod, fakeSpt, "4.1.3", progress,
        prompt => Task.FromResult(DependencyPromptResult.InstallWithDeps), CancellationToken.None);

    Check(result.Success, "install pipeline completed", result.Message);
    Check(result.InstalledVersion is not null, "installed version recorded", result.InstalledVersion);
    Check(settings.Settings.InstalledMods.ContainsKey(147), "install persisted to settings");
    Check(!File.Exists(Path.Combine(Path.GetTempPath(), "147.zip")), "temp archive removed after install");
    Check(Directory.GetFileSystemEntries(fakeSpt, "*", SearchOption.AllDirectories).Length > 2, "files merged into SPT root");
    Directory.Delete(fakeSpt, true);
}

Console.WriteLine();
Console.WriteLine(failures == 0 ? "ALL SMOKE TESTS PASSED ✔" : $"{failures} TEST(S) FAILED ✘");
return failures == 0 ? 0 : 1;
