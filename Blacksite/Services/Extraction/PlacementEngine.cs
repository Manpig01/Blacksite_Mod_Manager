using System.IO;

namespace Blacksite.Services.Extraction;

/// <summary>
/// Unit 3 of the extraction architecture: PLACEMENT — moving a fully-extracted staging tree
/// into the SPT root at the highest possible directory granularity (atomic Directory.Move for
/// brand-new folders, recursive merge+overwrite for existing trees, cross-volume fallback).
/// Nothing is ever written file-by-file into the live game directory, and merges NEVER delete
/// non-empty folders. AV-lock resilient: individual file operations retry with exponential
/// backoff on IOException/UnauthorizedAccessException (the real-world signature of an antivirus
/// scan holding a fresh file open).
/// </summary>
public interface IPlacementEngine
{
    /// <summary>Phase B: moves a staged, verbatim-extracted tree into the SPT root following the
    /// route table. <paramref name="directoryEntries"/> are the archive's directory entries
    /// (mapped ones materialize at the destination even when empty).</summary>
    void MoveStagedTree(string stagingRoot, string sptRoot, ArchiveLayout layout,
        string? payloadTargetDir, string? looseFolderName, IReadOnlyList<string> directoryEntries);
}

public sealed class PlacementEngine : IPlacementEngine
{
    public static PlacementEngine Default { get; } = new();

    private readonly SptRouteTable _table;
    public PlacementEngine(SptRouteTable? table = null) => _table = table ?? SptRouteTable.Default;

    // ------------------------------------------------------------- staging paths

    /// <summary>Unique staging folder in Path.GetTempPath() for one extraction run —
    /// ALWAYS bs-extract-* (swept at startup and by Clear Temp Files).</summary>
    public static string NewStagingRoot() =>
        Path.Combine(Path.GetTempPath(), "bs-extract-" + Guid.NewGuid().ToString("N")[..12]);

    // ------------------------------------------------------------- AV-lock retry

    /// <summary>Retry policy for file operations contending with an antivirus scan: exponential
    /// backoff, ~3.7 s worst case before the final attempt. Data — tune here, not at call sites.</summary>
    public static int RetryMaxAttempts { get; set; } = 5;
    public static int RetryBaseDelayMs { get; set; } = 120;

    /// <summary>Executes <paramref name="operation"/> retrying on IOException /
    /// UnauthorizedAccessException (AV locks) with exponential backoff. The attempt number is
    /// handed to the operation so callers can re-check liveness. Rethrows the final failure.</summary>
    public static T ExecuteWithLockRetry<T>(Func<int, T> operation)
    {
        Exception? last = null;
        for (int attempt = 1; attempt <= RetryMaxAttempts; attempt++)
        {
            try
            {
                return operation(attempt);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException && attempt < RetryMaxAttempts)
            {
                last = ex;
                Thread.Sleep(RetryBaseDelayMs * (1 << (attempt - 1))); // 120, 240, 480, 960 ms
            }
        }
        throw last!;
    }

    /// <summary>Async variant for stream operations.</summary>
    public static async Task ExecuteWithLockRetryAsync(Func<int, Task> operation)
    {
        Exception? last = null;
        for (int attempt = 1; attempt <= RetryMaxAttempts; attempt++)
        {
            try
            {
                await operation(attempt).ConfigureAwait(false);
                return;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException && attempt < RetryMaxAttempts)
            {
                last = ex;
                await Task.Delay(RetryBaseDelayMs * (1 << (attempt - 1))).ConfigureAwait(false);
            }
        }
        throw last!;
    }

    // ------------------------------------------------------------- Phase B placement

    public void MoveStagedTree(string stagingRoot, string sptRoot, ArchiveLayout layout,
        string? payloadTargetDir, string? looseFolderName, IReadOnlyList<string> directoryEntries)
    {
        string rootFull = Path.GetFullPath(sptRoot);

        // Configured mod folders (Settings tab) drive payload routing; archives that already carry
        // the canonical user/mods or BepInEx/plugins structure are remapped to the configured paths.
        string payloadRoot = payloadTargetDir
            ?? Path.Combine(rootFull, _table.PayloadRelativePath(layout.PayloadLooksClient).Replace('/', Path.DirectorySeparatorChar));

        // Mapped directory entries keep materializing at the destination (empty folders included).
        foreach (string dir in directoryEntries)
        {
            string? mapped = _table.MapToRoot(dir);
            if (mapped is null) continue;
            EnsureDirectoryInside(rootFull, Path.Combine(rootFull, _table.RemapConfigured(mapped)));
        }

        foreach (string top in Directory.EnumerateFileSystemEntries(stagingRoot).ToList())
        {
            string name = Path.GetFileName(top);

            // A recognized root folder ("user" / "BepInEx" / "EscapeFromTarkov_Data" — per the
            // route table) at the archive root → merge into the SPT root, remapping each child
            // to its CONFIGURED path (user/mods → SPT_Runtime/user/mods or a custom subpath).
            if (_table.MatchRootFolder(name) is not null)
            {
                MergeRecognizedFolderIntoRoot(top, rootFull);
                continue;
            }

            if (Directory.Exists(top))
            {
                // Wrapper folder ("SPT/…"): recognized children merge into the root (remapped);
                // the rest is payload and keeps its archived relative path.
                List<string> children = Directory.EnumerateFileSystemEntries(top).ToList();
                if (children.Any(c => _table.MatchRootFolder(Path.GetFileName(c)) is not null))
                {
                    foreach (string child in children)
                    {
                        string childName = Path.GetFileName(child);
                        if (_table.MatchRootFolder(childName) is not null)
                            MergeRecognizedFolderIntoRoot(child, rootFull);
                        else
                            MovePayloadPiece(child, name + "/" + childName, payloadRoot, layout, looseFolderName);
                    }
                    continue;
                }
            }

            MovePayloadPiece(top, name, payloadRoot, layout, looseFolderName);
        }
    }

    /// <summary>Moves the children of a recognized root folder into the SPT root, applying the
    /// CONFIGURED path remap per child ("user/mods" → the effective server path,
    /// "BepInEx/plugins" → the effective client path; everything else keeps its archived
    /// location — BepInEx core files are never rerouted or stripped).</summary>
    private void MergeRecognizedFolderIntoRoot(string dir, string rootFull)
    {
        string folderName = Path.GetFileName(dir);
        foreach (string child in Directory.EnumerateFileSystemEntries(dir).ToList())
        {
            string childName = Path.GetFileName(child);
            string destRelative = _table.RemapConfigured(folderName + "/" + childName);
            MoveTreeMerge(child, Path.Combine(rootFull, destRelative));
        }
    }

    /// <summary>Moves one payload piece (bare mod folder or loose file) to its destination,
    /// preserving the archived relative path and honoring the loose-folder wrap. The common case —
    /// a single payload top folder — is ONE atomic Directory.Move into the mods folder.</summary>
    private void MovePayloadPiece(string source, string relativePath, string payloadRoot,
        ArchiveLayout layout, string? looseFolderName)
    {
        if (layout.PayloadTopFolder is not null &&
            relativePath.Equals(layout.PayloadTopFolder, StringComparison.OrdinalIgnoreCase))
        {
            MoveTreeMerge(source, Path.Combine(payloadRoot, layout.PayloadTopFolder));
            return;
        }
        if (layout.PayloadTopFolder is null && !string.IsNullOrWhiteSpace(looseFolderName))
        {
            MoveTreeMerge(source, Path.Combine(payloadRoot, looseFolderName, relativePath));
            return;
        }
        MoveTreeMerge(source, Path.Combine(payloadRoot, relativePath));
    }

    /// <summary>True when both paths sit on the same volume (cheap PathRoot comparison — exact
    /// on Windows drive letters; conservative on Unix where everything roots at "/"). Cross-volume
    /// renames fail deterministically (EXDEV), so they skip the rename path entirely.</summary>
    private static bool SameVolume(string a, string b) =>
        string.Equals(
            Path.GetPathRoot(Path.GetFullPath(a)),
            Path.GetPathRoot(Path.GetFullPath(b)),
            StringComparison.OrdinalIgnoreCase);

    /// <summary>Moves a staged file/directory to its destination. An absent target receives a
    /// single atomic Directory.Move (same-volume rename — no per-file I/O); existing trees merge
    /// recursively with overwrite; cross-volume moves fall back to per-child moves for folders
    /// and to copy+delete for files (e.g. %TEMP% staging on another drive than the game).
    /// Merging NEVER deletes a non-empty folder — only files are replaced.</summary>
    public void MoveTreeMerge(string source, string destination)
    {
        if (!File.Exists(source) && !Directory.Exists(source)) return;

        if (File.Exists(source))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(destination))!);
            if (File.Exists(destination)) DeleteFileRobust(destination);
            if (SameVolume(source, destination))
            {
                ExecuteWithLockRetry(attempt =>
                {
                    if (File.Exists(destination)) DeleteFileRobust(destination);
                    File.Move(source, destination, overwrite: true);
                    return true;
                });
            }
            else
            {
                // Cross-volume: rename cannot work — copy+delete (AV-lock resilient).
                ExecuteWithLockRetry(attempt =>
                {
                    if (File.Exists(destination)) DeleteFileRobust(destination);
                    File.Copy(source, destination, overwrite: true);
                    DeleteFileRobust(source);
                    return true;
                });
            }
            return;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(destination))!);
        if (!Directory.Exists(destination) && !File.Exists(destination) && SameVolume(source, destination))
        {
            try
            {
                ExecuteWithLockRetry(attempt =>
                {
                    if (Directory.Exists(destination) || File.Exists(destination)) return false;
                    Directory.Move(source, destination); // atomic same-volume rename
                    return true;
                });
                if (!Directory.Exists(source)) return; // moved atomically
            }
            catch (IOException)
            {
                // Locked mid-rename — merge child-by-child instead.
            }
        }

        if (File.Exists(destination))
        {
            // A file occupies the destination path but the source is a directory — the archive wins.
            DeleteFileRobust(destination);
        }

        foreach (string child in Directory.EnumerateFileSystemEntries(source).ToList())
            MoveTreeMerge(child, Path.Combine(destination, Path.GetFileName(child)));
    }

    private static void EnsureDirectoryInside(string baseFull, string dirPath)
    {
        if (IsPathInside(baseFull, dirPath)) Directory.CreateDirectory(dirPath);
    }

    // ------------------------------------------------------------- shared safe FS helpers

    /// <summary>True when <paramref name="candidateFull"/> is equal to or inside
    /// <paramref name="baseFull"/> (zip-slip guard, case-insensitive).</summary>
    public static bool IsPathInside(string baseFull, string candidateFull)
    {
        string b = Path.GetFullPath(baseFull).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string c = Path.GetFullPath(candidateFull);
        return c.StartsWith(b, StringComparison.OrdinalIgnoreCase) ||
               c.Equals(b.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Recursively deletes a directory, clearing read-only/broken permission bits first.</summary>
    public static void DeleteDirectoryRobust(string directory)
    {
        if (!Directory.Exists(directory)) return;
        var options = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true };
        foreach (string file in Directory.EnumerateFiles(directory, "*", options))
        {
            try { File.SetAttributes(file, FileAttributes.Normal); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or PlatformNotSupportedException) { }
        }
        Directory.Delete(directory, recursive: true);
    }

    public static void DeleteFileRobust(string filePath)
    {
        if (!File.Exists(filePath)) return;
        try { File.SetAttributes(filePath, FileAttributes.Normal); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or PlatformNotSupportedException) { }
        File.Delete(filePath);
    }
}
