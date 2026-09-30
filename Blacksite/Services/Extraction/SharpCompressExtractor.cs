using System.Buffers;
using System.IO;
using System.Threading.Channels;
using Blacksite.Models;

namespace Blacksite.Services.Extraction;

/// <summary>
/// Unit 4a of the extraction architecture: PHASE A EXTRACTION in-process via SharpCompress /
/// System.IO.Compression — the staged parallel engine. Raw-extracts every archive entry
/// verbatim into a %TEMP%\bs-extract-* staging folder:
///   tiny files (&lt; 1 MB) run CONCURRENTLY through a bounded Channel with independent archive
///   readers per worker — readers are not thread-safe; large media/bundle files extract
///   sequentially alongside them (bounded RAM). Progress is tracked
///   in BYTES (Interlocked) and dispatched at most once per 150 ms (in-between updates are
///   dropped, never queued); the percent is monotonic and reaches exactly 100.
/// Cancellation aborts cleanly at any point — the caller's finally-sweep removes the staging
/// folder, so no partial install can ever survive.
/// </summary>
public sealed class SharpCompressExtractor
{
    public static SharpCompressExtractor Instance { get; } = new();

    /// <summary>A pooled 64 KiB copy buffer stays below the LOH threshold, while retaining
    /// efficient sequential throughput for both tiny files and large bundles.</summary>
    private const int CopyBufferSize = 64 * 1024;

    /// <summary>Files under this size (1 MB) are "tiny" (database JSONs, configs) and extract
    /// concurrently; larger media/bundle files extract sequentially to bound memory and disk seeks.</summary>
    private const long SmallFileThresholdBytes = 1024 * 1024;

    /// <summary>Cap simultaneous archive readers/writers. Beyond eight, tiny-file workloads
    /// usually contend on storage while multiplying archive indexes and open handles.</summary>
    private static readonly int MaxSmallFileConcurrency = Math.Clamp(Environment.ProcessorCount, 1, 8);

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
        List<(int EntryIndex, string Path, long Size)> files;
        List<string> directoryEntries;
        using (ArchiveInspector.UnifiedArchive meta = ArchiveInspector.UnifiedArchive.Open(archivePath, kind))
        {
            // Store compact entry ordinals instead of copying a path→entry dictionary into every
            // worker. Each independent reader exposes the same archive ordering, which keeps the
            // bounded workers thread-safe without multiplying a potentially huge hash table.
            files = new List<(int EntryIndex, string Path, long Size)>(meta.Entries.Count);
            directoryEntries = new List<string>();
            var seenFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < meta.Entries.Count; i++)
            {
                ArchiveInspector.UnifiedArchive.Entry entry = meta.Entries[i];
                if (entry.Path.Length == 0) continue;
                if (entry.IsDirectory)
                    directoryEntries.Add(entry.Path);
                else if (seenFiles.Add(entry.Path))
                    files.Add((i, entry.Path, entry.Size ?? 0));
            }
        }
        long totalBytes = files.Sum(f => f.Size);

        // Pre-create unique directories up front. Thousands of JSON entries often share only a
        // handful of folders; deduplicating avoids repeated metadata syscalls and concurrent mkdirs.
        var createdDirectories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string dir in directoryEntries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            string dirPath = Path.GetFullPath(Path.Combine(stagingRoot, dir));
            if (PlacementEngine.IsPathInside(stagingRoot, dirPath) && createdDirectories.Add(dirPath))
                Directory.CreateDirectory(dirPath);
        }
        foreach (var file in files)
        {
            cancellationToken.ThrowIfCancellationRequested();
            string fileDir = Path.GetDirectoryName(Path.GetFullPath(Path.Combine(stagingRoot, file.Path)))!;
            if (PlacementEngine.IsPathInside(stagingRoot, fileDir) && createdDirectories.Add(fileDir))
                Directory.CreateDirectory(fileDir);
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

        // ---- bounded producer/consumer split: tiny files run on independent archive readers;
        // one large-file consumer streams bundles sequentially alongside the small-file workers.
        // Keep one compact file list rather than materializing separate small/large copies.
        int smallFileCount = files.Count(f => f.Size < SmallFileThresholdBytes);
        bool hasLargeFiles = files.Any(f => f.Size >= SmallFileThresholdBytes);

        async Task ExtractSmallFilesAsync()
        {
            if (smallFileCount == 0) return;

            int workerCount = Math.Min(MaxSmallFileConcurrency, smallFileCount);
            var channel = Channel.CreateBounded<(int EntryIndex, long Size)>(new BoundedChannelOptions(workerCount * 4)
            {
                SingleWriter = true,
                SingleReader = false,
                FullMode = BoundedChannelFullMode.Wait
            });

            async Task ProduceAsync()
            {
                Exception? completionError = null;
                try
                {
                    foreach (var file in files)
                    {
                        if (file.Size >= SmallFileThresholdBytes) continue;
                        cancellationToken.ThrowIfCancellationRequested();
                        await channel.Writer.WriteAsync((file.EntryIndex, file.Size), cancellationToken).ConfigureAwait(false);
                    }
                }
                catch (Exception ex)
                {
                    completionError = ex;
                    throw;
                }
                finally
                {
                    channel.Writer.TryComplete(completionError);
                }
            }

            async Task ConsumeAsync()
            {
                try
                {
                    // SharpCompress archive instances are not thread-safe; each bounded worker owns
                    // one reader for its entire lifetime and uses the shared entry ordinals.
                    using ArchiveInspector.UnifiedArchive archive = ArchiveInspector.UnifiedArchive.Open(archivePath, kind);

                    await foreach (var work in channel.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
                    {
                        if ((uint)work.EntryIndex >= (uint)archive.Entries.Count)
                            throw new IOException($"Archive entry index {work.EntryIndex} is not present in the worker reader.");
                        await ExtractEntryToStagingAsync(archive, archive.Entries[work.EntryIndex], stagingRoot, cancellationToken)
                            .ConfigureAwait(false);
                        Interlocked.Add(ref bytesExtracted, work.Size);
                        MaybeReportProgress();
                    }
                }
                catch (Exception ex)
                {
                    // Unblock a producer that is waiting on the bounded channel if a reader or
                    // destination fails; otherwise a failed worker could strand the extraction.
                    channel.Writer.TryComplete(ex);
                    throw;
                }
            }

            Task producer = ProduceAsync();
            Task[] consumers = Enumerable.Range(0, workerCount)
                .Select(_ => Task.Run(ConsumeAsync, CancellationToken.None))
                .ToArray();
            await Task.WhenAll(consumers.Append(producer)).ConfigureAwait(false);
        }

        Task largeWave = !hasLargeFiles
            ? Task.CompletedTask
            : Task.Run(async () =>
            {
                using ArchiveInspector.UnifiedArchive archive = ArchiveInspector.UnifiedArchive.Open(archivePath, kind);
                foreach (var file in files) // one massive stream at a time
                {
                    if (file.Size < SmallFileThresholdBytes) continue;
                    cancellationToken.ThrowIfCancellationRequested();
                    if ((uint)file.EntryIndex >= (uint)archive.Entries.Count)
                        throw new IOException($"Archive entry index {file.EntryIndex} is not present in the large-file reader.");
                    await ExtractEntryToStagingAsync(archive, archive.Entries[file.EntryIndex], stagingRoot, cancellationToken)
                        .ConfigureAwait(false);
                    Interlocked.Add(ref bytesExtracted, file.Size);
                    MaybeReportProgress();
                }
            }, CancellationToken.None);

        await Task.WhenAll(ExtractSmallFilesAsync(), largeWave).ConfigureAwait(false);
        progress?.Report(100.0);
        return directoryEntries;
    }

    private static async Task ExtractEntryToStagingAsync(
        ArchiveInspector.UnifiedArchive archive,
        ArchiveInspector.UnifiedArchive.Entry entry, string stagingRoot, CancellationToken cancellationToken)
    {
        if (entry.IsDirectory || entry.Path.Length == 0)
            throw new IOException($"Archive entry is not a file: \u201C{entry.Path}\u201D.");
        string destPath = Path.GetFullPath(Path.Combine(stagingRoot, entry.Path));
        if (!PlacementEngine.IsPathInside(stagingRoot, destPath))
            throw new IOException($"Blocked unsafe archive entry path: \u201C{entry.Path}\u201D."); // zip-slip
        using Stream source = archive.OpenEntry(entry);
        await WriteFileHighSpeedAsync(source, destPath, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Streams one entry with a reusable sub-LOH buffer and true async FileStream I/O.
    /// Small files share pooled buffers over time instead of allocating a 1 MB array per entry;
    /// the bounded worker count caps simultaneous readers/writers. Cancellation is checked on
    /// both reads and writes so a multi-gigabyte bundle can be aborted promptly.
    /// </summary>
    private static async Task WriteFileHighSpeedAsync(Stream source, string destPath, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(destPath)!);
        cancellationToken.ThrowIfCancellationRequested();
        if (File.Exists(destPath))
        {
            PlacementEngine.ExecuteWithLockRetry(_ =>
            {
                PlacementEngine.DeleteFileRobust(destPath);
                return true;
            });
        }

        byte[] buffer = ArrayPool<byte>.Shared.Rent(CopyBufferSize);
        try
        {
            await using var target = new FileStream(destPath, FileMode.Create, FileAccess.Write,
                FileShare.None, CopyBufferSize, FileOptions.Asynchronous | FileOptions.SequentialScan);
            int read;
            while ((read = await source.ReadAsync(buffer.AsMemory(0, CopyBufferSize), cancellationToken)
                       .ConfigureAwait(false)) != 0)
            {
                await target.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
            }
            await target.FlushAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }
}
