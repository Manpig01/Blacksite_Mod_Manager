using System.IO;
using System.Net.Http;
using Blacksite.Models;

namespace Blacksite.Services;

public sealed record UpdateActionResult(bool Success, string Message);

/// <summary>
/// Real on-disk management of installed mods: enable/disable via the ".disabled" rename
/// convention, recursive uninstall, live update checks through GET /mods/updates and
/// 1-click updates (download → replace the mod's directory → rescan).
/// </summary>
public sealed class InstalledModsService
{
    private const string DisabledSuffix = ".disabled";
    private readonly SpModApiClient _api;
    private readonly SettingsService _settings;

    public InstalledModsService(SpModApiClient api, SettingsService settings)
    {
        _api = api;
        _settings = settings;
    }

    // ------------------------------------------------------------------ enable / disable

    /// <summary>
    /// Disabling appends ".disabled" to the mod's folder/file name so SPT/BepInEx skip it;
    /// enabling renames it back. Both are real filesystem moves.
    /// </summary>
    public void SetEnabled(InstalledModInfo mod, bool enable)
    {
        string current = mod.InstallPath;
        if (!File.Exists(current) && !Directory.Exists(current))
            throw new FileNotFoundException($"“{mod.DisplayName}” was not found at {current}. Run a rescan.");

        string target = enable
            ? (current.EndsWith(DisabledSuffix, StringComparison.OrdinalIgnoreCase) ? current[..^DisabledSuffix.Length] : current)
            : (current.EndsWith(DisabledSuffix, StringComparison.OrdinalIgnoreCase) ? current : current + DisabledSuffix);

        if (string.Equals(target, current, StringComparison.Ordinal)) return; // already in requested state
        if (File.Exists(target) || Directory.Exists(target))
            throw new IOException($"Cannot rename — “{Path.GetFileName(target)}” already exists next to it.");

        if (Directory.Exists(current)) Directory.Move(current, target);
        else File.Move(current, target);
    }

    // ------------------------------------------------------------------ uninstall

    /// <summary>Recursively deletes the mod's folder, or removes its single file.</summary>
    public void Uninstall(InstalledModInfo mod)
    {
        string path = mod.InstallPath;
        if (!IsInsideManagedArea(path))
            throw new UnauthorizedAccessException($"Refusing to delete “{path}” — it is not inside user\\mods or BepInEx\\plugins.");

        if (Directory.Exists(path)) ArchiveExtractor.DeleteDirectoryRobust(path);
        else if (File.Exists(path)) ArchiveExtractor.DeleteFileRobust(path);
        else throw new FileNotFoundException($"“{mod.DisplayName}” was not found at {path}.");

        // Keep the manager's own install records honest.
        RemoveInstallRecord(mod);
    }

    private void RemoveInstallRecord(InstalledModInfo mod)
    {
        var records = _settings.Settings.InstalledMods;
        List<int>? removals = null;
        foreach (var (id, record) in records)
        {
            bool nameMatch = !string.IsNullOrWhiteSpace(record.Name) &&
                             (record.Name.Equals(mod.DisplayName, StringComparison.OrdinalIgnoreCase) ||
                              record.Name.Equals(mod.PackageId, StringComparison.OrdinalIgnoreCase));
            if (nameMatch) (removals ??= new List<int>()).Add(id);
        }
        if (removals is not null)
        {
            foreach (int id in removals) records.Remove(id);
            _settings.Save();
        }
    }

    private static bool IsInsideManagedArea(string path)
    {
        string full = Path.GetFullPath(path);
        string parent = Path.GetFullPath(Path.GetDirectoryName(full) ?? string.Empty);
        string parentName = Path.GetFileName(parent);
        string grandParentName = Path.GetFileName(Path.GetDirectoryName(parent) ?? string.Empty);

        // user\mods\<x>  → parent = "mods", grandparent = "user"
        // BepInEx\plugins\<x> → parent = "plugins", grandparent = "BepInEx"
        return (parentName.Equals("mods", StringComparison.OrdinalIgnoreCase) && grandParentName.Equals("user", StringComparison.OrdinalIgnoreCase))
            || (parentName.Equals("plugins", StringComparison.OrdinalIgnoreCase) && grandParentName.Equals("BepInEx", StringComparison.OrdinalIgnoreCase));
    }

    // ------------------------------------------------------------------ update check

    /// <summary>
    /// Live update check: sends every installed mod that has an identifier + version to
    /// GET /mods/updates and maps the server's report back onto the local rows.
    /// </summary>
    public async Task<Dictionary<string, UpdateCheckOutcome>> CheckUpdatesAsync(
        IReadOnlyList<(InstalledModInfo Mod, string Identifier)> rows,
        string sptVersion,
        CancellationToken cancellationToken)
    {
        var results = new Dictionary<string, UpdateCheckOutcome>(StringComparer.OrdinalIgnoreCase);

        var payload = rows
            .Where(r => !string.IsNullOrWhiteSpace(r.Mod.Version))
            .Select(r => (Identifier: r.Identifier, Version: r.Mod.Version!))
            .DistinctBy(p => (p.Identifier, p.Version))
            .ToList();

        if (payload.Count == 0) return results;

        UpdatesData data = await _api.GetUpdatesAsync(payload, sptVersion, cancellationToken).ConfigureAwait(false);

        InstalledModInfo? FindRow(CurrentVersionInfo? current)
        {
            if (current is null) return null;
            foreach (var (mod, identifier) in rows)
            {
                if (current.ModId is { } modId && int.TryParse(identifier, out int numericId) && numericId == modId)
                    return mod;
                if (!string.IsNullOrEmpty(current.Guid) &&
                    (identifier.Equals(current.Guid, StringComparison.OrdinalIgnoreCase) ||
                     (mod.PackageId?.Equals(current.Guid, StringComparison.OrdinalIgnoreCase) ?? false)))
                    return mod;
            }
            return null;
        }

        if (data.Updates is not null)
            foreach (UpdateEntry entry in data.Updates)
            {
                InstalledModInfo? row = FindRow(entry.CurrentVersion);
                if (row is null || entry.RecommendedVersion?.Link is null) continue;
                results[row.IdentityKey] = new UpdateCheckOutcome
                {
                    Status = UpdateStatus.UpdateAvailable,
                    NewVersion = entry.RecommendedVersion.Version,
                    Link = entry.RecommendedVersion.Link,
                    ContentLength = entry.RecommendedVersion.ContentLength,
                    Reason = entry.UpdateReason ?? entry.Reason,
                    CatalogModId = entry.CurrentVersion?.ModId
                };
            }

        if (data.UpToDate is not null)
            foreach (CurrentVersionInfo current in data.UpToDate)
            {
                InstalledModInfo? row = FindRow(current);
                if (row is not null && !results.ContainsKey(row.IdentityKey))
                    results[row.IdentityKey] = new UpdateCheckOutcome { Status = UpdateStatus.UpToDate, CatalogModId = current.ModId };
            }

        if (data.IncompatibleWithSpt is not null)
            foreach (IncompatibleEntry entry in data.IncompatibleWithSpt)
            {
                InstalledModInfo? row = FindRow(new CurrentVersionInfo { ModId = entry.ModId, Guid = entry.Guid });
                if (row is null) continue;
                results[row.IdentityKey] = new UpdateCheckOutcome
                {
                    Status = UpdateStatus.Incompatible,
                    Reason = entry.Reason,
                    NewVersion = entry.LatestCompatibleVersion?.Version,
                    Link = entry.LatestCompatibleVersion?.Link,
                    ContentLength = entry.LatestCompatibleVersion?.ContentLength,
                    CatalogModId = entry.ModId
                };
            }

        if (data.BlockedUpdates is not null)
            foreach (UpdateEntry entry in data.BlockedUpdates)
            {
                InstalledModInfo? row = FindRow(entry.CurrentVersion);
                if (row is null) continue;
                results[row.IdentityKey] = new UpdateCheckOutcome
                {
                    Status = UpdateStatus.Blocked,
                    Reason = entry.Reason ?? entry.UpdateReason,
                    CatalogModId = entry.CurrentVersion?.ModId
                };
            }

        return results;
    }

    // ------------------------------------------------------------------ 1-click update

    /// <summary>
    /// Downloads the recommended archive to %TEMP%, replaces the mod's existing directory
    /// inside user\mods or BepInEx\plugins (handling wrapper folders, bare payloads and
    /// zip/rar/7z formats) and cleans up the temp file.
    /// </summary>
    public async Task<UpdateActionResult> UpdateAsync(
        InstalledModInfo mod,
        string downloadUrl,
        long? expectedSize,
        string sptRoot,
        IProgress<InstallProgress> progress,
        CancellationToken cancellationToken,
        string? newVersion = null)
    {
        string tempName = SanitizeFileName(mod.PackageId ?? mod.DisplayName);
        string tempPath = Path.Combine(Path.GetTempPath(), $"{tempName}.update.pkg");

        try
        {
            var downloadProgress = new SyncProgress<DownloadProgress>(dp =>
            {
                double percent = dp.TotalBytes is > 0 ? Math.Clamp(100.0 * dp.BytesReceived / dp.TotalBytes.Value, 0, 100) : -1;
                string speed = dp.BytesPerSecond > 0 ? $"{dp.BytesPerSecond / (1024.0 * 1024.0):F2} MB/s" : "—";
                progress.Report(new InstallProgress(InstallStage.Downloading,
                    $"Updating {mod.DisplayName} → {dp.BytesReceived / (1024.0 * 1024.0):F1} MB", percent, speed));
            });

            string versionLabel = string.IsNullOrWhiteSpace(newVersion) ? string.Empty : $" → v{newVersion}";
            progress.Report(new InstallProgress(InstallStage.Downloading, $"Downloading update for {mod.DisplayName}{versionLabel}…", -1));
            long bytes = await _api.DownloadFileAsync(downloadUrl, tempPath, downloadProgress, cancellationToken).ConfigureAwait(false);

            if (bytes == 0)
                return new UpdateActionResult(false, "Download produced an empty file.");

            ArchiveKind kind = ArchiveExtractor.Detect(tempPath);
            if (kind is ArchiveKind.Html or ArchiveKind.Unknown)
                return new UpdateActionResult(false, kind == ArchiveKind.Html
                    ? "The download URL returned a web page or error payload instead of an archive — the file link is probably dead. Open the mod page (🌐) and download manually."
                    : "The downloaded file is not a recognized archive (zip/rar/7z).");

            // Size reconciliation: the HTTP layer already guarantees the transfer against the host's own
            // Content-Length; the API's content_length metadata can drift (live-verified 9-byte drift),
            // so on mismatch the archive's structural integrity is the arbiter, not the stale number.
            if (expectedSize is > 0 && bytes != expectedSize.Value &&
                !await Task.Run(() => ArchiveExtractor.IsStructurallyIntactArchive(tempPath), cancellationToken).ConfigureAwait(false))
            {
                return new UpdateActionResult(false,
                    $"Incomplete download: expected {expectedSize.Value:N0} bytes, got {bytes:N0} — the transfer was truncated.");
            }

            // Byte-accurate extraction progress (Σ entry sizes → exact %) for the staged replace.
            var extractionProgress = new SyncProgress<double>(percent =>
                progress.Report(new InstallProgress(InstallStage.Extracting,
                    $"Replacing {mod.DisplayName} files… {percent:F0}%", Math.Clamp(percent, 0, 100))));

            progress.Report(new InstallProgress(InstallStage.Extracting, $"Replacing {mod.DisplayName} files…", -1));
            await ReplaceModFilesAsync(mod, tempPath, kind, sptRoot, extractionProgress).ConfigureAwait(false);

            return new UpdateActionResult(true, $"{mod.DisplayName} updated.");
        }
        catch (OperationCanceledException)
        {
            return new UpdateActionResult(false, "Update cancelled.");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidDataException or ApiException or HttpRequestException)
        {
            return new UpdateActionResult(false, $"{ex.GetType().Name}: {ex.Message}");
        }
        finally
        {
            TryDelete(tempPath);
            TryDelete(tempPath + ".part");
        }
    }

    private static async Task ReplaceModFilesAsync(InstalledModInfo mod, string archivePath, ArchiveKind kind, string sptRoot,
        IProgress<double>? extractionProgress = null)
    {
        string oldPath = mod.InstallPath;
        if (!ArchiveExtractor.IsPathInside(mod.ParentDirectory, oldPath))
            throw new UnauthorizedAccessException($"Refusing to replace “{oldPath}” — outside of the managed mod folders.");

        var layout = ArchiveExtractor.Analyze(archivePath, kind);

        string oldLogicalName = Path.GetFileName(oldPath);
        if (oldLogicalName.EndsWith(DisabledSuffix, StringComparison.OrdinalIgnoreCase))
            oldLogicalName = oldLogicalName[..^DisabledSuffix.Length];

        // 1) Extract into a staging mirror of the SPT layout FIRST — if anything goes wrong here,
        //    the existing installation is never touched.
        string staging = Path.Combine(Path.GetTempPath(),
            "bs-staging-" + SanitizeFileName(mod.DisplayName) + "-" + Guid.NewGuid().ToString("N")[..8]);
        try
        {
            var settings = SettingsService.Instance;
            string kindRelativeParent = mod.Kind == InstalledModKind.Server
                ? settings?.ServerModPathEffective ?? "user/mods"
                : settings?.ClientModPathEffective ?? "BepInEx/plugins";
            string stagingPayloadTarget = Path.Combine(staging, kindRelativeParent);
            Directory.CreateDirectory(stagingPayloadTarget);

            await ArchiveExtractor.ExtractSmartAsync(archivePath, kind, staging,
                payloadTargetDir: stagingPayloadTarget,
                looseFolderName: mod.IsDirectory ? oldLogicalName : null,
                layout: layout,
                progress: extractionProgress).ConfigureAwait(false);

            // 2) Swap: remove the old installation, then merge the staged tree into the real root.
            if (Directory.Exists(oldPath)) ArchiveExtractor.DeleteDirectoryRobust(oldPath);
            else if (File.Exists(oldPath)) ArchiveExtractor.DeleteFileRobust(oldPath);

            ArchiveExtractor.CopyDirectoryMerge(staging, sptRoot);
        }
        finally
        {
            try { if (Directory.Exists(staging)) Directory.Delete(staging, recursive: true); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }

        // 3) Keep the disabled state across the update.
        if (mod.IsDisabled)
        {
            string? newTop = layout.PayloadTopFolder ?? (mod.IsDirectory ? oldLogicalName : null);
            if (newTop is not null)
            {
                string fresh = Path.Combine(mod.ParentDirectory, newTop);
                if (Directory.Exists(fresh) && !fresh.EndsWith(DisabledSuffix, StringComparison.OrdinalIgnoreCase))
                {
                    string renamed = fresh + DisabledSuffix;
                    if (!Directory.Exists(renamed)) Directory.Move(fresh, renamed);
                }
            }
            else if (!mod.IsDirectory)
            {
                string freshFile = Path.Combine(mod.ParentDirectory, oldLogicalName);
                if (File.Exists(freshFile)) File.Move(freshFile, freshFile + DisabledSuffix);
            }
        }
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }

    private static string SanitizeFileName(string name)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string(name.Select(c => invalid.Contains(c) ? '_' : c).ToArray());
        return cleaned.Length > 80 ? cleaned[..80] : cleaned;
    }
}
