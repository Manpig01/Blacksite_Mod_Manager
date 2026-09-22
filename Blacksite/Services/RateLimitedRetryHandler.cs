using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using Blacksite.Models;

namespace Blacksite.Services;

/// <summary>
/// Sliding-window rate limiter enforcing the sp-mod.com API budget:
/// burst limit of 40 requests per rolling 10 seconds AND a sustained limit of
/// 200 requests per rolling 60 seconds. Callers await <see cref="WaitAsync"/>
/// before issuing a request; the limiter queues them transparently.
/// </summary>
public sealed class SlidingWindowRateLimiter
{
    private const int BurstLimit = 40;
    private const long BurstWindowMs = 10_000;
    private const int SustainedLimit = 200;
    private const long SustainedWindowMs = 60_000;

    private readonly Queue<long> _burstStamps = new();
    private readonly Queue<long> _sustainedStamps = new();
    private readonly SemaphoreSlim _gate = new(1, 1);

    /// <summary>Raised when the local window imposes a visible (>1s) wait, so installs never
    /// look frozen while the burst/sustained budget refills (task 6.1, Fix B).</summary>
    public event Action<string>? WaitNotice;

    /// <summary>Blocks (asynchronously) until a request slot is available, then consumes it.</summary>
    public async Task WaitAsync(CancellationToken cancellationToken = default)
    {
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            int delayMs = 0;

            await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                long now = Environment.TickCount64;
                while (_burstStamps.Count > 0 && now - _burstStamps.Peek() >= BurstWindowMs) _burstStamps.Dequeue();
                while (_sustainedStamps.Count > 0 && now - _sustainedStamps.Peek() >= SustainedWindowMs) _sustainedStamps.Dequeue();

                if (_burstStamps.Count >= BurstLimit)
                {
                    delayMs = (int)(BurstWindowMs - (now - _burstStamps.Peek())) + 20;
                }
                else if (_sustainedStamps.Count >= SustainedLimit)
                {
                    delayMs = (int)(SustainedWindowMs - (now - _sustainedStamps.Peek())) + 20;
                }
                else
                {
                    _burstStamps.Enqueue(now);
                    _sustainedStamps.Enqueue(now);
                }
            }
            finally
            {
                _gate.Release();
            }

            if (delayMs <= 0) return;
            if (delayMs > 1000)
                WaitNotice?.Invoke($"Local rate-limit window — waiting {delayMs / 1000.0:F0}s…");
            await Task.Delay(delayMs, cancellationToken).ConfigureAwait(false);
        }
    }
}

/// <summary>
/// DelegatingHandler that (1) funnels every request through the sliding-window
/// rate limiter, (2) honours HTTP 429 + Retry-After by pausing and retrying, and
/// (3) retries transient failures (408/5xx/network) with exponential backoff.
/// </summary>
public sealed class RateLimitedRetryHandler : DelegatingHandler
{
    private const int MaxAttempts = 6;
    private readonly SlidingWindowRateLimiter _limiter;
    private readonly Action<string>? _onNotice;
    private static readonly TimeSpan RetryAfterCap = TimeSpan.FromMinutes(5);

    /// <summary>Longest SINGLE rate-limit wait the pipeline will sit through visibly (task 6.1,
    /// Fix B). A server demanding more than this fails the call with a clear retryable error
    /// instead of hanging the install. Default 90s.</summary>
    public TimeSpan MaxSingleRateLimitWait { get; set; } = TimeSpan.FromSeconds(90);

    /// <summary>Cap on CUMULATIVE 429 wait per request — even visible, countdown-driven waits
    /// eventually have to give up. Default 180s.</summary>
    public TimeSpan MaxCumulativeRateLimitWait { get; set; } = TimeSpan.FromSeconds(180);

    public RateLimitedRetryHandler(SlidingWindowRateLimiter limiter, Action<string>? onNotice = null)
        : base(CreateInnerHandler())
    {
        _limiter = limiter;
        _onNotice = onNotice;
        _limiter.WaitNotice += msg => _onNotice?.Invoke(msg);
    }

    /// <summary>Test/DI overload: wraps an injected transport (e.g. a fake HttpMessageHandler)
    /// instead of creating a real SocketsHttpHandler — same limiter + retry semantics.</summary>
    public RateLimitedRetryHandler(SlidingWindowRateLimiter limiter, HttpMessageHandler transport, Action<string>? onNotice = null)
        : base(transport)
    {
        _limiter = limiter;
        _onNotice = onNotice;
        _limiter.WaitNotice += msg => _onNotice?.Invoke(msg);
    }

    private static HttpMessageHandler CreateInnerHandler()
    {
        var sockets = new SocketsHttpHandler
        {
            AutomaticDecompression = DecompressionMethods.All,
            AllowAutoRedirect = true,
            MaxAutomaticRedirections = 10,
            ConnectTimeout = TimeSpan.FromSeconds(20),
            PooledConnectionLifetime = TimeSpan.FromMinutes(5)
        };
        return sockets;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        HttpResponseMessage? response = null;
        TimeSpan totalRateLimitWait = TimeSpan.Zero;

        for (int attempt = 1; attempt <= MaxAttempts; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await _limiter.WaitAsync(cancellationToken).ConfigureAwait(false);

            // An HttpRequestMessage cannot be sent twice — clone it for retries.
            using HttpRequestMessage message = attempt == 1 ? request : await CloneAsync(request, cancellationToken).ConfigureAwait(false);

            try
            {
                response = await base.SendAsync(message, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (!cancellationToken.IsCancellationRequested &&
                                       ex is HttpRequestException or TaskCanceledException or IOException)
            {
                if (attempt == MaxAttempts) throw;
                int backoffMs = BackoffMs(attempt);
                _onNotice?.Invoke($"Network error ({ex.GetType().Name}) — retrying in {backoffMs / 1000.0:F1}s…");
                await Task.Delay(backoffMs, cancellationToken).ConfigureAwait(false);
                continue;
            }

            if (response.StatusCode == HttpStatusCode.TooManyRequests) // 429
            {
                TimeSpan wait = GetRetryAfter(response) ?? TimeSpan.FromSeconds(Math.Min(30, 2 * Math.Pow(2, attempt)));
                response.Dispose();

                // Task 6.1, Fix B: a single wait beyond the visible-wait cap fails the call with a
                // clear RETRYABLE error instead of hanging the install; cumulative 429 waits are
                // capped too. Waits within the caps are visible (per-second countdown) and
                // cancellable (the caller's token flows through every delay below).
                bool overSingle = wait > MaxSingleRateLimitWait;
                bool overCumulative = totalRateLimitWait + wait > MaxCumulativeRateLimitWait;
                if (overSingle || overCumulative)
                {
                    InstallTrace.RateLimitWait(wait.TotalSeconds, attempt, MaxAttempts, refused: true);
                    throw new ApiException(
                        $"sp-mod.com rate limit demands a {wait.TotalSeconds:N0}s wait"
                        + (overSingle ? $" — over the {MaxSingleRateLimitWait.TotalSeconds:N0}s visible-wait cap" : "")
                        + (overCumulative && !overSingle ? " — cumulative rate-limit waits exceeded" : "")
                        + ". Nothing was installed. Please retry in a few minutes.");
                }

                InstallTrace.RateLimitWait(wait.TotalSeconds, attempt, MaxAttempts, refused: false);
                // Visible countdown: emit the remaining seconds every second while we hold the item.
                DateTime until = DateTime.UtcNow + wait;
                while (true)
                {
                    double remaining = (until - DateTime.UtcNow).TotalSeconds;
                    if (remaining <= 0) break;
                    _onNotice?.Invoke($"Rate limited by sp-mod.com — waiting {Math.Ceiling(remaining):N0}s (attempt {attempt} of {MaxAttempts})");
                    int slice = (int)Math.Min(1000, Math.Max(1, remaining * 1000));
                    try { await Task.Delay(slice, cancellationToken).ConfigureAwait(false); }
                    catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested) { }
                }

                totalRateLimitWait += wait;
                _onNotice?.Invoke($"Rate-limit wait over — retrying (attempt {attempt + 1} of {MaxAttempts})…");
                continue;
            }

            bool transient = (int)response.StatusCode >= 500 || response.StatusCode == HttpStatusCode.RequestTimeout;
            if (transient && attempt < MaxAttempts)
            {
                int backoffMs = BackoffMs(attempt);
                _onNotice?.Invoke($"Server returned {(int)response.StatusCode} — retrying in {backoffMs / 1000.0:F1}s…");
                response.Dispose();
                await Task.Delay(backoffMs, cancellationToken).ConfigureAwait(false);
                continue;
            }

            return response;
        }

        // Unreachable in practice; satisfies the compiler.
        return response ?? throw new HttpRequestException("Request failed after retries.");
    }

    private static int BackoffMs(int attempt)
        => (int)Math.Min(15_000, 1000 * Math.Pow(2, attempt - 1)) + Random.Shared.Next(0, 400);

    private static TimeSpan? GetRetryAfter(HttpResponseMessage response)
    {
        RetryConditionHeaderValue? retry = response.Headers.RetryAfter;
        if (retry is null) return null;
        if (retry.Delta is { } delta) return delta > RetryAfterCap ? RetryAfterCap : delta;
        if (retry.Date is { } date)
        {
            TimeSpan until = date - DateTimeOffset.UtcNow;
            if (until <= TimeSpan.Zero) return TimeSpan.FromMilliseconds(500);
            return until > RetryAfterCap ? RetryAfterCap : until;
        }
        return null;
    }

    private static async Task<HttpRequestMessage> CloneAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var clone = new HttpRequestMessage(request.Method, request.RequestUri) { Version = request.Version, VersionPolicy = request.VersionPolicy };
        foreach (KeyValuePair<string, IEnumerable<string>> header in request.Headers)
            clone.Headers.TryAddWithoutValidation(header.Key, header.Value);
        foreach (KeyValuePair<string, object?> option in request.Options)
            clone.Options.TryAdd(option.Key, option.Value);
        if (request.Content is not null)
        {
            byte[] payload = await request.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);
            clone.Content = new ByteArrayContent(payload);
            foreach (KeyValuePair<string, IEnumerable<string>> header in request.Content.Headers)
                clone.Content.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }
        return clone;
    }
}
