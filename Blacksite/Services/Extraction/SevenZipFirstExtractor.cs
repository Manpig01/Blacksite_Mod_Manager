using System.Diagnostics;
using System.IO;
using Blacksite.Models;

namespace Blacksite.Services.Extraction;

/// <summary>
/// Unit 4b of the extraction architecture: PHASE A EXTRACTION via the official 7-Zip engine
/// (bundled tools/7zip/win/7za.exe — task 2.2). Runs the console binary against the staging
/// folder; progress is BYTE-BASED, derived by polling the staged tree's size against the
/// archive's uncompressed total through the same 150 ms monotonic gate the in-process engine
/// uses. Cancellation kills the process tree immediately. Returns false (→ automatic
/// SharpCompress fallback) when no binary is available or 7-Zip exits with a fatal code.
/// </summary>
public sealed class SevenZipExtractor
{
    private readonly SevenZipService _sevenZip;

    public SevenZipExtractor(string? binaryOverride = null)
        => _sevenZip = new SevenZipService(binaryOverride);

    /// <summary>Progress dispatch gate — identical to the in-process engine.</summary>
    private const int ProgressGateIntervalMs = 150;

    public async Task<bool> TryExtractToStagingAsync(
        string archivePath, ArchiveKind kind, string stagingRoot,
        long totalUncompressedBytes, IProgress<double>? progress, CancellationToken cancellationToken)
    {
        if (kind is ArchiveKind.Html or ArchiveKind.Unknown) return false;
        if (_sevenZip.ResolveBinary() is null) return false; // no engine available → fallback, no progress side effects

        try
        {
            progress?.Report(0.0);

            // 7-Zip writes files into the staging tree as it goes — polling the staged byte
            // total yields the same byte-accurate, monotonic, ~150 ms-gated progress stream the
            // in-process engine produces, without parsing engine output.
            double lastPercent = 0.0;
            long lastPollMs = 0;
            var clock = Stopwatch.StartNew();

            Task<bool> run = _sevenZip.ExtractArchiveAsync(archivePath, stagingRoot, cancellationToken);

            while (!run.IsCompleted)
            {
                try { await Task.Delay(ProgressGateIntervalMs, cancellationToken).ConfigureAwait(false); }
                catch (OperationCanceledException)
                {
                    await run.ConfigureAwait(false); // the kill registration fired — surface the cancellation
                    throw;
                }

                if (progress is null || clock.ElapsedMilliseconds - lastPollMs < ProgressGateIntervalMs) continue;
                lastPollMs = clock.ElapsedMilliseconds;

                long staged = StagedBytes(stagingRoot);
                double percent = totalUncompressedBytes > 0
                    ? Math.Clamp(100.0 * staged / totalUncompressedBytes, 0, 99.9)
                    : 0.0;
                if (percent < lastPercent) percent = lastPercent; // monotonic — never backwards
                lastPercent = percent;
                progress.Report(percent);
            }

            if (!await run.ConfigureAwait(false))
                return false; // fatal exit code (corrupt/unsupported) → caller falls back

            progress?.Report(100.0);
            return true;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (FileNotFoundException)
        {
            return false; // no 7-Zip binary available → automatic in-process fallback
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            return false; // engine failed to run → automatic in-process fallback
        }
    }

    private static long StagedBytes(string root)
    {
        try
        {
            var options = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true };
            long total = 0;
            foreach (string file in Directory.EnumerateFiles(root, "*", options))
            {
                try { total += new FileInfo(file).Length; }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
            return total;
        }
        catch (IOException) { return 0; }
        catch (UnauthorizedAccessException) { return 0; }
    }
}

/// <summary>
/// The extraction PIPELINE (unit 5): 7-Zip FIRST, SharpCompress in-process as the automatic
/// fallback — orchestrated over the shared units (inspector → 7za/SharpCompress Phase A →
/// route table + placement Phase B). The whole flow only ever extracts into %TEMP%\bs-extract-*
/// staging folders and reaches the SPT root through atomic/merge moves, so a failure or
/// cancellation at ANY point leaves no partial install behind (staging is swept in finally,
/// and never-writable outcomes throw before anything is placed).
/// </summary>
public static class ExtractionPipeline
{
    /// <summary>Extracts <paramref name="archivePath"/> into the SPT root.
    /// Throws the canonical InvalidDataException messages for HTML/unknown bytes.
    /// <paramref name="sevenZipBinaryOverride"/>: harness hook (Linux 7zz); null in production.</summary>
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

        // Truncated/corrupt detection BEFORE placement: layout analysis opens + walks the whole
        // central directory; a truncated body throws here, before any staging or move happens.
        layout ??= ArchiveInspector.Default.Analyze(archivePath, kind);

        // ---- 7-Zip first (bundled official engine) --------------------------------------
        var sevenZip = new SevenZipExtractor(sevenZipBinaryOverride);
        string staging = PlacementEngine.NewStagingRoot();
        bool extractedBySevenZip = false;
        try
        {
            Directory.CreateDirectory(staging);
            long total = TotalUncompressedBytes(archivePath, kind);
            extractedBySevenZip = await sevenZip.TryExtractToStagingAsync(
                archivePath, kind, staging, total, progress, cancellationToken).ConfigureAwait(false);

            if (extractedBySevenZip)
            {
                // 7za materializes directory entries itself — Phase B over its staged tree.
                PlacementEngine.Default.MoveStagedTree(staging, sptRoot, layout, payloadTargetDir, looseFolderName,
                    Array.Empty<string>());
                return;
            }
        }
        finally
        {
            // Fully-moved pieces leave an empty shell; failed runs leave everything — both go.
            PlacementEngine.DeleteDirectoryRobust(staging);
        }

        // ---- automatic fallback: in-process SharpCompress staged engine ------------------
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

    private static long TotalUncompressedBytes(string archivePath, ArchiveKind kind)
    {
        try
        {
            return ArchiveInspector.Default.ListEntries(archivePath, kind)
                .Where(e => !e.IsDirectory)
                .Sum(e => e.Size);
        }
        catch
        {
            return 0; // unknown total → 7za progress stays at 0 until the final 100 report
        }
    }
}
