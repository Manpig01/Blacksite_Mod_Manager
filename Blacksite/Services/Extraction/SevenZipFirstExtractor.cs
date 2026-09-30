using System.Diagnostics;
using System.IO;
using Blacksite.Models;

namespace Blacksite.Services.Extraction;

/// <summary>
/// PHASE A extraction via the official 7-Zip engine. Progress is read from 7-Zip's stderr
/// output and throttled to at most one callback per 150 ms. This avoids repeatedly traversing
/// the staging tree (an O(file-count) scan on every poll) for archives containing thousands of
/// tiny files. Cancellation kills the process tree immediately. Returns false on engine failure
/// so the caller can use the in-process SharpCompress fallback.
/// </summary>
public sealed class SevenZipExtractor
{
    private readonly SevenZipService _sevenZip;

    public SevenZipExtractor(string? binaryOverride = null)
        => _sevenZip = new SevenZipService(binaryOverride);

    private const int ProgressGateIntervalMs = 150;

    public async Task<bool> TryExtractToStagingAsync(
        string archivePath, ArchiveKind kind, string stagingRoot,
        IProgress<double>? progress, CancellationToken cancellationToken)
    {
        if (kind is ArchiveKind.Html or ArchiveKind.Unknown) return false;
        if (_sevenZip.ResolveBinary() is null) return false;

        try
        {
            progress?.Report(0.0);
            var clock = Stopwatch.StartNew();
            long lastReportMs = -ProgressGateIntervalMs;
            int lastPercent = 0;
            object gate = new();

            void ReportSevenZipPercent(int percent)
            {
                if (progress is null) return;
                lock (gate)
                {
                    long now = clock.ElapsedMilliseconds;
                    if (now - lastReportMs < ProgressGateIntervalMs) return;
                    lastReportMs = now;
                    percent = Math.Clamp(percent, lastPercent, 99);
                    lastPercent = percent;
                    progress.Report(percent);
                }
            }

            bool extracted = await _sevenZip.ExtractArchiveAsync(
                archivePath, stagingRoot, cancellationToken, ReportSevenZipPercent).ConfigureAwait(false);
            if (!extracted) return false;

            progress?.Report(100.0);
            return true;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (FileNotFoundException)
        {
            return false;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            return false;
        }
    }
}

/// <summary>
/// The extraction pipeline: 7-Zip first, SharpCompress in-process as an automatic fallback.
/// Both paths extract into bs-extract staging folders and share the same route-table/placement
/// phase, so archive format does not change final SPT routing.
/// </summary>
public static class ExtractionPipeline
{
    /// <summary>Extracts a detected archive into the SPT root without writing archive entries
    /// directly to the live installation. The optional binary override is a smoke-harness hook.</summary>
    public static async Task ExtractAsync(
        string archivePath, ArchiveKind kind, string sptRoot,
        string? payloadTargetDir = null, string? looseFolderName = null, ArchiveLayout? layout = null,
        IProgress<double>? progress = null, CancellationToken cancellationToken = default,
        string? sevenZipBinaryOverride = null)
    {
        if (kind is ArchiveKind.Html or ArchiveKind.Unknown)
            throw new InvalidDataException(kind == ArchiveKind.Html
                ? "The download URL returned a web page or error payload instead of an archive (the file link is probably dead — open the mod page and download manually)."
                : "The downloaded file is not a recognized archive (zip/rar/7z).");

        layout ??= ArchiveInspector.Default.Analyze(archivePath, kind);

        var sevenZip = new SevenZipExtractor(sevenZipBinaryOverride);
        string staging = PlacementEngine.NewStagingRoot();
        try
        {
            Directory.CreateDirectory(staging);
            bool extractedBySevenZip = await sevenZip.TryExtractToStagingAsync(
                archivePath, kind, staging, progress, cancellationToken).ConfigureAwait(false);

            if (extractedBySevenZip)
            {
                PlacementEngine.Default.MoveStagedTree(staging, sptRoot, layout, payloadTargetDir,
                    looseFolderName, Array.Empty<string>());
                return;
            }
        }
        finally
        {
            PlacementEngine.DeleteDirectoryRobust(staging);
        }

        string fallbackStaging = PlacementEngine.NewStagingRoot();
        try
        {
            Directory.CreateDirectory(fallbackStaging);
            List<string> directoryEntries = await SharpCompressExtractor.Instance
                .ExtractAllEntriesToStagingAsync(archivePath, kind, fallbackStaging, progress, cancellationToken)
                .ConfigureAwait(false);
            PlacementEngine.Default.MoveStagedTree(fallbackStaging, sptRoot, layout, payloadTargetDir,
                looseFolderName, directoryEntries);
        }
        finally
        {
            PlacementEngine.DeleteDirectoryRobust(fallbackStaging);
        }
    }

}
