using System.IO;
using System.IO.Compression;
using Blacksite.Models;

namespace Blacksite.Services.Extraction;

/// <summary>
/// Unit 4a of the extraction architecture: PHASE A EXTRACTION in-process via SharpCompress /
/// System.IO.Compression — the staged parallel engine. Raw-extracts every archive entry
/// verbatim into a %TEMP%\bs-extract-* staging folder:
///   tiny files (&lt; 1 MB) run CONCURRENTLY (Parallel.ForEachAsync over ProcessorCount
///   batches, one independent archive reader per batch — readers are not thread-safe), large
///   media/bundle files extract sequentially alongside them (bounded RAM). Progress is tracked
///   in BYTES (Interlocked) and dispatched at most once per 150 ms (in-between updates are
///   dropped, never queued); the percent is monotonic and reaches exactly 100.
/// Cancellation aborts cleanly at any point — the caller's finally-sweep removes the staging
/// folder, so no partial install can ever survive.
/// </summary>
public sealed class SharpCompressExtractor
{
    public static SharpCompressExtractor Instance { get; } = new();

    /// <summary>Extraction stream-copy buffer: 1 MB.</summary>
    private const int CopyBufferSize = 1024 * 1024;

    /// <summary>Files under this size (1 MB) are "tiny" (database JSONs, configs) and extract
    /// concurrently; larger media/bundle files extract sequentially to prevent RAM spikes.</summary>
    private const long SmallFileThresholdBytes = 1024 * 1024;

    /// <summary>Progress dispatch gate: at most ONE progress update per 150 ms — updates that
    /// arrive between intervals are dropped entirely (not queued), so thousands of tiny files
    /// can never flood the WPF dispatcher.</summary>
    private const int ProgressGateIntervalMs = 150;

    /// <summary>Raw-extracts every entry into <paramref name="stagingRoot"/>. Returns the
    /// archive's directory-entry list (mapped empty folders materialize at the destination).</summary>
    public async Task<List<string>> ExtractAllEntriesToStagingAsync(
        string archivePath, ArchiveKind kind, string stagingRoot,
        IProgress<double>? progress, CancellationToken cancellationToken)
    {
        List<(string Path, long Size)> files;
        List<string> directoryEntries;
        using (ArchiveInspector.UnifiedArchive meta = ArchiveInspector.UnifiedArchive.Open(archivePath, kind))
        {
            files = meta.Entries
                .Where(e => !e.IsDirectory && e.Path.Length > 0)
                .Select(e => (e.Path, e.Size ?? 0))
                .ToList();
            directoryEntries = meta.Entries
                .Where(e => e.IsDirectory && e.Path.Length > 0)
                .Select(e => e.Path)
                .ToList();
        }
        long totalBytes = files.Sum(f => f.Size);

        // Pre-create every directory up front — one sequential pass, no concurrent-mkdir churn.
        foreach (string dir in directoryEntries)
        {
            string dirPath = Path.GetFullPath(Path.Combine(stagingRoot, dir));
            if (PlacementEngine.IsPathInside(stagingRoot, dirPath)) Directory.CreateDirectory(dirPath);
        }
        foreach ((string filePath, _) in files)
        {
            string fileDir = Path.GetDirectoryName(Path.GetFullPath(Path.Combine(stagingRoot, filePath)))!;
            if (PlacementEngine.IsPathInside(stagingRoot, fileDir)) Directory.CreateDirectory(fileDir);
        }

        // ---- progress: BYTE totals (Interlocked) + 150 ms dispatch gate (in-between updates are dropped)
        long bytesExtracted = 0;
        double lastDispatchedPercent = 0.0;
        long lastDispatchedMs = 0;
        var gateLock = new object();
        var gateClock = System.Diagnostics.Stopwatch.StartNew();

        void MaybeReportProgress()
        {
            if (progress is null) return;
            lock (gateLock)
            {
                if (gateClock.ElapsedMilliseconds - lastDispatchedMs < ProgressGateIntervalMs) return; // dropped
                lastDispatchedMs = gateClock.ElapsedMilliseconds;
                double percent = totalBytes > 0 ? 100.0 * Interlocked.Read(ref bytesExtracted) / totalBytes : 100.0;
                if (percent < lastDispatchedPercent) percent = lastDispatchedPercent; // the UI never goes backwards
                lastDispatchedPercent = percent;
                progress.Report(percent);
            }
        }

        progress?.Report(0.0);
        cancellationToken.ThrowIfCancellationRequested();

        // ---- split: tiny files extract concurrently; large media/bundle files stay sequential (RAM ceiling)
        List<string> smallFiles = files.Where(f => f.Size < SmallFileThresholdBytes).Select(f => f.Path).ToList();
        List<string> largeFiles = files.Where(f => f.Size >= SmallFileThresholdBytes).Select(f => f.Path).ToList();
        var sizeByPath = files.GroupBy(f => f.Path, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.Sum(x => x.Size), StringComparer.Ordinal);

        Task smallWave = smallFiles.Count == 0
            ? Task.CompletedTask
            : Parallel.ForEachAsync(
                PartitionIntoBatches(smallFiles, Environment.ProcessorCount),
                new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount, CancellationToken = cancellationToken },
                async (batch, ct) =>
                {
                    // One independent archive reader per batch — archive readers are not thread-safe.
                    using ArchiveInspector.UnifiedArchive archive = ArchiveInspector.UnifiedArchive.Open(archivePath, kind);
                    Dictionary<string, ArchiveInspector.UnifiedArchive.Entry> entryIndex = BuildEntryIndex(archive);
                    foreach (string entryPath in batch)
                    {
                        ct.ThrowIfCancellationRequested();
                        await ExtractEntryToStagingAsync(archive, entryIndex, entryPath, stagingRoot).ConfigureAwait(false);
                        Interlocked.Add(ref bytesExtracted, sizeByPath[entryPath]);
                        MaybeReportProgress();
                    }
                });

        Task largeWave = largeFiles.Count == 0
            ? Task.CompletedTask
            : Task.Run(async () =>
            {
                using ArchiveInspector.UnifiedArchive archive = ArchiveInspector.UnifiedArchive.Open(archivePath, kind);
                Dictionary<string, ArchiveInspector.UnifiedArchive.Entry> entryIndex = BuildEntryIndex(archive);
                foreach (string entryPath in largeFiles) // sequential — one large stream at a time
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    await ExtractEntryToStagingAsync(archive, entryIndex, entryPath, stagingRoot).ConfigureAwait(false);
                    Interlocked.Add(ref bytesExtracted, sizeByPath[entryPath]);
                    MaybeReportProgress();
                }
            }, cancellationToken);

        await Task.WhenAll(smallWave, largeWave).ConfigureAwait(false);
        progress?.Report(100.0);
        return directoryEntries;
    }

    /// <summary>Indexes a worker's archive entries by path (first occurrence wins for archives
    /// with duplicate names — matching the legacy last-write order semantics per file).</summary>
    private static Dictionary<string, ArchiveInspector.UnifiedArchive.Entry> BuildEntryIndex(ArchiveInspector.UnifiedArchive archive)
    {
        var index = new Dictionary<string, ArchiveInspector.UnifiedArchive.Entry>(StringComparer.Ordinal);
        foreach (ArchiveInspector.UnifiedArchive.Entry entry in archive.Entries)
            if (!entry.IsDirectory && entry.Path.Length > 0 && !index.ContainsKey(entry.Path))
                index[entry.Path] = entry;
        return index;
    }

    /// <summary>Splits the list into at most <paramref name="batches"/> contiguous batches.</summary>
    private static List<List<string>> PartitionIntoBatches(List<string> items, int batches)
    {
        var result = new List<List<string>>();
        if (items.Count == 0) return result;
        batches = Math.Max(1, Math.Min(batches, items.Count));
        int size = (int)Math.Ceiling(items.Count / (double)batches);
        for (int i = 0; i < items.Count; i += size)
            result.Add(items.GetRange(i, Math.Min(size, items.Count - i)));
        return result;
    }

    private static async Task ExtractEntryToStagingAsync(
        ArchiveInspector.UnifiedArchive archive,
        Dictionary<string, ArchiveInspector.UnifiedArchive.Entry> entryIndex, string entryPath, string stagingRoot)
    {
        if (!entryIndex.TryGetValue(entryPath, out ArchiveInspector.UnifiedArchive.Entry? entry))
            throw new IOException($"Archive entry disappeared: \u201C{entryPath}\u201D.");
        string destPath = Path.GetFullPath(Path.Combine(stagingRoot, entry.Path));
        if (!PlacementEngine.IsPathInside(stagingRoot, destPath))
            throw new IOException($"Blocked unsafe archive entry path: \u201C{entry.Path}\u201D."); // zip-slip
        using Stream source = archive.OpenEntry(entry);
        await WriteFileHighSpeedAsync(source, destPath).ConfigureAwait(false);
    }

    /// <summary>
    /// Streams one entry to disk with maximum-throughput I/O: a 1 MB buffer and
    /// FileOptions.Asynchronous | FileOptions.SequentialScan (overlapped writes + read-ahead
    /// hints for the OS cache manager). Existing targets are cleared first (AV-lock resilient)
    /// so extraction always creates fresh files.
    /// </summary>
    private static async Task WriteFileHighSpeedAsync(Stream source, string destPath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(destPath)!);
        if (File.Exists(destPath))
        {
            PlacementEngine.ExecuteWithLockRetry(_ =>
            {
                PlacementEngine.DeleteFileRobust(destPath);
                return true;
            });
        }

        await using var target = new FileStream(destPath, FileMode.Create, FileAccess.Write,
            FileShare.None, 1048576, FileOptions.Asynchronous | FileOptions.SequentialScan);
        await source.CopyToAsync(target, CopyBufferSize).ConfigureAwait(false);
    }
}
