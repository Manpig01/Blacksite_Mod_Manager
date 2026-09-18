using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using Blacksite.Models;

namespace Blacksite.Services;

public enum DependencyPromptResult { InstallWithDeps, InstallModOnly, Cancel }

/// <summary>One row in the dependency prompt dialog.</summary>
public sealed record DependencyRow(
    string Name,
    string PackageId,
    string? ResolvedVersion,
    bool CanAutoInstall,
    bool Conflict);

/// <summary>Everything the UI needs to render the dependency prompt.</summary>
public sealed record DependencyPrompt(
    string ModName,
    string ModVersion,
    IReadOnlyList<DependencyRow> Missing,
    IReadOnlyList<DependencyRow> Conflicts,
    IReadOnlyList<DependencyRow> Unresolved,
    string Warning = "")
{
    public bool HasAutoInstallable => Missing.Count > 0;
    public bool HasAny => Missing.Count > 0 || Conflicts.Count > 0 || Unresolved.Count > 0;
    public int MissingCount => Missing.Count;
}

public sealed record InstallResult(bool Success, string Message, string? InstalledVersion = null);

/// <summary>Result of the pre-queue dependency resolution: everything the resolver dialog needs to
/// render, plus the ordered install queue for the "install + dependencies" path.</summary>
public sealed record DependencyResolution(DependencyPrompt Prompt, IReadOnlyList<InstallService.ResolvedDependency> InstallQueue)
{
    public bool NeedsPrompt => Prompt.HasAny;
}

/// <summary>
/// Pass-through IProgress&lt;T&gt;: reports synchronously on the caller's thread instead of hopping to a
/// captured context/thread-pool (which System.Progress&lt;T&gt; does when none is captured). Install
/// pipelines run on the queue's consumer thread, so this keeps every progress callback strictly
/// ordered — no late thread-pool report can overtake the task's own completion.
/// </summary>
internal sealed class SyncProgress<T> : IProgress<T>
{
    private readonly Action<T> _report;
    public SyncProgress(Action<T> report) => _report = report;
    public void Report(T value) => _report(value);
}

/// <summary>
/// Production install pipeline:
///   validate directory → resolve best version → dependency check (GET /mods/dependencies) →
///   user prompt → download real archive to %TEMP%\{id}.zip (streamed, with progress) →
///   ZipFile.ExtractToDirectory(overwriteFiles: true) into the SPT root → delete temp zip.
/// </summary>
public sealed class InstallService
{
    private readonly SpModApiClient _api;
    private readonly SettingsService _settings;

    public InstallService(SpModApiClient api, SettingsService settings)
    {
        _api = api;
        _settings = settings;
    }

    // ------------------------------------------------------------- SPT root checks

    /// <summary>True when the folder looks like a Single Player Tarkov server root.</summary>
    public static bool DirectoryLooksLikeSptRoot(string dir)
    {
        try
        {
            return File.Exists(Path.Combine(dir, "EscapeFromTarkov.exe"))
                || Directory.Exists(Path.Combine(dir, "BepInEx"))
                || Directory.Exists(Path.Combine(dir, "user"))
                || Directory.Exists(Path.Combine(dir, "SPT_Data"))
                // SPT 4.x: the install root contains a SPT_Runtime child instead of the folders itself.
                || SettingsService.FindRuntimeFolderName(dir) is not null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            return false;
        }
    }

    /// <summary>
    /// Tries to detect the installed SPT version from well-known server binaries in the root folder
    /// (SPT.Core.dll shipped under BepInEx\plugins\spt or SPT_Data\Server).
    /// </summary>
    public static string? TryDetectSptVersion(string dir)
    {
        // SPT 4.x keeps the runtime (server exe, package.json) inside a SPT_Runtime child folder —
        // probe there first, then the classic root locations.
        string? runtime = SettingsService.FindRuntimeFolderName(dir);
        string rt = runtime is null ? dir : Path.Combine(dir, runtime);

        // (1) package.json in the runtime folder / SPT root (SPT.Server ships one with a "version" field).
        try
        {
            foreach (string packageJson in new[] { Path.Combine(rt, "package.json"), Path.Combine(dir, "package.json") })
            {
                if (!File.Exists(packageJson)) continue;
                using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(packageJson));
                if (doc.RootElement.TryGetProperty("version", out var version) && version.ValueKind == System.Text.Json.JsonValueKind.String)
                {
                    string? parsed = ExtractSemver(version.GetString());
                    if (parsed is not null) return parsed;
                }
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or System.Text.Json.JsonException) { }

        // (2) version resources of the server executables.
        string[] candidates =
        {
            Path.Combine(rt, "SPT.Server.exe"),
            Path.Combine(rt, "Aki.Server.exe"),
            Path.Combine(rt, "BepInEx", "plugins", "spt", "SPT.Core.dll"),
            Path.Combine(rt, "BepInEx", "plugins", "spt", "SPT.Server.dll"),
            Path.Combine(dir, "SPT.Server.exe"),
            Path.Combine(dir, "Aki.Server.exe"),
            Path.Combine(dir, "BepInEx", "plugins", "spt", "SPT.Core.dll"),
            Path.Combine(dir, "BepInEx", "plugins", "spt", "SPT.Server.dll"),
            Path.Combine(dir, "SPT_Data", "Server", "SPT.Core.dll"),
            Path.Combine(dir, "SPT_Data", "Server", "SPT.Server.dll"),
            Path.Combine(dir, "SPT.Core.dll"),
        };

        foreach (string path in candidates)
        {
            try
            {
                if (!File.Exists(path)) continue;
                FileVersionInfo info = FileVersionInfo.GetVersionInfo(path);
                string? raw = info.ProductVersion ?? info.FileVersion;
                if (string.IsNullOrWhiteSpace(raw)) continue;

                string? parsed = ExtractSemver(raw);
                if (parsed is not null) return parsed;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException) { }
        }
        return null;
    }

    private static string? ExtractSemver(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var match = System.Text.RegularExpressions.Regex.Match(raw, @"\d+\.\d+(?:\.\d+)?");
        return match.Success ? match.Value : null;
    }

    // ------------------------------------------------------------- install pipeline

    public async Task<InstallResult> InstallAsync(
        Mod mod,
        string sptDirectory,
        string? sptVersion,
        IProgress<InstallProgress> progress,
        Func<DependencyPrompt, Task<DependencyPromptResult>> promptUser,
        CancellationToken cancellationToken)
    {
        try
        {
            // (1) Directory validation -------------------------------------------------
            progress.Report(new InstallProgress(InstallStage.Validating, "Validating SPT directory…", -1));
            if (string.IsNullOrWhiteSpace(sptDirectory) || !Directory.Exists(sptDirectory))
                return new InstallResult(false, "The selected SPT directory no longer exists. Please set it again.");

            // (2) Resolve the release to install ----------------------------------------
            progress.Report(new InstallProgress(InstallStage.Resolving, $"Fetching versions for “{mod.DisplayName}”…", -1));
            List<ModVersion> versions = await _api.GetVersionsAsync(mod.Id, cancellationToken).ConfigureAwait(false);
            if (versions.Count == 0)
                return new InstallResult(false, $"“{mod.DisplayName}” has no published versions.");

            VersionSelector.Selection? selection = VersionSelector.PickBest(versions, sptVersion);
            if (selection is null)
                return new InstallResult(false, $"No downloadable release found for “{mod.DisplayName}”.");

            ModVersion target = selection.Version;
            string targetLabel = $"{mod.DisplayName} {target.Version}";
            if (!selection.CompatibleWithSpt && !string.IsNullOrWhiteSpace(sptVersion))
                targetLabel += $" (⚠ no release declares SPT {sptVersion} support — installing latest anyway)";

            // (3) Dependency check -------------------------------------------------------
            progress.Report(new InstallProgress(InstallStage.Dependencies, "Checking dependencies…", -1));
            string dependencyWarning = string.Empty;
            DependencyPlan plan;
            string? sptForDeps = ResolveSptVersionForDependencies(sptVersion, target.SptVersionConstraint);

            if (sptForDeps is null)
            {
                plan = new DependencyPlan();
                dependencyWarning = "Dependency check skipped — SPT version unknown (set it in the top bar to enable dependency resolution). ";
            }
            else
            {
                try
                {
                    plan = await BuildDependencyPlanAsync(mod.Id, target.Version, sptForDeps, sptDirectory, cancellationToken).ConfigureAwait(false);
                }
                catch (ApiException ex) when (ex.Message.Contains("SPT version", StringComparison.OrdinalIgnoreCase))
                {
                    // The API rejected the supplied SPT version — fall back to the version
                    // referenced by this release's own constraint, then give up gracefully.
                    string? fallback = DeriveVersionFromConstraint(target.SptVersionConstraint);
                    plan = new DependencyPlan();
                    dependencyWarning = $"Dependency check skipped — the API does not recognize SPT version “{sptForDeps}”. ";

                    if (fallback is not null && fallback != sptForDeps)
                    {
                        try
                        {
                            plan = await BuildDependencyPlanAsync(mod.Id, target.Version, fallback, sptDirectory, cancellationToken).ConfigureAwait(false);
                            dependencyWarning = string.Empty;
                        }
                        catch (ApiException) { }
                    }
                }
            }

            if (plan.Missing.Count > 0 || plan.Unresolved.Count > 0 || plan.Conflicts.Count > 0)
            {
                var prompt = new DependencyPrompt(mod.DisplayName, target.Version, plan.Missing, plan.Conflicts, plan.Unresolved, dependencyWarning);
                DependencyPromptResult decision = await promptUser(prompt).ConfigureAwait(false);

                if (decision == DependencyPromptResult.Cancel)
                    return new InstallResult(false, "Installation cancelled by user.");

                if (decision == DependencyPromptResult.InstallWithDeps)
                {
                    // Install dependencies first, deepest first (plan.InstallQueue is already in that order).
                    foreach (ResolvedDependency dep in plan.InstallQueue)
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                        await DownloadExtractRecordAsync(dep.Id, dep.Name, dep.Version, dep.Url, dep.Size, sptDirectory, progress, cancellationToken).ConfigureAwait(false);
                    }
                }
            }

            // (4-6) Download, extract, cleanup for the target mod -------------------------
            await DownloadExtractRecordAsync(mod.Id, mod.DisplayName, target.Version, target.Link!, target.ContentLength, sptDirectory, progress, cancellationToken).ConfigureAwait(false);

            string suffix = plan.InstallQueue.Count > 0 ? $" (+{plan.InstallQueue.Count} dependencies)" : "";
            return new InstallResult(true, $"{dependencyWarning}{targetLabel} installed{suffix}.", target.Version);
        }
        catch (OperationCanceledException)
        {
            return new InstallResult(false, "Installation cancelled.");
        }
        catch (InvalidDataException ex)
        {
            return new InstallResult(false, ex.Message);
        }
        catch (Exception ex)
        {
            return new InstallResult(false, $"{ex.GetType().Name}: {ex.Message}");
        }
    }

    // ------------------------------------------------------------- local archive installs

    /// <summary>
    /// Installs a locally selected mod archive (.zip / .rar / .7z) into the SPT root — no download,
    /// no temp copy; the picked file is read directly. Layout handling, overwrite and byte-accurate
    /// extraction progress are identical to catalog installs.
    /// </summary>
    public async Task<InstallResult> InstallLocalArchiveAsync(
        string archivePath, string sptDirectory, IProgress<InstallProgress> progress, CancellationToken cancellationToken)
    {
        string fileName = Path.GetFileName(archivePath);
        string displayName = Path.GetFileNameWithoutExtension(archivePath);
        ArchiveKind kind = ArchiveKind.Unknown;
        try
        {
            if (string.IsNullOrWhiteSpace(sptDirectory) || !Directory.Exists(sptDirectory))
                return new InstallResult(false, "The selected SPT directory no longer exists. Please set it again.");
            if (!File.Exists(archivePath))
                return new InstallResult(false, $"The file no longer exists: {archivePath}");

            progress.Report(new InstallProgress(InstallStage.Validating, $"Inspecting {fileName}…", -1));
            kind = ArchiveExtractor.DetectWithExtensionFallback(archivePath);
            if (kind is ArchiveKind.Html or ArchiveKind.Unknown)
                return new InstallResult(false,
                    $"“{fileName}” is not a recognized mod archive — supported formats are .zip, .rar and .7z.");

            var extractionProgress = new SyncProgress<double>(percent =>
                progress.Report(new InstallProgress(InstallStage.Extracting,
                    $"Extracting {displayName}… {percent:F0}%", Math.Clamp(percent, 0, 100), BytesText: $"{percent:F0}%")));

            progress.Report(new InstallProgress(InstallStage.Extracting, $"Extracting {displayName} into {sptDirectory}…", -1));
            await ExtractDownloadedArchiveAsync(archivePath, sptDirectory, displayName, extractionProgress, kind)
                .ConfigureAwait(false);

            return new InstallResult(true, $"{displayName} installed from local archive.", null);
        }
        catch (OperationCanceledException)
        {
            return new InstallResult(false, "Installation cancelled.");
        }
        catch (InvalidDataException)
        {
            return new InstallResult(false,
                $"“{fileName}” could not be opened as a {ArchiveExtensionFor(kind)} archive — the file is corrupt or incomplete.");
        }
        catch (Exception ex)
        {
            return new InstallResult(false, $"{ex.GetType().Name}: {ex.Message}");
        }
    }

    private static string ArchiveExtensionFor(ArchiveKind kind) => kind switch
    {
        ArchiveKind.Zip => ".zip",
        ArchiveKind.Rar => ".rar",
        ArchiveKind.SevenZip => ".7z",
        _ => "archive"
    };

    /// <summary>
    /// Startup hygiene: removes leftover artifacts from previous runs that crashed or were closed
    /// mid-extraction (staging mirrors, .part files, orphaned update packages). Deliberately
    /// CONSERVATIVE — it never touches arbitrary .zip/.rar/.7z files in the temp root, because
    /// other programs may legitimately be using those. The full archive purge is the
    /// user-initiated "Clear Temp Files" action (ClearLeftoverTempArchives).
    /// </summary>
    public static void SweepStaleTempFiles()
    {
        try
        {
            string temp = Path.GetTempPath();

            foreach (string dir in Directory.EnumerateDirectories(temp, "bs-staging-*"))
                ArchiveExtractor.DeleteDirectoryRobust(dir);

            foreach (string dir in Directory.EnumerateDirectories(temp, "bs-extract-*"))
                ArchiveExtractor.DeleteDirectoryRobust(dir);

            foreach (string file in Directory.EnumerateFiles(temp, "*.update.pkg"))
                TryDeleteFile(file);

            foreach (string file in Directory.EnumerateFiles(temp, "*.zip.part"))
                TryDeleteFile(file);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Startup hygiene is best-effort.
        }
    }

    /// <summary>
    /// Deletes every leftover extraction artifact in Path.GetTempPath(): .zip/.rar/.7z archives in
    /// the temp ROOT, bs-staging-* mirrors, bs-extract-* staging folders, *.zip.part partial
    /// downloads and *.update.pkg packages.
    /// Returns (files deleted, bytes freed). Runs on the caller's thread — call from a background
    /// thread for large cleanups.
    /// </summary>
    public static (int Files, long Bytes) ClearLeftoverTempArchives()
    {
        int files = 0;
        long bytes = 0;

        try
        {
            string temp = Path.GetTempPath();

            foreach (string dir in Directory.EnumerateDirectories(temp, "bs-staging-*").Concat(Directory.EnumerateDirectories(temp, "bs-extract-*")))
            {
                try
                {
                    bytes += Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories).Sum(f => new FileInfo(f).Length);
                    ArchiveExtractor.DeleteDirectoryRobust(dir);
                    files++;
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            }

            foreach (string pattern in new[] { "*.zip", "*.rar", "*.7z", "*.update.pkg", "*.zip.part" })
            foreach (string file in Directory.EnumerateFiles(temp, pattern))
            {
                try
                {
                    bytes += new FileInfo(file).Length;
                    TryDeleteFile(file);
                    files++;
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Cleanup is best-effort.
        }

        return (files, bytes);
    }

    /// <summary>
    /// Extracts a downloaded archive into the SPT root. Purely root-structured ZIPs take the
    /// ZipFile.ExtractToDirectory(overwriteFiles: true) path; everything else seen in real
    /// sp-mod.com packages — wrapper folders like "SPT/user/mods/…", backslash separators, bare
    /// payload folders, RAR/7z archives, dead links returning HTML — is handled by the
    /// layout-aware ArchiveExtractor.
    /// </summary>
    public static async Task ExtractDownloadedArchiveAsync(string archivePath, string sptRoot, string modNameForPayloadFolder,
        IProgress<double>? extractionProgress = null, ArchiveKind? kind = null)
    {
        ArchiveKind actualKind = kind ?? ArchiveExtractor.DetectWithExtensionFallback(archivePath);
        if (actualKind is ArchiveKind.Html or ArchiveKind.Unknown)
            throw new InvalidDataException(actualKind == ArchiveKind.Html
                ? "The download URL returned a web page or error payload instead of an archive (the file link is probably dead — open the mod page and download manually)."
                : "The downloaded file is not a recognized archive (zip/rar/7z).");

        // Both layouts route through the staged parallel engine: unique %TEMP% staging folder →
        // concurrent tiny-file extraction (ProcessorCount workers) + sequential large files →
        // atomic Directory.Move into the SPT root (no per-file writes through the game directory).
        await ArchiveExtractor.ExtractSmartAsync(archivePath, actualKind, sptRoot,
            payloadTargetDir: null,
            looseFolderName: SanitizeFolderName(modNameForPayloadFolder),
            progress: extractionProgress).ConfigureAwait(false);
    }

    public static string SanitizeFolderName(string name)
    {
        char[] invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string(name.Select(c => invalid.Contains(c) ? '_' : c).ToArray()).Trim();
        return cleaned.Length == 0 ? "mod" : cleaned;
    }

    private async Task DownloadExtractRecordAsync(
        int id, string name, string version, string url, long? expectedSize,
        string sptDirectory, IProgress<InstallProgress> progress, CancellationToken cancellationToken)
    {
        // (4) Download the real archive to %TEMP%\{modId}.zip with live progress ----------
        string tempZip = Path.Combine(Path.GetTempPath(), $"{id}.zip");
        try
        {
            var downloadProgress = new SyncProgress<DownloadProgress>(dp =>
            {
                double percent = dp.TotalBytes is > 0 ? Math.Clamp(100.0 * dp.BytesReceived / dp.TotalBytes.Value, 0, 100) : -1;
                string downloadedMb = (dp.BytesReceived / (1024.0 * 1024.0)).ToString("F1");
                string totalMb = dp.TotalBytes is > 0 ? $" / {(dp.TotalBytes.Value / (1024.0 * 1024.0)).ToString("F1")} MB" : " MB";
                string speed = dp.BytesPerSecond > 0 ? $"{dp.BytesPerSecond / (1024.0 * 1024.0):F2} MB/s" : "—";
                progress.Report(new InstallProgress(InstallStage.Downloading,
                    $"Downloading {name} {version}… {downloadedMb}{totalMb}", percent, speed, $"{downloadedMb}{totalMb}"));
            });

            progress.Report(new InstallProgress(InstallStage.Downloading, $"Downloading {name} {version}…", -1, null));
            long bytes = await _api.DownloadFileAsync(url, tempZip, downloadProgress, cancellationToken).ConfigureAwait(false);

            if (bytes == 0)
                throw new IOException("Download produced an empty file.");

            // Size reconciliation. The HTTP layer already guarantees the transfer completed against the
            // host's own Content-Length (verified byte-for-byte by the resume-capable downloader), so the
            // API's content_length metadata is advisory only — it can drift from the real file
            // (live-verified: metadata said 117,232,656 while the host serves 117,232,647 bytes).
            // When the numbers disagree, the ARCHIVE itself is the arbiter: an intact zip requires a
            // complete End-of-Central-Directory + central directory, so a truncated body cannot pass.
            if (expectedSize is > 0 && bytes != expectedSize.Value)
            {
                if (!await Task.Run(() => ArchiveExtractor.IsStructurallyIntactArchive(tempZip), cancellationToken).ConfigureAwait(false))
                    throw new IOException(
                        $"Incomplete download: expected {expectedSize.Value:N0} bytes but got {bytes:N0}, and the downloaded file is not a valid archive — the transfer was truncated.");
                // The archive is structurally complete; the API's size metadata is stale. Proceed.
            }

            // (5) Extract & merge into the SPT root (user/mods, BepInEx/plugins, … as archived)
            // Byte-accurate extraction progress: Σ entry.Length totals, per-entry accumulation → exact %.
            var extractionProgress = new SyncProgress<double>(percent =>
                progress.Report(new InstallProgress(InstallStage.Extracting,
                    $"Extracting {name} {version}… {percent:F0}%", Math.Clamp(percent, 0, 100),
                    BytesText: $"{percent:F0}%")));
            progress.Report(new InstallProgress(InstallStage.Extracting, $"Extracting {name} {version} into {sptDirectory}…", -1));
            await ExtractDownloadedArchiveAsync(tempZip, sptDirectory, name, extractionProgress).ConfigureAwait(false);

            // (6) Cleanup + record ---------------------------------------------------------
            progress.Report(new InstallProgress(InstallStage.Extracting, "Cleaning up temporary files…", 100));
        }
        finally
        {
            TryDeleteFile(tempZip);
            TryDeleteFile(tempZip + ".part");
        }

        _settings.RecordInstall(id, name, version);
    }

    private static void TryDeleteFile(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }

    /// <summary>
    /// Extracts a mod archive into the SPT root, merging with existing files.
    /// Primary path is ZipFile.ExtractToDirectory(overwriteFiles: true); if the archive contains
    /// read-only files (common in repacked zips) a hardened entry-by-entry merge clears the
    /// read-only attribute first. Both paths block zip-slip (entries escaping the root).
    /// </summary>
    public static void ExtractArchive(string zipPath, string destinationRoot)
    {
        try
        {
            ZipFile.ExtractToDirectory(zipPath, destinationRoot, overwriteFiles: true);
        }
        catch (UnauthorizedAccessException)
        {
            ExtractArchiveForceOverwrite(zipPath, destinationRoot);
        }
        catch (IOException ex) when (ex.InnerException is UnauthorizedAccessException)
        {
            ExtractArchiveForceOverwrite(zipPath, destinationRoot);
        }
    }

    private static void ExtractArchiveForceOverwrite(string zipPath, string destinationRoot)
    {
        string rootFull = Path.GetFullPath(destinationRoot);
        using ZipArchive archive = ZipFile.OpenRead(zipPath);

        foreach (ZipArchiveEntry entry in archive.Entries)
        {
            string destPath = Path.GetFullPath(Path.Combine(rootFull, entry.FullName));
            bool insideRoot = destPath.Equals(rootFull, StringComparison.Ordinal)
                           || destPath.StartsWith(rootFull + Path.DirectorySeparatorChar, StringComparison.Ordinal);
            if (!insideRoot)
                throw new IOException($"Blocked unsafe archive entry path: “{entry.FullName}”.");

            if (entry.FullName.EndsWith('/') || entry.FullName.EndsWith('\\'))
            {
                Directory.CreateDirectory(destPath);
                continue;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(destPath)!);
            if (File.Exists(destPath))
            {
                // Clear read-only flags, then remove the target so extraction always creates a fresh
                // file. On Unix, unlinking depends on directory permissions (not the file's own mode),
                // so this works even for archives carrying broken modes like 0010.
                try { File.SetAttributes(destPath, FileAttributes.Normal); }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or PlatformNotSupportedException) { }
                File.Delete(destPath);
            }
            entry.ExtractToFile(destPath, overwrite: true);
        }
    }

    // ------------------------------------------------- pre-queue resolution & pinned installs

    /// <summary>
    /// Resolves the dependencies of a SPECIFIC mod version against the live API and the user's SPT
    /// folder — called when the user clicks Install (before queueing), so the resolver dialog can be
    /// shown on the UI thread and dependencies queued FIRST. Mirrors the in-flight logic of
    /// InstallAsync (SPT-version reconciliation + API fallback) so both paths agree.
    /// </summary>
    public async Task<DependencyResolution> ResolveDependenciesAsync(
        Mod mod, ModVersion target, string sptDirectory, string? sptVersion, CancellationToken cancellationToken)
    {
        string? sptForDeps = ResolveSptVersionForDependencies(sptVersion, target.SptVersionConstraint);
        if (sptForDeps is null)
        {
            return new DependencyResolution(
                new DependencyPrompt(mod.DisplayName, target.Version,
                    Array.Empty<DependencyRow>(), Array.Empty<DependencyRow>(), Array.Empty<DependencyRow>(),
                    "Dependency check skipped — SPT version unknown (set it in the top bar to enable dependency resolution). "),
                Array.Empty<ResolvedDependency>());
        }

        try
        {
            DependencyPlan plan = await BuildDependencyPlanAsync(mod.Id, target.Version, sptForDeps, sptDirectory, cancellationToken).ConfigureAwait(false);
            return new DependencyResolution(
                new DependencyPrompt(mod.DisplayName, target.Version, plan.Missing, plan.Conflicts, plan.Unresolved),
                plan.InstallQueue);
        }
        catch (ApiException ex) when (ex.Message.Contains("SPT version", StringComparison.OrdinalIgnoreCase))
        {
            string? fallback = DeriveVersionFromConstraint(target.SptVersionConstraint);
            if (fallback is not null && fallback != sptForDeps)
            {
                try
                {
                    DependencyPlan plan = await BuildDependencyPlanAsync(mod.Id, target.Version, fallback, sptDirectory, cancellationToken).ConfigureAwait(false);
                    return new DependencyResolution(
                        new DependencyPrompt(mod.DisplayName, target.Version, plan.Missing, plan.Conflicts, plan.Unresolved),
                        plan.InstallQueue);
                }
                catch (ApiException) { }
            }
            return new DependencyResolution(
                new DependencyPrompt(mod.DisplayName, target.Version,
                    Array.Empty<DependencyRow>(), Array.Empty<DependencyRow>(), Array.Empty<DependencyRow>(),
                    $"Dependency check skipped — the API does not recognize SPT version “{sptForDeps}”. "),
                Array.Empty<ResolvedDependency>());
        }
    }

    /// <summary>
    /// Installs a SPECIFIC, user-picked release (from the version selection modal) — no version
    /// resolution and no dependency prompt: the dependency decision was already made before
    /// queueing, and any dependencies chosen for installation were queued ahead of this task.
    /// </summary>
    public async Task<InstallResult> InstallVersionAsync(
        Mod mod, ModVersion target, string sptDirectory,
        IProgress<InstallProgress> progress, CancellationToken cancellationToken)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(sptDirectory) || !Directory.Exists(sptDirectory))
                return new InstallResult(false, "The selected SPT directory no longer exists. Please set it again.");
            if (string.IsNullOrWhiteSpace(target.Link))
                return new InstallResult(false, $"Version {target.Version} of “{mod.DisplayName}” has no downloadable file.");

            await DownloadExtractRecordAsync(mod.Id, mod.DisplayName, target.Version, target.Link, target.ContentLength,
                sptDirectory, progress, cancellationToken).ConfigureAwait(false);
            return new InstallResult(true, $"{mod.DisplayName} {target.Version} installed.", target.Version);
        }
        catch (OperationCanceledException)
        {
            return new InstallResult(false, "Installation cancelled.");
        }
        catch (InvalidDataException ex)
        {
            return new InstallResult(false, ex.Message);
        }
        catch (Exception ex)
        {
            return new InstallResult(false, $"{ex.GetType().Name}: {ex.Message}");
        }
    }

    /// <summary>Installs one pre-resolved dependency (known id/name/version/url) — used when the
    /// resolver queues dependencies ahead of the requested mod.</summary>
    public async Task<InstallResult> InstallResolvedAsync(
        ResolvedDependency dep, string sptDirectory,
        IProgress<InstallProgress> progress, CancellationToken cancellationToken)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(sptDirectory) || !Directory.Exists(sptDirectory))
                return new InstallResult(false, "The selected SPT directory no longer exists. Please set it again.");

            await DownloadExtractRecordAsync(dep.Id, dep.Name, dep.Version, dep.Url, dep.Size,
                sptDirectory, progress, cancellationToken).ConfigureAwait(false);
            return new InstallResult(true, $"{dep.Name} {dep.Version} installed.", dep.Version);
        }
        catch (OperationCanceledException)
        {
            return new InstallResult(false, "Installation cancelled.");
        }
        catch (InvalidDataException ex)
        {
            return new InstallResult(false, ex.Message);
        }
        catch (Exception ex)
        {
            return new InstallResult(false, $"{ex.GetType().Name}: {ex.Message}");
        }
    }

    // ------------------------------------------------------------ dependency engine

    /// <summary>A dependency the API (or our own fallback resolver) resolved to a concrete,
    /// downloadable release — ready to be queued ahead of the mod that needs it.</summary>
    public sealed class ResolvedDependency
    {
        public required int Id { get; init; }
        public required string Name { get; init; }
        public required string PackageId { get; init; }
        public required string Version { get; init; }
        public required string Url { get; init; }
        public long? Size { get; init; }
        public bool Conflict { get; init; }
    }

    public sealed class DependencyPlan
    {
        public List<DependencyRow> Missing { get; } = new();
        public List<DependencyRow> Conflicts { get; } = new();
        public List<DependencyRow> Unresolved { get; } = new();
        public List<ResolvedDependency> InstallQueue { get; } = new();
    }

    private async Task<DependencyPlan> BuildDependencyPlanAsync(
        int modId, string modVersion, string sptVersion, string sptDirectory, CancellationToken cancellationToken)
    {
        var plan = new DependencyPlan();

        Dictionary<string, List<DependencyInfo>> response =
            await _api.GetDependenciesAsync(new[] { (modId, modVersion) }, sptVersion, cancellationToken).ConfigureAwait(false);

        if (!response.TryGetValue($"{modId}:{modVersion}", out List<DependencyInfo>? deps))
            return plan;

        // Flatten the dependency tree depth-first (post-order → deepest dependencies first).
        var flat = new List<DependencyInfo>();
        var seen = new HashSet<int>();
        void Flatten(DependencyInfo d)
        {
            if (!seen.Add(d.Id)) return;
            if (d.Dependencies is { Count: > 0 })
                foreach (DependencyInfo child in d.Dependencies) Flatten(child);
            flat.Add(d);
        }
        foreach (DependencyInfo d in deps) Flatten(d);

        foreach (DependencyInfo dep in flat)
        {
            if (dep.Conflict)
            {
                plan.Conflicts.Add(new DependencyRow(dep.DisplayName, dep.PackageId, null, false, true));
                continue;
            }

            if (IsInstalledLocally(dep, sptDirectory))
                continue;

            // Prefer the server-resolved compatible version…
            if (dep.LatestCompatibleVersion is { Link: not null } lcv && !string.IsNullOrWhiteSpace(lcv.Link))
            {
                var resolved = new ResolvedDependency
                {
                    Id = dep.Id,
                    Name = dep.DisplayName,
                    PackageId = dep.PackageId,
                    Version = lcv.Version ?? "latest",
                    Url = lcv.Link!,
                    Size = lcv.ContentLength
                };
                plan.InstallQueue.Add(resolved);
                plan.Missing.Add(new DependencyRow(resolved.Name, resolved.PackageId, resolved.Version, true, false));
                continue;
            }

            // …otherwise resolve the newest release ourselves.
            try
            {
                List<ModVersion> depVersions = await _api.GetVersionsAsync(dep.Id, cancellationToken).ConfigureAwait(false);
                VersionSelector.Selection? sel = VersionSelector.PickBest(depVersions, sptVersion);
                if (sel is not null)
                {
                    var resolved = new ResolvedDependency
                    {
                        Id = dep.Id,
                        Name = dep.DisplayName,
                        PackageId = dep.PackageId,
                        Version = sel.Version.Version,
                        Url = sel.Version.Link!,
                        Size = sel.Version.ContentLength
                    };
                    plan.InstallQueue.Add(resolved);
                    plan.Missing.Add(new DependencyRow(resolved.Name, resolved.PackageId, resolved.Version, true, false));
                    continue;
                }
            }
            catch (Exception ex) when (ex is ApiException or HttpRequestException
                                       || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested))
            {
                // fall through to unresolved
            }

            plan.Unresolved.Add(new DependencyRow(dep.DisplayName, dep.PackageId, null, false, false));
        }

        return plan;
    }

    /// <summary>
    /// Determines which SPT version to send to GET /mods/dependencies:
    /// the user's version when it parses, otherwise the version referenced by the
    /// target release's own spt_version_constraint. Null when neither is available.
    /// </summary>
    private static string? ResolveSptVersionForDependencies(string? userSptVersion, string? constraint)
    {
        if (!string.IsNullOrWhiteSpace(userSptVersion) && SemVersion.TryParse(userSptVersion, out _))
            return userSptVersion.Trim();
        return DeriveVersionFromConstraint(constraint);
    }

    private static string? DeriveVersionFromConstraint(string? constraint)
    {
        if (string.IsNullOrWhiteSpace(constraint)) return null;
        var match = System.Text.RegularExpressions.Regex.Match(constraint, @"\d+\.\d+(?:\.\d+)?");
        return match.Success ? match.Value : null;
    }

    /// <summary>
    /// Real filesystem check: was this dependency installed before?
    /// Looks at our own install records and scans user\mods and BepInEx\plugins (up to 3 levels)
    /// for a folder/DLL whose name matches the dependency's GUID, slug or name.
    /// </summary>
    private bool IsInstalledLocally(DependencyInfo dep, string sptDirectory)
    {
        if (_settings.Settings.InstalledMods.ContainsKey(dep.Id)) return true;

        var candidates = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void Add(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return;
            candidates.Add(value.Trim());
            int lastDot = value.LastIndexOf('.');
            if (lastDot >= 0 && lastDot < value.Length - 1) candidates.Add(value[(lastDot + 1)..]);
        }
        Add(dep.Guid);
        Add(dep.Slug);
        Add(dep.Name);

        if (candidates.Count == 0) return false;

        string[] roots =
        {
            Path.Combine(sptDirectory, "user", "mods"),
            Path.Combine(sptDirectory, "BepInEx", "plugins")
        };

        foreach (string root in roots)
        {
            if (!Directory.Exists(root)) continue;
            try
            {
                foreach (string dir in EnumerateDirectoriesLimited(root, 3))
                    if (candidates.Contains(Path.GetFileName(dir))) return true;

                foreach (string file in Directory.EnumerateFiles(root, "*", new EnumerationOptions
                         { RecurseSubdirectories = true, IgnoreInaccessible = true, MaxRecursionDepth = 3 }))
                {
                    string baseName = Path.GetFileNameWithoutExtension(file);
                    if (candidates.Contains(baseName)) return true;
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }
        return false;
    }

    private static IEnumerable<string> EnumerateDirectoriesLimited(string root, int maxDepth)
    {
        var queue = new Queue<(string Path, int Depth)>();
        queue.Enqueue((root, 0));
        while (queue.Count > 0)
        {
            var (path, depth) = queue.Dequeue();
            IEnumerable<string> children;
            try { children = Directory.EnumerateDirectories(path); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { continue; }

            foreach (string child in children)
            {
                yield return child;
                if (depth + 1 < maxDepth) queue.Enqueue((child, depth + 1));
            }
        }
    }
}
