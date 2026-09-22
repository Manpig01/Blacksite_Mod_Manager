using System.Diagnostics;
using System.IO;
using System.Text;

namespace Blacksite.Services;

/// <summary>
/// Lightweight install trace log (task 6.1, STEP 0). Every stage transition, API call,
/// rate-limit wait, dependency download and prompt event lands here with a timestamp so
/// future "it froze" reports are diagnosable from a single file.
///
/// The log lives in the temp dir and rolls: when the active file passes <see cref="MaxBytes"/>
/// (default ~1 MB) it is moved to install-trace.1.log (previous generation deleted) and a
/// fresh one starts — so the trace never grows unbounded.
/// Thread-safe; safe to call from any pipeline thread.
/// </summary>
public static class InstallTrace
{
    private static readonly object Gate = new();
    private static string _dir = Path.Combine(Path.GetTempPath(), "BlacksiteModManager");
    private static string _file = Path.Combine(_dir, "install-trace.log");

    /// <summary>Roll-over threshold for the active trace file.</summary>
    public static long MaxBytes { get; set; } = 1_048_576; // ~1 MB

    /// <summary>Current trace file path (exposed for the Settings "clear logs"/support path and tests).</summary>
    public static string FilePath => _file;

    /// <summary>Writes one line: <c>HH:mm:ss.fff [category] message</c>.</summary>
    public static void Log(string category, string message)
    {
        try
        {
            string line = $"{DateTime.Now:HH:mm:ss.fff} [{category}] {message}{Environment.NewLine}";
            byte[] bytes = Encoding.UTF8.GetBytes(line);
            lock (Gate)
            {
                Directory.CreateDirectory(_dir);
                if (File.Exists(_file) && new FileInfo(_file).Length + bytes.Length > MaxBytes)
                {
                    string previous = _file + ".1";
                    if (File.Exists(previous)) File.Delete(previous);
                    File.Move(_file, previous);
                }
                using (var stream = new FileStream(_file, FileMode.Append, FileAccess.Write, FileShare.Read))
                    stream.Write(bytes, 0, bytes.Length);
            }
        }
        catch
        {
            // The trace must never break an install.
        }
    }

    // ------------------------------------------------------------------ event helpers

    /// <summary>A pipeline stage transition on a queued install (Validating → Resolving → …).</summary>
    public static void Stage(string mod, string stage, string? detail = null)
        => Log("stage", $"{mod}: {stage}" + (detail is null ? "" : $" — {detail}"));

    /// <summary>One API request left the client (relative URL or absolute download link).</summary>
    public static void ApiCall(string what)
        => Log("api", what);

    /// <summary>A rate-limit wait started (or was refused by the wait cap).</summary>
    public static void RateLimitWait(double plannedSeconds, int attempt, int maxAttempts, bool refused)
        => Log("ratelimit", refused
            ? $"REFUSED wait of {plannedSeconds:N0}s (attempt {attempt} of {maxAttempts}) — over the visible-wait cap, failing this item"
            : $"waiting {plannedSeconds:N0}s (attempt {attempt} of {maxAttempts})");

    /// <summary>A dependency/target download started or finished.</summary>
    public static void Download(string what, long? size, bool finished, double? seconds = null)
        => Log("download", finished
            ? $"{what} finished ({size?.ToString("N0") ?? "?"} bytes" + (seconds is { } s ? $", {s:F1}s" : "") + ")"
            : $"{what} started ({size?.ToString("N0") ?? "?"} bytes)");

    /// <summary>The dependency prompt was shown / answered.</summary>
    public static void Prompt(string mod, string what)
        => Log("prompt", $"{mod}: {what}");

    /// <summary>The download stall watchdog fired.</summary>
    public static void Stall(double timeoutSeconds, long atByte)
        => Log("stall", $"no data for {timeoutSeconds:N0}s at byte {atByte:N0} — failing the item");
}
