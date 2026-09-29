using System.IO;
using System.Net.Http;
using Blacksite.Models;
using Blacksite.Services.Extraction;

namespace Blacksite.Services;

public sealed record UpdateActionResult(bool Success, string Message, string? VerifiedVersion = null);

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
        // A consolidated card carries BOTH components — enable/disable acts on every path.
        foreach (InstalledModInfo component in mod.Components ?? new[] { mod })
        {
            string current = component.InstallPath;
            if (!File.Exists(current) && !Directory.Exists(current))
                throw new FileNotFoundException($"“{component.DisplayName}” was not found at {current}. Run a rescan.");

            string target = enable
                ? (current.EndsWith(DisabledSuffix, StringComparison.OrdinalIgnoreCase) ? current[..^DisabledSuffix.Length] : current)
                : (current.EndsWith(DisabledSuffix, StringComparison.OrdinalIgnoreCase) ? current : current + DisabledSuffix);

            if (string.Equals(target, current, StringComparison.Ordinal)) continue; // already in requested state
            if (File.Exists(target) || Directory.Exists(target))
                throw new IOException($"Cannot rename — “{Path.GetFileName(target)}” already exists next to it.");

            if (Directory.Exists(current)) Directory.Move(current, target);
            else File.Move(current, target);
        }
    }

    // ------------------------------------------------------------------ uninstall

    /// <summary>Recursively deletes the mod's folder, or removes its single file.</summary>
    public void Uninstall(InstalledModInfo mod)
    {
        // A consolidated card carries BOTH components — uninstall removes every path.
        foreach (InstalledModInfo component in mod.Components ?? new[] { mod })
        {
            string path = component.InstallPath;
            if (!IsInsideManagedArea(path))
                throw new UnauthorizedAccessException($"Refusing to delete “{path}” — it is not inside user\\mods or BepInEx\\plugins.");

            if (Directory.Exists(path)) ArchiveExtractor.DeleteDirectoryRobust(path);
            else if (File.Exists(path)) ArchiveExtractor.DeleteFileRobust(path);
            else throw new FileNotFoundException($"“{component.DisplayName}” was not found at {path}.");
        }

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

    // ------------------------------------------------------------------ component consolidation

    /// <summary>
    /// Consolidates raw scanner rows into display cards: the client and server halves of ONE
    /// mod (e.g. BepInEx\plugins\Tyfon.WeaponCustomizer + user\mods\Tyfon.WeaponCustomizer.Server)
    /// render as a SINGLE card instead of two. Grouping keys, in order:
    ///   1. the Forge catalog mod id, when the caller's bridge resolves a row to one (the
    ///      authoritative key — different guids/folders still merge when the catalog says so);
    ///   2. a fuzzy author/name match for unmanaged mods: the identity (PackageId or display
    ///      name) with one trailing ".server"/".client"/"-server"/"-client" component suffix
    ///      stripped — and ONLY across kinds, so two distinct server mods with similar names
    ///      never merge.
    /// The merged row carries <see cref="InstalledModInfo.Components"/> (every piece, primary
    /// first — the server half, which owns the package.json identity and version), plus
    /// HasServerMod/HasClientPlugin/ServerPath/ClientPath. Uninstall/Disable/Update act on all
    /// components. The raw scan itself stays untouched (it is the disk truth).
    /// </summary>
    public static List<InstalledModInfo> ConsolidateComponents(
        IReadOnlyList<InstalledModInfo> scanned,
        Func<InstalledModInfo, int?>? catalogModId = null)
    {
        if (scanned.Count <= 1) return scanned.ToList();

        var groups = new List<List<InstalledModInfo>>();
        var unbridged = new List<InstalledModInfo>();
        var byCatalogId = new Dictionary<int, List<InstalledModInfo>>();
        foreach (InstalledModInfo row in scanned)
        {
            int? id = null;
            try { id = catalogModId?.Invoke(row); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException) { }
            if (id is int catalogId)
            {
                if (!byCatalogId.TryGetValue(catalogId, out List<InstalledModInfo>? bucket))
                    byCatalogId[catalogId] = bucket = new List<InstalledModInfo>();
                bucket.Add(row);
            }
            else
            {
                unbridged.Add(row);
            }
        }
        groups.AddRange(byCatalogId.Values.Where(b => b.Count > 0));

        // Fuzzy pass over the rows the catalog could not place.
        var byFuzzyKey = new Dictionary<string, List<InstalledModInfo>>(StringComparer.OrdinalIgnoreCase);
        foreach (InstalledModInfo row in unbridged)
        {
            string key = FuzzyComponentKey(row);
            if (!byFuzzyKey.TryGetValue(key, out List<InstalledModInfo>? bucket))
                byFuzzyKey[key] = bucket = new List<InstalledModInfo>();
            bucket.Add(row);
        }
        foreach (List<InstalledModInfo> bucket in byFuzzyKey.Values)
        {
            bool hasServer = bucket.Any(r => r.Kind == InstalledModKind.Server);
            bool hasClient = bucket.Any(r => r.Kind == InstalledModKind.Client);
            if (bucket.Count > 1 && hasServer && hasClient)
                groups.Add(bucket); // cross-kind components of one mod → one card
            else
                groups.AddRange(bucket.Select(r => new List<InstalledModInfo> { r })); // lookalikes stay separate
        }

        var result = new List<InstalledModInfo>(groups.Count);
        foreach (List<InstalledModInfo> group in groups)
        {
            if (group.Count == 1) { result.Add(group[0]); continue; }
            result.Add(MergeComponents(group));
        }
        return result;
    }

    /// <summary>The fuzzy identity: PackageId (guid / package name) or display name, lowercased,
    /// with ONE trailing component suffix stripped ("Tyfon.WeaponCustomizer.Server" →
    /// "tyfon.weaponcustomizer" — matching the client half's "Tyfon.WeaponCustomizer").</summary>
    private static string FuzzyComponentKey(InstalledModInfo row)
    {
        string identity = (row.PackageId ?? row.DisplayName ?? string.Empty).Trim().ToLowerInvariant();
        foreach (string suffix in new[] { ".server", ".client", "-server", "-client" })
        {
            if (identity.EndsWith(suffix, StringComparison.Ordinal) && identity.Length > suffix.Length)
            {
                identity = identity[..^suffix.Length];
                break;
            }
        }
        return identity;
    }

    private static InstalledModInfo MergeComponents(List<InstalledModInfo> group)
    {
        // Primary: the server half (it owns the package.json identity + version); among server
        // rows prefer one with a version, then a PackageId; deterministic path tiebreak.
        InstalledModInfo primary = group
            .OrderByDescending(r => r.Kind == InstalledModKind.Server)
            .ThenByDescending(r => !string.IsNullOrWhiteSpace(r.Version))
            .ThenByDescending(r => !string.IsNullOrWhiteSpace(r.PackageId))
            .ThenBy(r => r.InstallPath, StringComparer.Ordinal)
            .First();

        return new InstalledModInfo
        {
            Kind = primary.Kind,
            InstallPath = primary.InstallPath,
            IsDirectory = primary.IsDirectory,
            ParentDirectory = primary.ParentDirectory,
            DisplayName = primary.DisplayName,
            PackageId = primary.PackageId,
            Version = primary.Version,
            Authors = primary.Authors ?? group.Select(g => g.Authors).FirstOrDefault(a => !string.IsNullOrWhiteSpace(a)),
            MainEntry = primary.MainEntry,
            SptVersionHint = primary.SptVersionHint ?? group.Select(g => g.SptVersionHint).FirstOrDefault(h => !string.IsNullOrWhiteSpace(h)),
            IsDisabled = group.All(g => g.IsDisabled),
            InfoSource = primary.InfoSource,
            Components = group
                .OrderBy(r => !ReferenceEquals(r, primary)) // primary first
                .ThenBy(r => r.InstallPath, StringComparer.Ordinal)
                .ToList()
        };
    }

    /// <summary>
    /// Reads the installed version straight from the DESTINATION directory (package.json for
    /// server mods, PE metadata for plugins) via the same scanner the app uses at startup —
    /// the disk is the source of truth after an update, not the download metadata.
    /// </summary>
    private static string? VerifyInstalledVersion(string sptRoot, InstalledModInfo mod, string archivePath, ArchiveKind kind)
    {
        try
        {
            ArchiveLayout layout;
            try { layout = ArchiveExtractor.Analyze(archivePath, kind); }
            catch (Exception ex) when (ex is IOException or InvalidDataException or UnauthorizedAccessException) { return null; }

            // Identity first (guid/name from the new package.json), then the expected folder name
            // (derived from the archive itself — root-structured updates may RENAME the mod folder).
            string? expectedTop = ExpectedModFolderName(layout, kind, mod, archivePath);

            List<InstalledModInfo> rows = new LocalModScanner().Scan(sptRoot);
            if (mod.PackageId is not null)
            {
                InstalledModInfo? byIdentity = rows.FirstOrDefault(r =>
                    string.Equals(r.PackageId, mod.PackageId, StringComparison.OrdinalIgnoreCase));
                if (byIdentity?.Version is not null) return byIdentity.Version;
            }
            if (expectedTop is not null)
            {
                InstalledModInfo? byFolder = rows.FirstOrDefault(r =>
                    string.Equals(Path.GetDirectoryName(r.InstallPath), mod.ParentDirectory, StringComparison.OrdinalIgnoreCase) &&
                    (r.InstallPath.EndsWith(expectedTop, StringComparison.OrdinalIgnoreCase) ||
                     r.InstallPath.EndsWith(expectedTop + DisabledSuffix, StringComparison.OrdinalIgnoreCase)));
                if (byFolder?.Version is not null) return byFolder.Version;
            }
            return null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            return null;
        }
    }

    /// <summary>The mod folder the update archive will land in: root-structured archives carry
    /// the folder in their own tree (user/mods/&lt;Name&gt;/… — the LIVE svm update renames the
    /// folder, so the old name cannot be assumed); payload archives use their single top folder;
    /// wrapped loose files keep the old folder name.</summary>
    private static string? ExpectedModFolderName(ArchiveLayout layout, ArchiveKind kind, InstalledModInfo mod, string archivePath)
    {
        string oldLogicalName = Path.GetFileName(mod.InstallPath);
        if (oldLogicalName.EndsWith(DisabledSuffix, StringComparison.OrdinalIgnoreCase))
            oldLogicalName = oldLogicalName[..^DisabledSuffix.Length];

        if (layout.HasRootStructuredEntries)
        {
            string prefix = mod.Kind == InstalledModKind.Server ? "user/mods/" : "BepInEx/plugins/";
            try
            {
                foreach (ArchiveEntryInfo entry in ArchiveInspector.Default.ListEntries(archivePath, kind))
                {
                    if (entry.IsDirectory) continue;
                    string? mapped = SptRouteTable.Default.MapToRoot(entry.Path);
                    if (mapped is null || mapped.Length <= prefix.Length ||
                        !mapped.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) continue;
                    int nextSeparator = mapped.IndexOf('/', prefix.Length);
                    string folder = nextSeparator < 0 ? mapped[prefix.Length..] : mapped[prefix.Length..nextSeparator];
                    if (folder.Length > 0) return folder;
                }
            }
            catch (Exception ex) when (ex is IOException or InvalidDataException or UnauthorizedAccessException) { }
        }
        return layout.PayloadTopFolder ?? (mod.IsDirectory ? oldLogicalName : null);
    }

    // ------------------------------------------------------------------ record self-healing

    /// <summary>
    /// Startup/rescan reconciliation (the "outdated after restart" safety net): the disk is the
    /// source of truth. For every persisted install record, re-reads the installed version from
    /// the scanned rows and corrects mismatched version strings automatically — records left
    /// stale by older builds heal themselves on the first launch. Returns the healed
    /// (modId, version) pairs so the UI can refresh its cards immediately.
    /// </summary>
    public List<(int ModId, string Version)> ReconcileInstallRecordsWithDisk(
        IReadOnlyList<InstalledModInfo> scanned, Func<int, Mod?>? catalogById = null)
    {
        var healed = new List<(int ModId, string Version)>();
        var records = _settings.Settings.InstalledMods;
        if (records.Count == 0 || scanned.Count == 0) return healed;

        foreach (int modId in records.Keys.ToList())
        {
            InstalledModRecord record = records[modId];

            // Match the record to a scanned row: catalog bridge first (record key = catalog mod
            // id → guid/slug → row), then the legacy name match (record name vs row identity).
            InstalledModInfo? match = null;
            Mod? catalog = catalogById?.Invoke(modId);
            if (catalog is not null)
            {
                match = scanned.FirstOrDefault(r =>
                    (!string.IsNullOrEmpty(catalog.Guid) &&
                     string.Equals(r.PackageId, catalog.Guid, StringComparison.OrdinalIgnoreCase)) ||
                    (!string.IsNullOrEmpty(catalog.Slug) &&
                     string.Equals(r.PackageId, catalog.Slug, StringComparison.OrdinalIgnoreCase)));
            }
            match ??= scanned.FirstOrDefault(r =>
                !string.IsNullOrWhiteSpace(record.Name) &&
                (string.Equals(r.PackageId, record.Name, StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(r.DisplayName, record.Name, StringComparison.OrdinalIgnoreCase)));

            if (match is null || string.IsNullOrWhiteSpace(match.Version)) continue;
            if (string.Equals(record.Version, match.Version, StringComparison.Ordinal)) continue;

            record.Version = match.Version; // disk wins — package.json/PE metadata re-verified
            healed.Add((modId, match.Version));
        }

        if (healed.Count > 0) _settings.Save(); // one explicit flush for the whole pass
        return healed;
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
            .Select(r => (
                Identifier: r.Identifier,
                // Normalize before sending: the API's version matching is string-based, so an
                // author's "v4.1.0" would otherwise never match the catalog's "4.1.0" and every
                // such mod would come back falsely flagged as an update.
                Version: SemVersion.TryParse(r.Mod.Version, out SemVersion? parsed) && parsed is not null
                    ? parsed.ToCoreString()
                    : r.Mod.Version!))
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
                UpdateCheckOutcome outcome = new()
                {
                    Status = UpdateStatus.UpdateAvailable,
                    NewVersion = entry.RecommendedVersion.Version,
                    Link = entry.RecommendedVersion.Link,
                    ContentLength = entry.RecommendedVersion.ContentLength,
                    Reason = entry.UpdateReason ?? entry.Reason,
                    CatalogModId = entry.CurrentVersion?.ModId,
                    ReleaseId = entry.RecommendedVersion.Id
                };

                // Local arbitration (the false-Update fix, centralized in VersionUtils): the
                // Update verdict requires Parsed(ForgeVersion) > Parsed(LocalVersion) STRICTLY.
                // The server's string matching cannot be trusted with author formatting drift
                // ("v4.1.0" vs "4.1.0", "-release" suffixes, " RC2" annotations) — and when
                // either side cannot be parsed, "newer" cannot be proven, so NO update shows.
                if (!VersionUtils.IsNewer(entry.RecommendedVersion.Version, row.Version))
                {
                    outcome = new UpdateCheckOutcome
                    {
                        Status = UpdateStatus.UpToDate,
                        NewVersion = entry.RecommendedVersion.Version,
                        CatalogModId = entry.CurrentVersion?.ModId,
                        ReleaseId = entry.RecommendedVersion.Id
                    };
                }

                results[row.IdentityKey] = outcome;
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
                    CatalogModId = entry.ModId,
                    ReleaseId = entry.LatestCompatibleVersion?.Id
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
        string? newVersion = null,
        int? catalogModId = null,
        int? releaseId = null)
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

            // Post-install metadata commit (the "outdated again after restart" fix): verify the
            // installed version FROM THE DESTINATION DIRECTORY — the same package.json / PE
            // metadata the startup scanner reads — then persist the tracking record (version +
            // Forge release id) with an explicit flush so the update survives an app restart.
            string? verifiedVersion = VerifyInstalledVersion(sptRoot, mod, tempPath, kind);
            string? effectiveVersion = verifiedVersion ?? newVersion;
            if (catalogModId is int recordedModId && !string.IsNullOrWhiteSpace(effectiveVersion))
                _settings.RecordInstall(recordedModId, mod.DisplayName, effectiveVersion!, releaseId);

            string versionSuffix = effectiveVersion is null ? string.Empty : $" → v{effectiveVersion}";
            return new UpdateActionResult(true, $"{mod.DisplayName} updated{versionSuffix}.", verifiedVersion);
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
        // Every installation piece of the mod — a consolidated card carries BOTH its server and
        // client components; a plain row is just itself. The update replaces all of them.
        List<InstalledModInfo> targets = (mod.Components ?? new[] { mod })
            .GroupBy(t => t.InstallPath, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();
        foreach (InstalledModInfo target in targets)
        {
            if (!ArchiveExtractor.IsPathInside(target.ParentDirectory, target.InstallPath))
                throw new UnauthorizedAccessException($"Refusing to replace “{target.InstallPath}” — outside of the managed mod folders.");
        }

        var layout = ArchiveExtractor.Analyze(archivePath, kind);

        // The primary component's logical folder name (loose-payload wrap target).
        string primaryLogicalName = Path.GetFileName(targets[0].InstallPath);
        if (primaryLogicalName.EndsWith(DisabledSuffix, StringComparison.OrdinalIgnoreCase))
            primaryLogicalName = primaryLogicalName[..^DisabledSuffix.Length];

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
                looseFolderName: mod.IsDirectory ? primaryLogicalName : null,
                layout: layout,
                progress: extractionProgress).ConfigureAwait(false);

            // 2) Swap: move EVERY old component ASIDE first (atomic rename to a sibling
            //    bs-staging-old-* folder INSIDE the SPT root — always the same volume as the
            //    mods, so the rename is atomic even when %TEMP% sits on another drive — retried
            //    with exponential backoff against AV/lock contention). If any aside-move fails,
            //    the existing installation is still 100% intact and the update aborts cleanly.
            //    Only then is the staged tree merged into the real root — the old folders are
            //    fully out of the way, so no stale manifest/DLL can survive and nothing can
            //    hold a destination open. On merge failure every component is restored from its
            //    aside. A crash mid-update leaves asides behind; the startup sweep removes them.
            var asides = new List<(string OldPath, string AsidePath)>();
            bool asidesConsumed = false;
            try
            {
                foreach (InstalledModInfo target in targets)
                {
                    string oldPath = target.InstallPath;
                    if (!Directory.Exists(oldPath) && !File.Exists(oldPath)) continue;
                    string aside = Path.Combine(Path.GetFullPath(sptRoot), "bs-staging-old-" + Guid.NewGuid().ToString("N")[..8]);
                    if (Directory.Exists(oldPath))
                        PlacementEngine.ExecuteWithLockRetry(_ => { Directory.Move(oldPath, aside); return true; });
                    else
                        PlacementEngine.ExecuteWithLockRetry(_ => { File.Move(oldPath, aside); return true; });
                    asides.Add((oldPath, aside));
                }

                ArchiveExtractor.CopyDirectoryMerge(staging, sptRoot);
                asidesConsumed = true; // the new tree is in place — the asides are now garbage
            }
            catch
            {
                // Rollback: put every asided component back over the partial merge.
                foreach ((string rollbackPath, string aside) in asides)
                {
                    try
                    {
                        if (Directory.Exists(aside) || File.Exists(aside))
                            PlacementEngine.Default.MoveTreeMerge(aside, rollbackPath);
                    }
                    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                    {
                        // Best-effort restore failed — keep that aside in the SPT root
                        // (bs-staging-old-* is swept at startup) and report the ORIGINAL failure.
                    }
                }
                throw;
            }
            finally
            {
                if (asidesConsumed)
                {
                    foreach ((_, string aside) in asides)
                    {
                        try { if (Directory.Exists(aside)) ArchiveExtractor.DeleteDirectoryRobust(aside); }
                        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
                        try { if (File.Exists(aside)) ArchiveExtractor.DeleteFileRobust(aside); }
                        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
                    }
                }
            }
        }
        finally
        {
            try { if (Directory.Exists(staging)) Directory.Delete(staging, recursive: true); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }

        // 3) Keep the disabled state across the update — per component (a consolidated card may
        //    have its server half disabled while the client half is enabled). The primary
        //    component's fresh folder comes from the archive layout; secondary components keep
        //    their own (stripped) folder names.
        foreach (InstalledModInfo target in targets)
        {
            if (!target.IsDisabled) continue;
            string targetLogical = Path.GetFileName(target.InstallPath);
            if (targetLogical.EndsWith(DisabledSuffix, StringComparison.OrdinalIgnoreCase))
                targetLogical = targetLogical[..^DisabledSuffix.Length];
            string? newTop = ReferenceEquals(target, targets[0])
                ? layout.PayloadTopFolder ?? (target.IsDirectory ? targetLogical : null)
                : (target.IsDirectory ? targetLogical : null);
            if (newTop is not null)
            {
                string fresh = Path.Combine(target.ParentDirectory, newTop);
                if (Directory.Exists(fresh) && !fresh.EndsWith(DisabledSuffix, StringComparison.OrdinalIgnoreCase))
                {
                    string renamed = fresh + DisabledSuffix;
                    if (!Directory.Exists(renamed)) Directory.Move(fresh, renamed);
                }
            }
            else if (!target.IsDirectory)
            {
                string freshFile = Path.Combine(target.ParentDirectory, targetLogical);
                if (File.Exists(freshFile) && !freshFile.EndsWith(DisabledSuffix, StringComparison.OrdinalIgnoreCase))
                    File.Move(freshFile, freshFile + DisabledSuffix);
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
