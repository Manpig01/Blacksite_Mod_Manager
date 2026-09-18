// =============================================================================
// Blacksite — Filter & Sort Engine smoke test (v1.2.0)
//
// All checks run against the LIVE sp-mod.com API and a REAL local TCP fixture
// server (no mocks of application logic, no simulated filters):
//
//   A. GET /spt/versions            — live SPT release list for the dropdown
//   B. GET /mod-categories          — live category taxonomy for the dropdown
//   C. GET /mods server-side filters — query=, filter[spt_version]=,
//                                      filter[category_id]=, filter[fika_compatibility]=1,
//                                      sort= (and combinations), via the production client
//   D. Download engine — truncated transfer (RST mid-body) → retry → HTTP Range resume
//   E. Download engine — truncated transfer, server ignores Range → clean restart
//   F. Download engine — pre-existing .part file → resumed from byte N (single request)
//   G. ModFilterEngine — installed-mod text filters, status toggles, column sorts
//   H. SettingsService — SPT version constraint persists to settings.json and reloads
// =============================================================================

using System.Net;
using System.Net.Sockets;
using System.Text;
using Blacksite.Models;
using Blacksite.Services;

// Redirect where SettingsService persists (before any SpecialFolder query).
string settingsRoot = Path.Combine(Path.GetTempPath(), "dd-filter-smoke-" + Guid.NewGuid().ToString("N")[..8]);
Directory.CreateDirectory(settingsRoot);
Environment.SetEnvironmentVariable("XDG_CONFIG_HOME", settingsRoot);

int pass = 0, fail = 0;
void Check(bool ok, string label)
{
    if (ok) { pass++; Console.WriteLine($"  [PASS] {label}"); }
    else { fail++; Console.WriteLine($"  [FAIL] {label}"); }
}

Console.WriteLine("=== Blacksite Filter & Sort Engine smoke test ===");
Console.WriteLine();

// ---------------------------------------------------------------------------
Console.WriteLine("--- A. Live GET /spt/versions (SPT version constraint dropdown) ---");
using (var api = new SpModApiClient())
{
    List<SptVersionInfo> versions = await api.GetSptVersionsAsync(CancellationToken.None);
    Check(versions.Count >= 40, $"live SPT versions returned ({versions.Count} entries)");
    Check(versions.Any(v => v.Version == "4.1.5"), "contains 4.1.5 (newest)");
    Check(versions.Any(v => v.Version == "3.11.4"), "contains 3.11.4");
    Check(versions.Any(v => v.Version == "3.9.0") && versions.Any(v => v.Version == "3.8.0"),
        "contains 3.9.0 and 3.8.0 (spec examples)");
    Check(versions.All(v => SemVersion.TryParse(v.Version, out _)), "every version parses as SemVer");
    Check(versions.All(v => v.ModCount >= 0), "every version carries a mod_count");
    Check(versions.Count == versions.Select(v => v.Version).Distinct().Count(), "versions are unique");
    SptVersionInfo sample = versions.First(v => v.Version == "3.11.4");
    Check(sample.Display.Contains("mods") && sample.ModCount > 300, $"dropdown label has mod count (\"{sample.Display}\")");

    // -----------------------------------------------------------------------
    Console.WriteLine();
    Console.WriteLine("--- B. Live GET /mod-categories (category dropdown) ---");
    List<ModCategoryInfo> categories = await api.GetCategoriesAsync(CancellationToken.None);
    Check(categories.Count >= 15, $"live categories returned ({categories.Count} entries)");
    Check(categories.Any(c => c.Title == "Weapons"), "contains Weapons");
    Check(categories.Any(c => c.Title == "Traders"), "contains Traders");
    Check(categories.Any(c => c.Title.Equals("Tools", StringComparison.OrdinalIgnoreCase)), "contains Tools");
    Check(categories.Select(c => c.Id).Distinct().Count() == categories.Count, "category ids are unique");
    Check(categories.All(c => !string.IsNullOrWhiteSpace(c.Slug)), "every category has a slug");

    int weaponsId = categories.First(c => c.Title == "Weapons").Id;
    int tradersId = categories.First(c => c.Title == "Traders").Id;

    // -----------------------------------------------------------------------
    Console.WriteLine();
    Console.WriteLine("--- C. Server-side catalog filtering (real query parameters) ---");

    // C1: query= — real-time text search (name/author/description)
    List<Mod> waypoints = await api.GetCatalogAsync(
        new CatalogFilter { SearchText = "waypoints", Sort = CatalogSort.MostDownloaded },
        null, CancellationToken.None);
    Check(waypoints.Count is >= 10 and <= 60, $"query=waypoints returned {waypoints.Count} mods");
    Check(waypoints.Count > 0 && waypoints[0].Name!.Contains("Waypoints", StringComparison.OrdinalIgnoreCase),
        $"best match is the Waypoints mod (\"{waypoints[0].Name}\")");

    // C2: query= matches authors too
    List<Mod> drakia = await api.GetCatalogAsync(
        new CatalogFilter { SearchText = "drakia" }, null, CancellationToken.None);
    Check(drakia.Count >= 10, $"query=drakia returned {drakia.Count} mods");
    Check(drakia.Any(m => m.AuthorName.Contains("Drakia", StringComparison.OrdinalIgnoreCase)),
        "author keyword matches mod authors");

    // C3: filter[category_id] + sort=-downloads
    List<Mod> weaponsByDownloads = await api.GetCatalogAsync(
        new CatalogFilter { CategoryId = weaponsId, Sort = CatalogSort.MostDownloaded },
        null, CancellationToken.None);
    Check(weaponsByDownloads.Count is >= 30 and <= 90, $"Weapons category returned {weaponsByDownloads.Count} mods");
    Check(weaponsByDownloads.All(m => m.CategoryId == weaponsId), "every returned mod is in the Weapons category");
    Check(weaponsByDownloads.Select(m => m.Downloads).SequenceEqual(
              weaponsByDownloads.Select(m => m.Downloads).OrderByDescending(d => d)),
        "sort=-downloads returns a non-increasing download order");

    // C4: filter[fika_compatibility]=1 combined with a category
    List<Mod> weaponsFika = await api.GetCatalogAsync(
        new CatalogFilter { CategoryId = weaponsId, FikaOnly = true, Sort = CatalogSort.MostDownloaded },
        null, CancellationToken.None);
    Check(weaponsFika.Count is >= 10 and <= 60, $"Weapons ∩ Fika returned {weaponsFika.Count} mods");
    Check(weaponsFika.All(m => m.FikaCompatibility == true), "every returned mod has fika_compatibility = true");

    // C4b: fika-only across the whole catalog (the checkbox by itself)
    List<Mod> fikaAll = await api.GetCatalogAsync(
        new CatalogFilter { FikaOnly = true, Sort = CatalogSort.MostDownloaded },
        null, CancellationToken.None);
    Check(fikaAll.Count is >= 200 and <= 900, $"fika-only catalog returned {fikaAll.Count} mods");
    Check(fikaAll.All(m => m.FikaCompatibility == true), "fika-only: all mods carry fika_compatibility = true");

    // C5: filter[spt_version] + category + descending name sort
    List<Mod> weapons311 = await api.GetCatalogAsync(
        new CatalogFilter { CategoryId = weaponsId, SptVersion = "3.11.4", Sort = CatalogSort.NameZa },
        null, CancellationToken.None);
    Check(weapons311.Count is >= 5 and <= 40, $"Weapons ∩ SPT 3.11.4 returned {weapons311.Count} mods");
    Check(weapons311.All(m => m.CategoryId == weaponsId), "spt-filtered results keep the category constraint");
    Check(weapons311.Select(m => m.DisplayName).SequenceEqual(
              weapons311.Select(m => m.DisplayName).OrderByDescending(n => n, StringComparer.OrdinalIgnoreCase)),
        "sort=-name returns a descending alphabetical order");

    // C5b: SPT version filter actually narrows the catalog
    List<Mod> spt311 = await api.GetCatalogAsync(
        new CatalogFilter { SptVersion = "3.11.4", Sort = CatalogSort.MostRecent },
        null, CancellationToken.None);
    Check(spt311.Count is >= 300 and <= 900, $"SPT 3.11.4 constraint returned {spt311.Count} mods");
    Check(spt311.Count < 1891, "the SPT constraint narrows the full catalog");
    Check(spt311.All(m => m.PublishedAt is not null || m.CreatedAt is not null),
        "sort=-published_at rows carry publish dates");

    // C6: everything combined + ascending name sort
    List<Mod> combined = await api.GetCatalogAsync(
        new CatalogFilter { SearchText = "trader", CategoryId = tradersId, FikaOnly = true, Sort = CatalogSort.NameAz },
        null, CancellationToken.None);
    Check(combined.Count is >= 2 and <= 30, $"query+category+fika combined returned {combined.Count} mods");
    Check(combined.All(m => m.CategoryId == tradersId && m.FikaCompatibility == true),
        "combined filter keeps every constraint");
    Check(combined.Select(m => m.DisplayName).SequenceEqual(
              combined.Select(m => m.DisplayName).OrderBy(n => n, StringComparer.OrdinalIgnoreCase)),
        "sort=name returns an ascending alphabetical order");

    // C6b: Most Recent sort
    List<Mod> recentTraders = await api.GetCatalogAsync(
        new CatalogFilter { CategoryId = tradersId, Sort = CatalogSort.MostRecent },
        null, CancellationToken.None);
    var publishDates = recentTraders.Select(m => m.PublishedAt ?? m.CreatedAt ?? DateTimeOffset.MinValue).ToList();
    Check(publishDates.SequenceEqual(publishDates.OrderByDescending(d => d)),
        "sort=-published_at returns newest-first across pages");
}

Console.WriteLine();

// ---------------------------------------------------------------------------
Console.WriteLine("--- D/E/F. Download engine: truncated transfers, resume, retry ---");

// 300 KB deterministic payload
byte[] payload = new byte[300_000];
new Random(20260914).NextBytes(payload);

// D: first response is cut mid-body with a TCP reset; retries must RESUME via Range.
using (var server = new TruncatingFixtureServer(payload, honorRange: true, truncateFirstResponseAt: 120_000))
using (var api = new SpModApiClient())
{
    string dest = Path.Combine(Path.GetTempPath(), "dd-smoke-resume.bin");
    long bytes = await api.DownloadFileAsync(server.Url.ToString(), dest, null, CancellationToken.None);
    byte[] onDisk = File.ReadAllBytes(dest);
    Check(bytes == payload.Length, $"truncated transfer completed with {bytes:N0} bytes");
    Check(onDisk.Length == payload.Length && onDisk.SequenceEqual(payload), "resumed file is byte-identical to the payload");
    Check(server.RequestsServed == 2, $"exactly one retry happened (requests: {server.RequestsServed})");
    Check(server.LastRangeFrom is > 0 and < 300_000,
        $"retry resumed via 'Range: bytes={server.LastRangeFrom}-' from the partial data actually retained ({server.LastRangeFrom:N0} bytes on disk)");

    File.Delete(dest);
    File.Delete(dest + ".part");
}

// E: first response truncated; server IGNORES Range on retry → downloader must restart cleanly.
using (var server = new TruncatingFixtureServer(payload, honorRange: false, truncateFirstResponseAt: 90_000))
using (var api = new SpModApiClient())
{
    string dest = Path.Combine(Path.GetTempPath(), "dd-smoke-restart.bin");
    long bytes = await api.DownloadFileAsync(server.Url.ToString(), dest, null, CancellationToken.None);
    byte[] onDisk = File.ReadAllBytes(dest);
    Check(bytes == payload.Length && onDisk.SequenceEqual(payload),
        "range-ignoring server: file still completes byte-identically");
    Check(server.RequestsServed == 2, $"one retry, served as a full 200 (requests: {server.RequestsServed})");

    File.Delete(dest);
    File.Delete(dest + ".part");
}

// F: a .part file left over from a previous run is resumed, not restarted.
using (var server = new TruncatingFixtureServer(payload, honorRange: true, truncateFirstResponseAt: 0))
using (var api = new SpModApiClient())
{
    string dest = Path.Combine(Path.GetTempPath(), "dd-smoke-preseeded.bin");
    string partPath = dest + ".part";
    await File.WriteAllBytesAsync(partPath, payload[..50_000]); // pretend 50 KB were already fetched

    long bytes = await api.DownloadFileAsync(server.Url.ToString(), dest, null, CancellationToken.None);
    Check(bytes == payload.Length && File.ReadAllBytes(dest).SequenceEqual(payload),
        "pre-existing .part resumed to a complete file");
    Check(server.RequestsServed == 1, $"only one request was needed (requests: {server.RequestsServed})");
    Check(server.LastRangeFrom == 50_000, "the single request carried 'Range: bytes=50000-'");
    Check(!File.Exists(partPath), ".part file was moved away on completion");

    File.Delete(dest);
    File.Delete(partPath);
}

Console.WriteLine();

// ---------------------------------------------------------------------------
Console.WriteLine("--- G. Installed-mods filter engine (client-side) ---");

static InstalledModInfo Mk(string name, InstalledModKind kind, bool disabled = false,
    string? version = null, string? pkg = null, string? authors = null) => new()
{
    Kind = kind,
    InstallPath = $"/spt/root/user/mods/{name}",
    IsDirectory = true,
    ParentDirectory = "/spt/root/user/mods",
    DisplayName = name,
    PackageId = pkg,
    Version = version,
    Authors = authors,
    IsDisabled = disabled,
    InfoSource = "test"
};

var rows = new List<InstalledRowData>
{
    new(Mk("Alpha Mod", InstalledModKind.Server, disabled: false, version: "1.2.10", pkg: "com.alpha", authors: "Jehree"),
        new UpdateCheckOutcome { Status = UpdateStatus.UpToDate }),
    new(Mk("Bravo Plugin", InstalledModKind.Client, disabled: true, version: "2.0.0", pkg: "com.bravo", authors: "DrakiaXYZ"),
        new UpdateCheckOutcome { Status = UpdateStatus.UpdateAvailable, NewVersion = "2.1.0" }),
    new(Mk("Charlie Pack", InstalledModKind.Server, disabled: false, version: "0.9.9", pkg: "com.charlie", authors: "DanW"),
        new UpdateCheckOutcome { Status = UpdateStatus.UpdateAvailable, NewVersion = "1.0.0" }),
    new(Mk("Delta Tool", InstalledModKind.Client, disabled: false, version: null, pkg: null, authors: null), null),
    new(Mk("Echo Svr", InstalledModKind.Server, disabled: false, version: "1.10.0", pkg: "com.echo", authors: "MoxoPixel"),
        new UpdateCheckOutcome { Status = UpdateStatus.UpToDate }),
};

// Text filtering: matches package.json names AND author metadata
Check(ModFilterEngine.Apply(rows, new InstalledFilter { SearchText = "bravo" }).Count == 1, "text filter matches mod name");
Check(ModFilterEngine.Apply(rows, new InstalledFilter { SearchText = "drakia" }).Count == 1, "text filter matches author");
Check(ModFilterEngine.Apply(rows, new InstalledFilter { SearchText = "com.echo" }).Count == 1, "text filter matches package id");
Check(ModFilterEngine.Apply(rows, new InstalledFilter { SearchText = "MOD" }).Count == 1, "text filter is case-insensitive");
Check(ModFilterEngine.Apply(rows, new InstalledFilter()).Count == 5, "empty filter keeps everything");

// Status toggles
Check(ModFilterEngine.Apply(rows, new InstalledFilter { HideDisabled = true }).Count == 4, "Hide Disabled removes disabled mods");
Check(ModFilterEngine.Apply(rows, new InstalledFilter { HideDisabled = true })
        .All(r => !r.Info.IsDisabled), "Hide Disabled keeps only active mods");
Check(ModFilterEngine.Apply(rows, new InstalledFilter { HideOutdated = true }).Count == 3, "Hide Out-of-Date removes mods with updates");
Check(ModFilterEngine.Apply(rows, new InstalledFilter { HideOutdated = true })
        .All(r => r.Outcome?.Status != UpdateStatus.UpdateAvailable), "Hide Out-of-Date keeps up-to-date/unknown rows");
Check(ModFilterEngine.Apply(rows, new InstalledFilter { OnlyServer = true }).Count == 3, "Show Only Server Mods");
Check(ModFilterEngine.Apply(rows, new InstalledFilter { OnlyServer = true })
        .All(r => r.Info.Kind == InstalledModKind.Server), "Only Server keeps just server mods");
Check(ModFilterEngine.Apply(rows, new InstalledFilter { OnlyClient = true }).Count == 2, "Show Only Client Plugins");
Check(ModFilterEngine.Apply(rows, new InstalledFilter { OnlyClient = true })
        .All(r => r.Info.Kind == InstalledModKind.Client), "Only Client keeps just client plugins");
Check(ModFilterEngine.Apply(rows, new InstalledFilter { OnlyServer = true, HideOutdated = true }).Count == 2,
    "toggles compose");

// Sorting: name
var sorted = ModFilterEngine.Apply(rows, new InstalledFilter());
ModFilterEngine.Sort(sorted, InstalledSortColumn.Name, SortDirection.Ascending);
Check(sorted.Select(r => r.Info.DisplayName).SequenceEqual(
    sorted.Select(r => r.Info.DisplayName).OrderBy(n => n, StringComparer.OrdinalIgnoreCase)), "sort by Name ascending");
ModFilterEngine.Sort(sorted, InstalledSortColumn.Name, SortDirection.Descending);
Check(sorted.Select(r => r.Info.DisplayName).SequenceEqual(
    sorted.Select(r => r.Info.DisplayName).OrderByDescending(n => n, StringComparer.OrdinalIgnoreCase)), "sort by Name descending");

// Sorting: version (semantic, not lexicographic: 0.9.9 < 1.2.10 < 1.10.0 < unknown-last)
ModFilterEngine.Sort(sorted, InstalledSortColumn.Version, SortDirection.Ascending);
var versionOrder = sorted.Select(r => r.Info.Version ?? "").ToList();
Check(versionOrder[^1] == "" || versionOrder[^1] is null, "unknown version sorts last (ascending)");
Check(versionOrder.IndexOf("0.9.9") < versionOrder.IndexOf("1.2.10"), "0.9.9 before 1.2.10 (ascending)");
Check(versionOrder.IndexOf("1.2.10") < versionOrder.IndexOf("1.10.0"),
    "semver: 1.2.10 < 1.10.0 (minor 10 > 2 — not lexicographic)");

// Sorting: status (Active first) and type (Client before Server, ascending)
ModFilterEngine.Sort(sorted, InstalledSortColumn.Status, SortDirection.Ascending);
Check(sorted.TakeWhile(r => !r.Info.IsDisabled).Count() == 4, "sort by Status puts Active rows first");
ModFilterEngine.Sort(sorted, InstalledSortColumn.Type, SortDirection.Ascending);
Check(sorted.Take(2).All(r => r.Info.Kind == InstalledModKind.Client) &&
      sorted.Skip(2).All(r => r.Info.Kind == InstalledModKind.Server), "sort by Type groups Client before Server");
ModFilterEngine.Sort(sorted, InstalledSortColumn.Type, SortDirection.Descending);
Check(sorted.Take(3).All(r => r.Info.Kind == InstalledModKind.Server), "sort by Type descending flips the order");

Console.WriteLine();

// ---------------------------------------------------------------------------
Console.WriteLine("--- H. Settings persistence (SPT version constraint) ---");
{
    var settings = new SettingsService();
    settings.Settings.SptVersionFilter = "3.11.4";
    settings.Save();

    // A fresh instance (as on next app launch) must see the saved constraint.
    var reloaded = new SettingsService();
    Check(reloaded.Settings.SptVersionFilter == "3.11.4", "SPT version constraint persists between instances");

    reloaded.Settings.SptVersionFilter = null;
    reloaded.Save();
    Check(new SettingsService().Settings.SptVersionFilter is null, "clearing the constraint also persists");
}

// ===========================================================================
Console.WriteLine();
Console.WriteLine($"RESULT: {pass} passed, {fail} failed");
return fail == 0 ? 0 : 1;

// ---------------------------------------------------------------------------
/// <summary>
/// A real TCP/HTTP fixture server (localhost) used ONLY to reproduce hostile network
/// conditions for the download engine: it can cut a response mid-body with a TCP
/// reset (exactly the "Incomplete download: expected N bytes but got N-9" failure)
/// and then either honour or ignore HTTP Range on the retry.
/// </summary>
internal sealed class TruncatingFixtureServer : IDisposable
{
    private readonly byte[] _payload;
    private readonly bool _honorRange;
    private readonly int _truncateFirstResponseAt;
    private readonly TcpListener _listener;

    public Uri Url { get; }
    public int RequestsServed;
    public long LastRangeFrom = -1;

    public TruncatingFixtureServer(byte[] payload, bool honorRange, int truncateFirstResponseAt)
    {
        _payload = payload;
        _honorRange = honorRange;
        _truncateFirstResponseAt = truncateFirstResponseAt;
        _listener = new TcpListener(IPAddress.Loopback, 0);
        _listener.Start();
        Url = new Uri($"http://127.0.0.1:{((IPEndPoint)_listener.LocalEndpoint).Port}/mod-file.bin");
        _ = Task.Run(AcceptLoopAsync);
    }

    private async Task AcceptLoopAsync()
    {
        try
        {
            while (true)
            {
                TcpClient client = await _listener.AcceptTcpClientAsync();
                _ = Task.Run(() => HandleClientAsync(client));
            }
        }
        catch (ObjectDisposedException) { }
    }

    private async Task HandleClientAsync(TcpClient client)
    {
        try
        {
            client.ReceiveTimeout = 10_000;
            client.SendTimeout = 10_000;
            using NetworkStream stream = client.GetStream();

            // Read the request head (request line + headers).
            var buffer = new byte[8192];
            var head = new StringBuilder();
            while (!head.ToString().Contains("\r\n\r\n", StringComparison.Ordinal))
            {
                int n = await stream.ReadAsync(buffer).ConfigureAwait(false);
                if (n <= 0) return;
                head.Append(Encoding.ASCII.GetString(buffer, 0, n));
            }
            string request = head.ToString();
            int requestNo = Interlocked.Increment(ref RequestsServed);

            long rangeFrom = ParseRangeHeader(request);
            if (rangeFrom >= 0) LastRangeFrom = rangeFrom;

            bool canServePartial = _honorRange && rangeFrom >= 0 && rangeFrom < _payload.Length;
            byte[] body;
            string statusLine;
            string extraHeaders;

            if (canServePartial)
            {
                statusLine = "HTTP/1.1 206 Partial Content";
                extraHeaders = $"Content-Range: bytes {rangeFrom}-{_payload.Length - 1}/{_payload.Length}\r\n";
                body = _payload[(int)rangeFrom..];
            }
            else
            {
                statusLine = "HTTP/1.1 200 OK";
                extraHeaders = "";
                body = _payload;
            }

            byte[] header = Encoding.ASCII.GetBytes(
                $"{statusLine}\r\n" +
                $"Content-Length: {(canServePartial ? body.Length : _payload.Length)}\r\n" +
                "Content-Type: application/octet-stream\r\n" +
                extraHeaders +
                "Connection: close\r\n\r\n");
            await stream.WriteAsync(header).ConfigureAwait(false);

            int sendLength = body.Length;
            if (requestNo == 1 && _truncateFirstResponseAt > 0)
                sendLength = Math.Min(_truncateFirstResponseAt, body.Length);

            await stream.WriteAsync(body.AsMemory(0, sendLength)).ConfigureAwait(false);
            await stream.FlushAsync().ConfigureAwait(false);

            if (requestNo == 1 && _truncateFirstResponseAt > 0 && sendLength < body.Length)
            {
                // Abruptly reset the connection mid-body — a dropped transfer.
                client.LingerState = new LingerOption(true, 0);
            }
        }
        catch (Exception)
        {
            // fixture server ignores client-side aborts
        }
        finally
        {
            client.Close();
        }
    }

    private static long ParseRangeHeader(string request)
    {
        foreach (string line in request.Split("\r\n", StringSplitOptions.RemoveEmptyEntries))
        {
            if (!line.StartsWith("Range:", StringComparison.OrdinalIgnoreCase)) continue;
            string value = line["Range:".Length..].Trim();
            if (!value.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase)) return -1;
            string from = value["bytes=".Length..].Split('-')[0].Trim();
            return long.TryParse(from, out long n) ? n : -1;
        }
        return -1;
    }

    public void Dispose()
    {
        try { _listener.Stop(); } catch (SocketException) { }
    }
}
