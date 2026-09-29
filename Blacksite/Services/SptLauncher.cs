using System.Diagnostics;
using System.IO;

namespace Blacksite.Services;

/// <summary>Outcome of an integrated SPT launch (server + chained client launcher).</summary>
public sealed record SptLaunchResult(bool Success, string Message, string? ServerReadyLine = null);

/// <summary>
/// Integrated SPT server &amp; game launcher — real OS processes via System.Diagnostics.Process:
///   1. starts the server executable (SPT.Server.exe / Aki.Server.exe) with redirected stdout/stderr,
///   2. monitors the console stream for the ready phrase ("Server is ready" / "Server is running"),
///   3. automatically spawns the game launcher (SPT.Launcher.exe / Aki.Launcher.exe).
/// </summary>
public static class SptLauncher
{
    /// <summary>The server console phrases that mean "clients may connect now".</summary>
    public static readonly string[] ReadyPhrases =
    {
        "server is ready",
        "server is running",
        "happy playing" // newer SPT builds print this once the server is up
    };

    /// <summary>The server process of the most recent successful launch (to prevent double launches).</summary>
    public static Process? CurrentServer { get; private set; }

    /// <summary>Finds the server executable (SPT.Server.exe, then Aki.Server.exe) — in the
    /// SPT 4.x runtime folder (SPT_Runtime) first, then the classic root.</summary>
    public static string? FindServerExe(string sptRoot)
    {
        foreach (string baseDir in RuntimeFirst(sptRoot))
        foreach (string name in new[] { "SPT.Server.exe", "Aki.Server.exe" })
        {
            string path = Path.Combine(baseDir, name);
            if (File.Exists(path)) return path;
        }
        return null;
    }

    /// <summary>Finds the game launcher executable (SPT.Launcher.exe, then Aki.Launcher.exe) —
    /// in the SPT 4.x runtime folder (SPT_Runtime) first, then the classic root.</summary>
    public static string? FindLauncherExe(string sptRoot)
    {
        foreach (string baseDir in RuntimeFirst(sptRoot))
        foreach (string name in new[] { "SPT.Launcher.exe", "Aki.Launcher.exe" })
        {
            string path = Path.Combine(baseDir, name);
            if (File.Exists(path)) return path;
        }
        return null;
    }

    /// <summary>Search order for executables: SPT 4.x runtime folder first, then the classic root.</summary>
    private static string[] RuntimeFirst(string sptRoot)
    {
        string? runtime = SettingsService.FindRuntimeFolderName(sptRoot);
        return runtime is null ? new[] { sptRoot } : new[] { Path.Combine(sptRoot, runtime), sptRoot };
    }

    /// <summary>True when a monitored console line marks the server as ready.</summary>
    public static bool IsReadyMarker(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return false;
        foreach (string phrase in ReadyPhrases)
            if (line.Contains(phrase, StringComparison.OrdinalIgnoreCase))
                return true;
        return false;
    }

    /// <summary>
    /// Real launch chain: starts the server process with redirected output, streams every console
    /// line to <paramref name="status"/>, and the moment a ready phrase appears, spawns the game
    /// launcher. The server is started with its own working directory; the launcher is started
    /// shell-independent so it outlives this app.
    /// </summary>
    /// <param name="serverExe">Absolute path to the server executable (FindServerExe).</param>
    /// <param name="launcherExe">Absolute path to the launcher executable (FindLauncherExe).</param>
    /// <param name="status">Receives live console lines and lifecycle updates.</param>
    /// <param name="readyTimeout">How long to wait for the ready phrase before giving up.</param>
    public static async Task<SptLaunchResult> LaunchAsync(
        string serverExe, string launcherExe,
        IProgress<string>? status = null,
        TimeSpan? readyTimeout = null,
        CancellationToken cancellationToken = default)
    {
        if (!File.Exists(serverExe)) return new SptLaunchResult(false, $"Server executable not found: {serverExe}");
        if (!File.Exists(launcherExe)) return new SptLaunchResult(false, $"Launcher executable not found: {launcherExe}");

        if (CurrentServer is { HasExited: false } running)
            return new SptLaunchResult(false,
                $"The SPT server is already running (PID {running.Id}) — close it before launching again.");

        string workingDir = Path.GetDirectoryName(Path.GetFullPath(serverExe))!;

        var serverInfo = new ProcessStartInfo
        {
            FileName = serverExe,
            WorkingDirectory = workingDir,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        // NOT disposed here on purpose: the server must keep running after this method returns —
        // CurrentServer holds it for the double-launch guard (HasExited checks).
        var server = new Process { StartInfo = serverInfo, EnableRaisingEvents = true };
        var readyTcs = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var exitedTcs = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
        var tail = new Queue<string>();

        server.OutputDataReceived += (_, e) =>
        {
            if (e.Data is null) return;
            status?.Report(e.Data);
            lock (tail)
            {
                tail.Enqueue(e.Data);
                while (tail.Count > 5) tail.Dequeue();
            }
            if (IsReadyMarker(e.Data)) readyTcs.TrySetResult(e.Data);
        };
        // Some builds print lifecycle info on stderr — treat it as output too.
        server.ErrorDataReceived += (_, e) =>
        {
            if (e.Data is null) return;
            status?.Report(e.Data);
            lock (tail)
            {
                tail.Enqueue(e.Data);
                while (tail.Count > 5) tail.Dequeue();
            }
            if (IsReadyMarker(e.Data)) readyTcs.TrySetResult(e.Data);
        };
        server.Exited += (_, _) => exitedTcs.TrySetResult(0);

        if (!server.Start()) return new SptLaunchResult(false, "Failed to start the server process.");
        CurrentServer = server;
        server.BeginOutputReadLine();
        server.BeginErrorReadLine();
        status?.Report($"[blacksite] server started (PID {server.Id}) — watching console output…");

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(readyTimeout ?? TimeSpan.FromMinutes(3));

        Task done = await Task.WhenAny(readyTcs.Task, exitedTcs.Task, Task.Delay(Timeout.Infinite, timeoutCts.Token))
            .ConfigureAwait(false);

        if (done == exitedTcs.Task)
        {
            string lastLines;
            lock (tail) lastLines = string.Join(Environment.NewLine, tail);
            return new SptLaunchResult(false,
                $"The server exited before becoming ready. Last console output:{Environment.NewLine}{lastLines}");
        }

        if (done != readyTcs.Task) // timeout or cancellation
        {
            if (!server.HasExited)
            {
                try { server.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            }
            return cancellationToken.IsCancellationRequested
                ? new SptLaunchResult(false, "Launch cancelled.")
                : new SptLaunchResult(false, "The server did not report readiness within 3 minutes — it may still be installing or stuck.");
        }

        string readyLine = readyTcs.Task.Result ?? "server ready";

        // Ready → spawn the game launcher as an independent process.
        var launcherInfo = new ProcessStartInfo
        {
            FileName = launcherExe,
            WorkingDirectory = Path.GetDirectoryName(Path.GetFullPath(launcherExe))!,
            UseShellExecute = true
        };
        using var launcher = Process.Start(launcherInfo);
        status?.Report($"[blacksite] “{readyLine.Trim()}” detected — game launcher started"
                       + (launcher is null ? "" : $" (PID {launcher.Id}). Happy playing!"));

        return new SptLaunchResult(true,
            $"Server is ready — the game launcher has been started.{Environment.NewLine}Ready marker: {readyLine.Trim()}",
            readyLine.Trim());
    }
}
