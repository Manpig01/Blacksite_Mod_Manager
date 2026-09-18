using System.Diagnostics;
using System.IO;

namespace Blacksite.Services;

/// <summary>
/// Standalone 7-Zip archive extraction driven by the bundled console binary
/// (tools/7zip/win/7za.exe + 7za.dll, copied to the build output). The bundled binary is
/// resolved dynamically next to the running executable; a system-installed 7-Zip is used as a
/// fallback when the local binaries are missing. All process I/O is fully asynchronous — the
/// application thread and UI never block.
/// </summary>
public sealed class SevenZipService
{
    /// <summary>Optional explicit binary override (used by the smoke harness on Linux; null in
    /// production, where the bundled Windows binary is resolved dynamically).</summary>
    private readonly string? _binaryOverride;

    public SevenZipService(string? binaryOverride = null) => _binaryOverride = binaryOverride;

    /// <summary>Bundled standalone 7-Zip console binary, resolved relative to the running executable.</summary>
    public static string GetBundledBinaryPath() =>
        Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "tools", "7zip", "win", "7za.exe");

    /// <summary>Well-known system 7-Zip locations used when the bundled binaries are missing.</summary>
    private static readonly string[] SystemFallbackCandidates =
    {
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "7-Zip", "7z.exe"),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "7-Zip", "7za.exe"),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "7-Zip", "7z.exe"),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "7-Zip", "7za.exe"),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "7-Zip", "7z.exe"),
    };

    /// <summary>Resolves the 7-Zip executable to run: bundled tools/7zip/win/7za.exe first,
    /// then a system-installed 7-Zip, then a 7z/7za on PATH. Null when nothing is available.</summary>
    public string? ResolveBinary()
    {
        if (_binaryOverride is not null && File.Exists(_binaryOverride)) return _binaryOverride;

        string bundled = GetBundledBinaryPath();
        if (File.Exists(bundled)) return bundled;

        foreach (string candidate in SystemFallbackCandidates)
        {
            try { if (File.Exists(candidate)) return candidate; }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException) { }
        }

        // Last resort: a 7z/7za executable on the PATH.
        string pathVar = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        foreach (string dir in pathVar.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            try
            {
                foreach (string name in new[] { "7za.exe", "7z.exe" })
                {
                    string candidate = Path.Combine(dir, name);
                    if (File.Exists(candidate)) return candidate;
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException) { }
        }
        return null;
    }

    /// <summary>
    /// Extracts an archive with its full directory tree (x), auto-overwriting conflicts (-y) and
    /// suppressing output clutter (-bso0). Runs headless and asynchronously.
    /// Exit codes: 0 = success, 1 = warning (extraction still succeeded), ≥2 = fatal error /
    /// corrupted archive — detailed standard error is logged in that case.
    /// Throws <see cref="FileNotFoundException"/> (handled) when neither the bundled binary nor a
    /// system 7-Zip is available, or when the archive does not exist.
    /// </summary>
    public async Task<bool> ExtractArchiveAsync(string archivePath, string destinationDirectory)
    {
        string? binary = ResolveBinary();
        if (binary is null)
            throw new FileNotFoundException(
                "7-Zip is not available: the bundled tools/7zip/win/7za.exe is missing and no system 7-Zip installation was found.",
                GetBundledBinaryPath());
        if (!File.Exists(archivePath))
            throw new FileNotFoundException("Archive not found.", archivePath);
        if (string.IsNullOrWhiteSpace(destinationDirectory))
            throw new ArgumentException("Destination directory must not be empty.", nameof(destinationDirectory));

        Directory.CreateDirectory(destinationDirectory);

        // x     = extract files with full directory tree structure
        // -o"…" = target directory (attached to -o, no trailing space or backslash before the quote)
        // -y    = auto-overwrite conflicting files during extraction
        // -bso0 = suppress standard-output clutter
        string cleanDestination = destinationDirectory.TrimEnd(' ', '\t', '\\', '/');
        string arguments = $"x \"{archivePath}\" -o\"{cleanDestination}\" -y -bso0";

        var startInfo = new ProcessStartInfo
        {
            FileName = binary,
            Arguments = arguments,
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardError = true,
        };

        using var process = new Process { StartInfo = startInfo };
        process.Start();

        // Drain stderr while the process runs (avoids a full-pipe deadlock), then wait without blocking.
        string stderr = await process.StandardError.ReadToEndAsync().ConfigureAwait(false);
        await process.WaitForExitAsync().ConfigureAwait(false);

        switch (process.ExitCode)
        {
            case 0:
                return true;
            case 1:
                Debug.WriteLine($"[blacksite] 7-Zip warning while extracting \"{archivePath}\": {stderr.Trim()}");
                return true; // warning only — the files themselves extracted
            default:
                Debug.WriteLine($"[blacksite] 7-Zip failed (exit {process.ExitCode}) while extracting \"{archivePath}\": {stderr.Trim()}");
                return false; // 2 = fatal error / corrupted archive (7: CLI error, 8: OOM, 255: break)
        }
    }
}
