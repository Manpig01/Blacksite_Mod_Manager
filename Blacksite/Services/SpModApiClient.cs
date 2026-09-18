using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text.Json;
using Blacksite.Models;

namespace Blacksite.Services;

/// <summary>
/// Real client for the sp-mod.com public API (https://sp-mod.com/api/v0).
/// Every request goes through the sliding-window rate limiter (40/10s burst, 200/60s sustained)
/// and the 429/Retry-After aware retry handler.
/// </summary>
public sealed class SpModApiClient : IDisposable
{
    public const string BaseUrl = "https://sp-mod.com/api/v0/";
    public const string SiteUrl = "https://sp-mod.com/";
    private const string UserAgent = "BlacksiteModManager/1.0 (+https://sp-mod.com)";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true
    };

    private readonly HttpClient _api;       // rate-limited + retrying, used for API calls and mod downloads
    private readonly HttpClient _media;     // plain client for CDN assets (thumbnails); sends the Referer the CDN requires

    /// <summary>Human-readable notices from the HTTP pipeline (throttle waits, retries…).</summary>
    public event Action<string>? Notice;

    public SpModApiClient()
    {
        var limiter = new SlidingWindowRateLimiter();
        var handler = new RateLimitedRetryHandler(limiter, msg => Notice?.Invoke(msg));
        _api = new HttpClient(handler) { BaseAddress = new Uri(BaseUrl), Timeout = Timeout.InfiniteTimeSpan };
        _api.DefaultRequestHeaders.UserAgent.ParseAdd(UserAgent);
        _api.DefaultRequestHeaders.Accept.ParseAdd("application/json");

        var mediaHandler = new SocketsHttpHandler
        {
            AutomaticDecompression = System.Net.DecompressionMethods.All,
            AllowAutoRedirect = true,
            MaxAutomaticRedirections = 10,
            ConnectTimeout = TimeSpan.FromSeconds(20),
            PooledConnectionLifetime = TimeSpan.FromMinutes(5)
        };
        _media = new HttpClient(mediaHandler) { Timeout = TimeSpan.FromSeconds(60) };
        _media.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) BlacksiteModManager/1.0");
        _media.DefaultRequestHeaders.Referrer = new Uri(SiteUrl);
    }

    // ------------------------------------------------------------------ catalog

    /// <summary>
    /// Fetches the mod catalog with REAL server-side filtering, walking every result page
    /// (per_page is capped at 50 by the server). Verified query contract of GET /mods:
    ///   query=<text>                        — searches name, teaser and author
    ///   filter[spt_version]=X.Y.Z           — only mods compatible with that SPT release
    ///   filter[category_id]=N               — only mods in that category
    ///   filter[fika_compatibility]=1        — only Fika-compatible mods
    ///   sort=<key> / sort=-<key>            — name, downloads, favourites_count,
    ///                                         endorsements_count, featured, created_at,
    ///                                         updated_at, published_at
    /// </summary>
    public async Task<List<Mod>> GetCatalogAsync(CatalogFilter filter, IProgress<CatalogProgress>? progress, CancellationToken cancellationToken)
    {
        var query = new List<string> { "per_page=50" };
        if (!string.IsNullOrWhiteSpace(filter.SearchText))
            query.Add(AddParam("query", filter.SearchText.Trim()));
        if (!string.IsNullOrWhiteSpace(filter.SptVersion))
            query.Add(AddParam("filter[spt_version]", filter.SptVersion.Trim()));
        if (filter.CategoryId is int categoryId)
            query.Add(AddParam("filter[category_id]", categoryId.ToString()));
        if (filter.FikaOnly)
            query.Add(AddParam("filter[fika_compatibility]", "1"));
        string? sort = filter.Sort.ToApiSort();
        if (sort is not null)
            query.Add(AddParam("sort", sort));

        var all = new List<Mod>();
        int page = 1, lastPage = 1;

        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            string url = $"mods?{string.Join("&", query)}&page={page}";
            var resp = await GetJsonAsync<PagedResponse<Mod>>(url, cancellationToken).ConfigureAwait(false);
            EnsureSuccess(resp.Success, resp.Message, resp.Code, "Failed to load mod catalog");
            all.AddRange(resp.Data);

            lastPage = Math.Max(1, resp.Meta?.LastPage ?? page);
            progress?.Report(new CatalogProgress(page, lastPage, all.Count));

            if (page >= lastPage || resp.Data.Count == 0) break;
            page++;
        }
        return all;
    }

    /// <summary>GET /mod/{id} — a single catalog mod by its numeric id.</summary>
    public async Task<Mod> GetModAsync(int modId, CancellationToken cancellationToken)
    {
        var resp = await GetJsonAsync<ApiResponse<Mod>>($"mod/{modId}", cancellationToken).ConfigureAwait(false);
        EnsureSuccess(resp.Success, resp.Message, resp.Code, $"Failed to load mod {modId}");
        return resp.Data ?? throw new ApiException($"Mod {modId} not found.");
    }

    // ------------------------------------------------------- filter taxonomies

    /// <summary>GET /spt/versions — the live SPT release list (with per-version mod counts).</summary>
    public async Task<List<SptVersionInfo>> GetSptVersionsAsync(CancellationToken cancellationToken)
    {
        var all = new List<SptVersionInfo>();
        int page = 1, lastPage = 1;

        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var resp = await GetJsonAsync<PagedResponse<SptVersionInfo>>($"spt/versions?per_page=50&page={page}", cancellationToken).ConfigureAwait(false);
            EnsureSuccess(resp.Success, resp.Message, resp.Code, "Failed to load SPT versions");
            all.AddRange(resp.Data);

            lastPage = Math.Max(1, resp.Meta?.LastPage ?? page);
            if (page >= lastPage || resp.Data.Count == 0) break;
            page++;
        }
        return all;
    }

    /// <summary>GET /mod-categories — the live category taxonomy (Weapons, Traders, Tools, …).</summary>
    public async Task<List<ModCategoryInfo>> GetCategoriesAsync(CancellationToken cancellationToken)
    {
        var all = new List<ModCategoryInfo>();
        int page = 1, lastPage = 1;

        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var resp = await GetJsonAsync<PagedResponse<ModCategoryInfo>>($"mod-categories?per_page=100&page={page}", cancellationToken).ConfigureAwait(false);
            EnsureSuccess(resp.Success, resp.Message, resp.Code, "Failed to load mod categories");
            all.AddRange(resp.Data);

            lastPage = Math.Max(1, resp.Meta?.LastPage ?? page);
            if (page >= lastPage || resp.Data.Count == 0) break;
            page++;
        }
        return all;
    }

    private static string AddParam(string name, string value)
        => $"{Uri.EscapeDataString(name)}={Uri.EscapeDataString(value)}";

    // ----------------------------------------------------------------- versions

    /// <summary>Fetches ALL versions of a mod (the endpoint is paginated too).</summary>
    public async Task<List<ModVersion>> GetVersionsAsync(int modId, CancellationToken cancellationToken)
    {
        var all = new List<ModVersion>();
        int page = 1, lastPage = 1;

        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var resp = await GetJsonAsync<PagedResponse<ModVersion>>($"mod/{modId}/versions?per_page=50&page={page}", cancellationToken).ConfigureAwait(false);
            EnsureSuccess(resp.Success, resp.Message, resp.Code, $"Failed to load versions for mod {modId}");
            all.AddRange(resp.Data);

            lastPage = Math.Max(1, resp.Meta?.LastPage ?? page);
            if (page >= lastPage || resp.Data.Count == 0) break;
            page++;
        }
        return all;
    }

    // ------------------------------------------------------------- dependencies

    /// <summary>
    /// GET /mods/dependencies?mods=id:version,id:version&amp;spt_version=X.Y.Z
    /// Returns a map of "id:version" → resolved dependency list.
    /// </summary>
    public async Task<Dictionary<string, List<DependencyInfo>>> GetDependenciesAsync(
        IReadOnlyList<(int Id, string Version)> mods, string sptVersion, CancellationToken cancellationToken)
    {
        if (mods.Count == 0) return new Dictionary<string, List<DependencyInfo>>();

        string modsParam = string.Join(",", mods.Select(m => $"{m.Id}:{m.Version}"));
        string url = $"mods/dependencies?mods={Uri.EscapeDataString(modsParam)}&spt_version={Uri.EscapeDataString(sptVersion)}";

        var resp = await GetJsonAsync<ApiResponse<Dictionary<string, List<DependencyInfo>>>>(url, cancellationToken).ConfigureAwait(false);
        EnsureSuccess(resp.Success, resp.Message, resp.Code, "Dependency lookup failed");
        return resp.Data ?? new Dictionary<string, List<DependencyInfo>>();
    }

    // ------------------------------------------------------------------ updates

    /// <summary>
    /// GET /mods/updates?mods=identifier:version,...&amp;spt_version=X.Y.Z
    /// (identifier = numeric mod id or GUID). Returns the server's full update report:
    /// available updates (with recommended download), up-to-date, blocked and incompatible entries.
    /// </summary>
    public async Task<UpdatesData> GetUpdatesAsync(
        IReadOnlyList<(string Identifier, string Version)> mods, string sptVersion, CancellationToken cancellationToken)
    {
        if (mods.Count == 0) return new UpdatesData();

        string modsParam = string.Join(",", mods.Select(m => $"{m.Identifier}:{m.Version}"));
        string url = $"mods/updates?mods={Uri.EscapeDataString(modsParam)}&spt_version={Uri.EscapeDataString(sptVersion)}";

        var resp = await GetJsonAsync<ApiResponse<UpdatesData>>(url, cancellationToken).ConfigureAwait(false);
        EnsureSuccess(resp.Success, resp.Message, resp.Code, "Update check failed");
        return resp.Data ?? new UpdatesData();
    }

    // ------------------------------------------------------------------ download

    /// <summary>
    /// Streams a file (mod archive) to disk through a .part temp file, reporting real progress and speed.
    /// The API download links 307-redirect to the file host; redirects are followed automatically.
    ///
    /// Robustness (fixes real-world truncated downloads, e.g. 117 MB transfers cut a few bytes short):
    /// • A connection that drops mid-body or ends short of the announced length is RETRIED (up to 6 attempts).
    /// • Each retry sends an HTTP <c>Range: bytes=N-</c> header to RESUME from the bytes already in the
    ///   .part file instead of restarting the whole download; servers that ignore Range simply restart.
    /// • Every read is guarded by a stall timeout so a wedged socket cannot hang the install forever.
    /// • The final file only appears at the destination once its size is verified complete.
    /// </summary>
    public async Task<long> DownloadFileAsync(string url, string destinationPath, IProgress<DownloadProgress>? progress, CancellationToken cancellationToken)
    {
        const int MaxAttempts = 6;
        TimeSpan readStallTimeout = TimeSpan.FromSeconds(90);

        string partPath = destinationPath + ".part";
        string? dir = Path.GetDirectoryName(destinationPath);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        if (File.Exists(destinationPath)) File.Delete(destinationPath);

        // Bytes already downloaded during a previous attempt (or a previous app run) — resume basis.
        long have = File.Exists(partPath) ? new FileInfo(partPath).Length : 0;
        long? expectedTotal = null;
        Exception? lastFailure = null;

        for (int attempt = 1; attempt <= MaxAttempts; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, url);
                if (have > 0)
                    request.Headers.Range = new RangeHeaderValue(have, null);

                using var response = await _api.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);

                if (response.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable && have > 0)
                {
                    // The server refused our resume range. Its 416 response carries the truth about the
                    // REAL total: "Content-Range: bytes */REALTOTAL". Live-verified case: a host whose
                    // advertised Content-Length was 9 bytes LARGER than the file it actually serves —
                    // every full download ends "truncated", every resume 416s. When the server's own
                    // real total matches the bytes we already hold, the transfer IS complete.
                    long? realTotal = response.Content.Headers.ContentRange?.Length;
                    if (realTotal is long total && total <= have)
                    {
                        // We already hold everything the server can give.
                        Notice?.Invoke($"Host corrected the file size to {total:N0} bytes — download complete.");
                        progress?.Report(new DownloadProgress(have, have, 0));
                        File.Move(partPath, destinationPath, overwrite: true);
                        return have;
                    }

                    // Genuinely unsatisfiable (e.g. stale .part longer than the file) — restart clean.
                    TryDeleteFile(partPath);
                    have = 0;
                    continue;
                }

                if (!response.IsSuccessStatusCode && response.StatusCode != HttpStatusCode.PartialContent)
                    throw new ApiException($"Download failed with HTTP {(int)response.StatusCode} ({response.StatusCode}) for {url}");

                bool resuming = response.StatusCode == HttpStatusCode.PartialContent;
                System.Net.Http.Headers.ContentRangeHeaderValue? contentRange = response.Content.Headers.ContentRange;
                long? bodyLength = response.Content.Headers.ContentLength;

                if (resuming)
                {
                    // Content-Range: "bytes start-end/total" — trust the server's total when present.
                    if (contentRange?.Length is long totalFromRange) expectedTotal ??= totalFromRange;
                    if (contentRange?.From is long from && from != have)
                    {
                        // Server honoured the header syntax but restarted elsewhere — restart cleanly.
                        TryDeleteFile(partPath);
                        have = 0;
                        continue;
                    }
                    expectedTotal ??= have + bodyLength;
                }
                else
                {
                    // Full response (200): any partial .part content is now invalid — restart from byte 0.
                    expectedTotal = bodyLength;
                    have = 0;
                }

                var stopwatch = Stopwatch.StartNew();
                long receivedThisAttempt = 0;
                long lastReportTick = 0;
                byte[] buffer = new byte[128 * 1024];

                await using (var source = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false))
                await using (var target = new FileStream(
                    partPath, resuming ? FileMode.Append : FileMode.Create,
                    FileAccess.Write, FileShare.None, buffer.Length, useAsync: true))
                {
                    while (true)
                    {
                        // Per-read stall guard: a wedged connection cancels after readStallTimeout,
                        // the attempt is treated as a dropped connection and resumed on retry.
                        using var readCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                        readCts.CancelAfter(readStallTimeout);

                        int read;
                        try { read = await source.ReadAsync(buffer, readCts.Token).ConfigureAwait(false); }
                        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
                        {
                            throw new IOException($"Download stalled — no data for {readStallTimeout.TotalSeconds:N0}s at byte {have + receivedThisAttempt}.");
                        }

                        if (read <= 0) break;
                        await target.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
                        receivedThisAttempt += read;

                        long now = stopwatch.ElapsedMilliseconds;
                        if (progress is not null && now - lastReportTick >= 100)
                        {
                            lastReportTick = now;
                            long done = have + receivedThisAttempt;
                            double speed = stopwatch.Elapsed.TotalSeconds > 0.2 ? receivedThisAttempt / stopwatch.Elapsed.TotalSeconds : 0;
                            progress.Report(new DownloadProgress(done, expectedTotal, speed));
                        }
                    }
                    await target.FlushAsync(cancellationToken).ConfigureAwait(false);
                }

                have = File.Exists(partPath) ? new FileInfo(partPath).Length : 0;

                if (expectedTotal is long expected)
                {
                    if (have < expected)
                    {
                        // The connection ended early — the exact failure that used to abort installs.
                        lastFailure = new IOException($"Incomplete download: expected {expected:N0} bytes but got {have:N0}.");
                        if (attempt < MaxAttempts)
                        {
                            Notice?.Invoke($"Download truncated at {have:N0}/{expected:N0} bytes — resuming (attempt {attempt + 1}/{MaxAttempts})…");
                            await Task.Delay(TimeSpan.FromMilliseconds(300 * attempt), cancellationToken).ConfigureAwait(false);
                            continue;
                        }
                        throw lastFailure;
                    }
                    if (have > expected)
                    {
                        lastFailure = new IOException($"Corrupt download: received {have:N0} bytes but expected {expected:N0}.");
                        TryDeleteFile(partPath);
                        have = 0;
                        if (attempt < MaxAttempts) continue;
                        throw lastFailure;
                    }
                }

                double finalSpeed = stopwatch.Elapsed.TotalSeconds > 0 ? receivedThisAttempt / stopwatch.Elapsed.TotalSeconds : 0;
                progress?.Report(new DownloadProgress(have, expectedTotal ?? have, finalSpeed));
                File.Move(partPath, destinationPath, overwrite: true);
                return have;
            }
            catch (Exception ex) when (ex is HttpRequestException or IOException or SocketException
                                       && !cancellationToken.IsCancellationRequested)
            {
                // Dropped connection / reset / IO hiccup — keep the .part bytes and resume on the next attempt.
                have = File.Exists(partPath) ? new FileInfo(partPath).Length : 0;
                lastFailure = ex;
                if (attempt >= MaxAttempts)
                    throw new IOException($"Download failed after {MaxAttempts} attempts ({have:N0} bytes retained): {ex.Message}", ex);

                Notice?.Invoke($"Download interrupted ({ex.GetType().Name}) at {have:N0} bytes — resuming (attempt {attempt + 1}/{MaxAttempts})…");
                await Task.Delay(TimeSpan.FromMilliseconds(300 * attempt), cancellationToken).ConfigureAwait(false);
            }
        }

        throw lastFailure ?? new IOException($"Download failed: {url}");
    }

    private static void TryDeleteFile(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    // -------------------------------------------------------------------- images

    /// <summary>Downloads a thumbnail/image from the CDN (requires Referer: https://sp-mod.com/).</summary>
    public async Task<byte[]?> GetImageBytesAsync(string url, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await _media.GetAsync(url, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode) return null;
            return await response.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException)
        {
            return null;
        }
    }

    // -------------------------------------------------------------------- health

    /// <summary>Lightweight health probe: one catalog page, measuring latency and total mod count.</summary>
    public async Task<(bool Online, string Detail)> PingAsync(CancellationToken cancellationToken)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            var resp = await GetJsonAsync<PagedResponse<Mod>>("mods?per_page=50&page=1", cancellationToken).ConfigureAwait(false);
            sw.Stop();
            if (!resp.Success) return (false, $"API error: {resp.Message ?? resp.Code ?? "unknown"}");
            int total = resp.Meta?.Total ?? resp.Data.Count;
            return (true, $"online · {total:N0} mods · {sw.ElapsedMilliseconds} ms");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            sw.Stop();
            return (false, $"unreachable · {ex.GetType().Name}: {ex.Message}");
        }
    }

    // ------------------------------------------------------------------- helpers

    private async Task<T> GetJsonAsync<T>(string relativeUrl, CancellationToken cancellationToken)
    {
        using var response = await _api.GetAsync(relativeUrl, cancellationToken).ConfigureAwait(false);
        string body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            string? apiMessage = TryExtractMessage(body);
            throw new ApiException($"HTTP {(int)response.StatusCode} ({response.StatusCode}) for /{relativeUrl}" +
                                   (apiMessage is null ? "" : $" — {apiMessage}"));
        }

        try
        {
            return JsonSerializer.Deserialize<T>(body, JsonOptions)
                   ?? throw new ApiException($"Empty response body for /{relativeUrl}");
        }
        catch (JsonException ex)
        {
            string snippet = body.Length > 200 ? body[..200] + "…" : body;
            throw new ApiException($"Malformed JSON from /{relativeUrl}: {ex.Message} (body: {snippet})", ex);
        }
    }

    private static string? TryExtractMessage(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("message", out var msg) && msg.ValueKind == JsonValueKind.String)
                return msg.GetString();
        }
        catch (JsonException) { }
        return null;
    }

    private static void EnsureSuccess(bool success, string? message, string? code, string fallback)
    {
        if (!success) throw new ApiException($"{fallback}: {message ?? code ?? "API returned success=false"}");
    }

    public void Dispose()
    {
        _api.Dispose();
        _media.Dispose();
    }
}
