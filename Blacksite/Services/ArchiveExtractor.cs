using System.IO;
using Blacksite.Models;
using Blacksite.Services.Extraction;

namespace Blacksite.Services;

public enum ArchiveKind { Unknown, Zip, Rar, SevenZip, Html }

/// <summary>What an archive contains and where its pieces belong inside an SPT root.</summary>
public sealed record ArchiveLayout(
    bool HasRootStructuredEntries,      // entries that map to user/... or BepInEx/... (possibly after wrapper stripping)
    bool HasWrappedEntries,             // root-structured entries that needed a wrapper folder stripped ("SPT/user/...")
    bool HasPayloadEntries,             // entries with no SPT-root structure (bare mod folder / loose files)
    string? PayloadTopFolder,           // single common top folder of the payload (e.g. "ScavCat")
    bool PayloadLooksClient);           // a payload DLL carries [BepInPlugin] → belongs in BepInEx/plugins

/// <summary>
/// FACADE over the clean-slate extraction architecture (kept API-stable for the app layers and
/// the hermetic harnesses). All real work lives in independently testable units under
/// Services/Extraction:
///   • <see cref="ArchiveInspector"/>     — detection (zip/7z/RAR5/HTML, SFX-tolerant), listing, layout analysis
///   • <see cref="SevenZipExtractor"/>    — Phase A via the bundled official 7-Zip engine (7-Zip FIRST)
///   • <see cref="SharpCompressExtractor"/> — Phase A in-process fallback (staged parallel engine)
///   • <see cref="SptRouteTable"/>        — data-driven SPT path routing (no nested if-trees)
///   • <see cref="PlacementEngine"/>      — atomic/merge placement, AV-lock retry backoff
///   • <see cref="ExtractionPipeline"/>   — the orchestration: inspector → 7za|SharpCompress → table+placement
/// Behavior is characterized byte-for-byte by QueueSmokeTest §B/§C/§D/§E/§J/§K/§L and
/// InstalledSmokeTest §A–§E; the facade keeps their call surface unchanged.
/// </summary>
public static class ArchiveExtractor
{
    // ------------------------------------------------------------------ detection & analysis (unit 1)

    public static ArchiveKind Detect(string filePath) => ArchiveInspector.Default.Detect(filePath);

    public static ArchiveKind DetectWithExtensionFallback(string filePath)
        => ArchiveInspector.Default.DetectWithExtensionFallback(filePath);

    public static bool IsStructurallyIntactArchive(string filePath)
        => ArchiveInspector.Default.IsStructurallyIntactArchive(filePath);

    public static ArchiveLayout Analyze(string filePath, ArchiveKind kind)
        => ArchiveInspector.Default.Analyze(filePath, kind);

    // ------------------------------------------------------------------ extraction pipeline (units 4+5)

    /// <summary>
    /// Extracts an archive into the SPT root with full layout handling — 7-Zip FIRST (bundled
    /// official engine), SharpCompress in-process as the automatic fallback. Extraction happens
    /// ONLY into %TEMP%\bs-extract-* staging folders; placement reaches the SPT root through
    /// atomic/merge moves (never per-file writes into the live game directory). Cancellation
    /// aborts cleanly at any point — the staging sweep in the finally blocks leaves no partial
    /// install behind.
    /// payloadTargetDir: where bare payload folders/files go (an already-known mod parent such as
    /// user\mods or BepInEx\plugins). When null, payload is routed by its classification.
    /// looseFolderName: folder name to wrap loose (top-folder-less) payload files into.
    /// </summary>
    public static Task ExtractSmartAsync(
        string archivePath, ArchiveKind kind, string sptRoot,
        string? payloadTargetDir = null, string? looseFolderName = null, ArchiveLayout? layout = null,
        IProgress<double>? progress = null, CancellationToken cancellationToken = default)
        => ExtractionPipeline.ExtractAsync(archivePath, kind, sptRoot,
            payloadTargetDir, looseFolderName, layout, progress, cancellationToken);

    /// <summary>
    /// Zip extraction with live progress into the given root, powered by the pipeline.
    /// Mapped entries (user/…, BepInEx/…, EscapeFromTarkov_Data/…) are remapped to the configured
    /// mod paths; everything else lands verbatim at the destination root.
    /// </summary>
    public static Task ExtractArchiveWithProgressAsync(
        string zipPath, string destinationRoot, IProgress<double>? progress,
        CancellationToken cancellationToken = default)
        => ExtractSmartAsync(zipPath, ArchiveKind.Zip, destinationRoot,
            payloadTargetDir: Path.GetFullPath(destinationRoot),
            looseFolderName: null,
            layout: null,
            progress: progress,
            cancellationToken: cancellationToken);

    // ------------------------------------------------------------------ safe FS helpers (unit 3, kept here for API stability)

    /// <summary>True when <paramref name="candidateFull"/> is equal to or inside
    /// <paramref name="baseFull"/> (zip-slip guard, case-insensitive).</summary>
    public static bool IsPathInside(string baseFull, string candidateFull)
        => PlacementEngine.IsPathInside(baseFull, candidateFull);

    /// <summary>Recursively deletes a directory, clearing read-only/broken permission bits first.</summary>
    public static void DeleteDirectoryRobust(string directory)
        => PlacementEngine.DeleteDirectoryRobust(directory);

    public static void DeleteFileRobust(string filePath)
        => PlacementEngine.DeleteFileRobust(filePath);

    /// <summary>Copies a directory tree into a destination, merging and force-overwriting files.</summary>
    public static void CopyDirectoryMerge(string sourceDir, string destinationDir)
    {
        Directory.CreateDirectory(destinationDir);
        var options = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true };

        foreach (string sourceFile in Directory.EnumerateFiles(sourceDir, "*", options))
        {
            string relative = Path.GetRelativePath(sourceDir, sourceFile);
            string destFile = Path.GetFullPath(Path.Combine(destinationDir, relative));
            if (!PlacementEngine.IsPathInside(destinationDir, destFile)) continue;

            Directory.CreateDirectory(Path.GetDirectoryName(destFile)!);
            if (File.Exists(destFile))
            {
                try { File.SetAttributes(destFile, FileAttributes.Normal); }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or PlatformNotSupportedException) { }
                File.Delete(destFile);
            }
            File.Copy(sourceFile, destFile, overwrite: true);
        }
    }
}
