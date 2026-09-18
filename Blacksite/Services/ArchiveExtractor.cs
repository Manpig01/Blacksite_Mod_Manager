using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using SharpCompress.Archives;

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
/// Unified archive access (ZIP via System.IO.Compression, RAR/7z via SharpCompress) plus the
/// real-world layout handling observed in sp-mod.com packages:
///   • entries rooted at user/… or BepInEx/…            → extract into the SPT root
///   • wrapper folders like "SPT/user/mods/…"           → wrapper stripped, extract into the SPT root
///   • backslash separators (Windows-built archives)    → normalized
///   • bare payload folders (e.g. "ScavCat/…")          → routed to user\mods or BepInEx\plugins
///     (client vs server decided by [BepInPlugin] metadata / package.json / data folders)
///   • loose payload files                              → wrapped into a named folder
/// Every write is zip-slip guarded and force-overwrites read-only/broken-mode files.
/// </summary>
public static class ArchiveExtractor
{
    // ------------------------------------------------------------------ detection

    public static ArchiveKind Detect(string filePath)
    {
        byte[] head = new byte[512];
        int read;
        try
        {
            using var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            read = fs.Read(head);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return ArchiveKind.Unknown;
        }

        if (read >= 4 && head[0] == 0x50 && head[1] == 0x4B && (head[2] == 0x03 || head[2] == 0x05 || head[2] == 0x07))
            return ArchiveKind.Zip;
        if (read >= 7 && head[0] == (byte)'R' && head[1] == (byte)'a' && head[2] == (byte)'r' && head[3] == (byte)'!' && head[4] == 0x1A)
            return ArchiveKind.Rar;
        if (read >= 6 && head[0] == 0x37 && head[1] == 0x7A && head[2] == 0xBC && head[3] == 0xAF && head[4] == 0x27 && head[5] == 0x1C)
            return ArchiveKind.SevenZip;

        // Dead file links answer with a web page (HTML) or a small JSON error payload —
        // neither is an archive, and both must be reported clearly instead of exploding in the extractor.
        string asText = System.Text.Encoding.UTF8.GetString(head, 0, read).TrimStart('\uFEFF', ' ', '\t', '\r', '\n');
        if (asText.StartsWith("<!DOCTYPE", StringComparison.OrdinalIgnoreCase) ||
            asText.StartsWith("<html", StringComparison.OrdinalIgnoreCase) ||
            asText.StartsWith("<?xml", StringComparison.OrdinalIgnoreCase) ||
            asText.StartsWith("<", StringComparison.Ordinal) ||
            asText.StartsWith("{\"", StringComparison.Ordinal) ||
            asText.StartsWith("[{", StringComparison.Ordinal))
            return ArchiveKind.Html;

        return ArchiveKind.Unknown;
    }

    /// <summary>
    /// Magic-byte detection with an extension-based fallback. The header check is authoritative;
    /// when it cannot recognize the format (e.g. self-extracting installers that prepend data
    /// before the zip signature, or unusual packers), the file extension routes the open attempt
    /// to the matching reader — which then either succeeds or fails with a clear error.
    /// </summary>
    public static ArchiveKind DetectWithExtensionFallback(string filePath)
    {
        ArchiveKind kind = Detect(filePath);
        if (kind != ArchiveKind.Unknown) return kind;

        string ext = Path.GetExtension(filePath).ToLowerInvariant();
        return ext switch
        {
            ".zip" => ArchiveKind.Zip,
            ".rar" => ArchiveKind.Rar,
            ".7z"  => ArchiveKind.SevenZip,
            _      => ArchiveKind.Unknown
        };
    }

    // ------------------------------------------------------------- structural validation

    /// <summary>
    /// Real structural integrity check for a downloaded archive — the arbiter used when the
    /// API's content_length metadata disagrees with the bytes actually served (a live-verified
    /// scenario: sp-mod metadata said 117,232,656 while the host's file is 117,232,647).
    /// For zips this requires an intact End-of-Central-Directory record and readable central
    /// directory, i.e. the file is complete; a body truncated mid-file cannot enumerate entries.
    /// </summary>
    public static bool IsStructurallyIntactArchive(string filePath)
    {
        try
        {
            ArchiveKind kind = Detect(filePath);
            switch (kind)
            {
                case ArchiveKind.Zip:
                    using (var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                    using (var zip = OpenZipRobust(fs))
                    {
                        return zip.Entries.Count > 0;
                    }
                case ArchiveKind.Rar:
                case ArchiveKind.SevenZip:
                    using (var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                    using (IArchive archive = ArchiveFactory.Open(fs))
                    {
                        return archive.Entries.Any(e => !e.IsDirectory && e.Size > 0);
                    }
                default:
                    return false;
            }
        }
        catch (Exception ex) when (ex is IOException or InvalidDataException or UnauthorizedAccessException
                                    or InvalidOperationException
                                    or SharpCompress.Common.InvalidFormatException
                                    or SharpCompress.Common.IncompleteArchiveException)
        {
            return false;
        }
    }

    // ------------------------------------------------------------- high-speed I/O helpers

    /// <summary>Extraction stream-copy buffer: 1 MB (spec floor: 80 KB, ceiling: 1 MB).</summary>
    private const int CopyBufferSize = 1024 * 1024;

    /// <summary>
    /// Streams one entry to disk with maximum-throughput I/O: a 1 MB buffer and
    /// FileOptions.Asynchronous | FileOptions.SequentialScan (overlapped writes + read-ahead
    /// hints for the OS cache manager). Existing targets are cleared first so extraction
    /// always creates fresh files (read-only/broken-mode survivors included).
    /// </summary>
    private static async Task WriteFileHighSpeedAsync(Stream source, string destPath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(destPath)!);
        if (File.Exists(destPath))
        {
            try { File.SetAttributes(destPath, FileAttributes.Normal); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or PlatformNotSupportedException) { }
            File.Delete(destPath);
        }

        // Spec-exact destination stream: 1 MB buffer + overlapped writes + read-ahead hints.
        await using var target = new FileStream(destPath, FileMode.Create, FileAccess.Write,
            FileShare.None, 1048576, FileOptions.Asynchronous | FileOptions.SequentialScan);
        await source.CopyToAsync(target, CopyBufferSize).ConfigureAwait(false);
    }

    /// <summary>
    /// Remaps canonical mod folders inside an archive to the user's CONFIGURED subpaths
    /// (Settings tab): "user/mods/..." → server path, "BepInEx/plugins/..." → client path.
    /// Entries keep their canonical location when the defaults are in use.
    /// </summary>
    private static string RemapConfiguredPaths(string mappedRelative)
    {
        var settings = SettingsService.Instance;
        if (settings is null) return mappedRelative;

        string server = settings.ServerModPathEffective;
        if (server != DefaultServerRoot && IsOrStartsWith(mappedRelative, DefaultServerRoot))
            return ReplacePrefix(mappedRelative, DefaultServerRoot, server);

        string client = settings.ClientModPathEffective;
        if (client != DefaultClientRoot && IsOrStartsWith(mappedRelative, DefaultClientRoot))
            return ReplacePrefix(mappedRelative, DefaultClientRoot, client);

        return mappedRelative;
    }

    private const string DefaultServerRoot = "user/mods";
    private const string DefaultClientRoot = "BepInEx/plugins";

    private static bool IsOrStartsWith(string path, string prefix) =>
        string.Equals(path, prefix, StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith(prefix + "/", StringComparison.OrdinalIgnoreCase);

    private static string ReplacePrefix(string path, string prefix, string replacement) =>
        path.Length == prefix.Length ? replacement : replacement + path[prefix.Length..];

    /// <summary>
    /// Zip extraction with live progress into the given root, powered by the staged parallel
    /// engine (unique %TEMP% staging folder → concurrent tiny-file extraction → atomic move).
    /// Mapped entries (user/…, BepInEx/…, EscapeFromTarkov_Data/…) are remapped to the configured
    /// mod paths; everything else lands verbatim at the destination root.
    /// </summary>
    public static Task ExtractArchiveWithProgressAsync(
        string zipPath, string destinationRoot, IProgress<double>? progress)
        => ExtractSmartAsync(zipPath, ArchiveKind.Zip, destinationRoot,
            payloadTargetDir: Path.GetFullPath(destinationRoot),
            looseFolderName: null,
            layout: null,
            progress: progress);

    // ------------------------------------------------------------------ robust zip open

    /// <summary>
    /// Opens a zip for reading, tolerating data PREPENDED before the zip signature (self-extracting
    /// installers, download-stub wrappers). The standard reader throws InvalidDataException for such
    /// files; we then locate the true zip start (first local-file-header signature) and reopen the
    /// archive through an offset-shifted read-only view of the same stream.
    /// </summary>
    internal static ZipArchive OpenZipRobust(Stream stream)
    {
        try
        {
            var archive = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true);
            _ = archive.Entries.Count; // the central directory parses LAZILY — force it now so the fallback engages
            return archive;
        }
        catch (InvalidDataException)
        {
            long zipStart = FindZipStart(stream);
            if (zipStart <= 0) throw;
            var fallback = new ZipArchive(new OffsetViewStream(stream, zipStart), ZipArchiveMode.Read, leaveOpen: true);
            _ = fallback.Entries.Count; // throws naturally if the shifted view is still unreadable
            return fallback;
        }
    }

    /// <summary>Scans up to 8 MB of the stream head for the first local-file-header signature (PK\x03\x04).</summary>
    private static long FindZipStart(Stream stream)
    {
        const long maxScan = 8 * 1024 * 1024;
        stream.Position = 0;
        var buffer = new byte[64 * 1024];
        long absoluteBase = 0;
        int overlap = 0;

        while (absoluteBase <= maxScan)
        {
            int read = stream.Read(buffer, overlap, buffer.Length - overlap);
            if (read <= 0) break;
            int total = overlap + read;
            int limit = total - 4;
            for (int i = 0; i <= limit; i++)
            {
                if (buffer[i] == 0x50 && buffer[i + 1] == 0x4B && buffer[i + 2] == 0x03 && buffer[i + 3] == 0x04)
                    return absoluteBase + i;
            }
            Buffer.BlockCopy(buffer, total - 3, buffer, 0, 3);
            absoluteBase += total - 3;
            overlap = 3;
        }
        return -1;
    }

    /// <summary>Read-only, seekable view of a stream starting <paramref name="offset"/> bytes in.</summary>
    private sealed class OffsetViewStream : Stream
    {
        private readonly Stream _inner;
        private readonly long _offset;

        public OffsetViewStream(Stream inner, long offset)
        {
            _inner = inner;
            _offset = offset;
        }

        public override bool CanRead => _inner.CanRead;
        public override bool CanSeek => _inner.CanSeek;
        public override bool CanWrite => false;

        public override long Length => _inner.Length - _offset;

        public override long Position
        {
            get => _inner.Position - _offset;
            set => _inner.Position = value + _offset;
        }

        public override int Read(byte[] buffer, int offset, int count) => _inner.Read(buffer, offset, count);
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Flush() { }

        public override long Seek(long offset, SeekOrigin origin) => origin switch
        {
            SeekOrigin.Begin => _inner.Seek(offset + _offset, SeekOrigin.Begin) - _offset,
            SeekOrigin.Current => _inner.Seek(offset, SeekOrigin.Current) - _offset,
            // End-relative positions are identical for both streams (same end, shifted start).
            _ => _inner.Seek(offset, SeekOrigin.End) - _offset
        };
    }

    // ------------------------------------------------------------------ unified archive

    private sealed class UnifiedArchive : IDisposable
    {
        private readonly ZipArchive? _zip;
        private readonly IArchive? _sharp;
        private readonly FileStream _stream;

        public IReadOnlyList<Entry> Entries { get; }

        public sealed record Entry(string Path, bool IsDirectory, long? Size, object Native);

        private UnifiedArchive(FileStream stream, ZipArchive? zip, IArchive? sharp, List<Entry> entries)
        {
            _stream = stream; _zip = zip; _sharp = sharp; Entries = entries;
        }

        public static UnifiedArchive Open(string filePath, ArchiveKind kind)
        {
            var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            try
            {
                var entries = new List<Entry>();
                if (kind == ArchiveKind.Zip)
                {
                    var zip = OpenZipRobust(stream);
                    foreach (ZipArchiveEntry e in zip.Entries)
                        entries.Add(new Entry(Normalize(e.FullName), IsDirPath(e.FullName), e.Length, e));
                    return new UnifiedArchive(stream, zip, null, entries);
                }
                else
                {
                    IArchive archive = ArchiveFactory.Open(stream, new SharpCompress.Readers.ReaderOptions { LeaveStreamOpen = true });
                    foreach (IArchiveEntry e in archive.Entries)
                        entries.Add(new Entry(Normalize(e.Key ?? string.Empty), e.IsDirectory, e.Size, e));
                    return new UnifiedArchive(stream, null, archive, entries);
                }
            }
            catch
            {
                stream.Dispose();
                throw;
            }
        }

        public Stream OpenEntry(Entry entry) => entry.Native switch
        {
            ZipArchiveEntry zipEntry => zipEntry.Open(),
            IArchiveEntry scEntry => scEntry.OpenEntryStream(),
            _ => throw new InvalidOperationException("Unknown archive entry type.")
        };

        public void Dispose()
        {
            _zip?.Dispose();
            _sharp?.Dispose();
            _stream.Dispose();
        }
    }

    private static string Normalize(string path) => path.Replace('\\', '/');

    private static bool IsDirPath(string path) => path.EndsWith('/') || path.EndsWith('\\');

    // ------------------------------------------------------------------ layout analysis

    /// <summary>Maps an entry path to its SPT-root-relative path, stripping a wrapper folder
    /// ("SPT/user/mods/x" → "user/mods/x"). Returns null for payload entries.</summary>
    private static string? MapToRoot(string normalizedPath)
    {
        if (StartsWithRootFolder(normalizedPath)) return normalizedPath;

        int slash = normalizedPath.IndexOf('/');
        if (slash > 0 && slash < normalizedPath.Length - 1)
        {
            string rest = normalizedPath[(slash + 1)..];
            if (StartsWithRootFolder(rest)) return rest;
        }
        return null;
    }

    private static bool StartsWithRootFolder(string p) =>
        p.StartsWith("user/", StringComparison.OrdinalIgnoreCase) ||
        p.StartsWith("BepInEx/", StringComparison.OrdinalIgnoreCase) ||
        // Game-data overlays (asset/audio replacement mods) belong in the install root's
        // EscapeFromTarkov_Data — never inside a mod folder (SPT 4.x layout keeps it at the root).
        p.StartsWith("EscapeFromTarkov_Data/", StringComparison.OrdinalIgnoreCase);

    public static ArchiveLayout Analyze(string filePath, ArchiveKind kind)
    {
        using var archive = UnifiedArchive.Open(filePath, kind);
        return Analyze(archive);
    }

    private static ArchiveLayout Analyze(UnifiedArchive archive)
    {
        bool rootStructured = false;
        bool wrapped = false;
        var payloadFiles = new List<UnifiedArchive.Entry>();
        var payloadTopSegments = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (UnifiedArchive.Entry entry in archive.Entries)
        {
            if (entry.IsDirectory || entry.Path.Length == 0) continue;

            string? mapped = MapToRoot(entry.Path);
            if (mapped is not null)
            {
                rootStructured = true;
                if (!string.Equals(mapped, entry.Path, StringComparison.Ordinal)) wrapped = true;
                continue;
            }

            payloadFiles.Add(entry);
            int slash = entry.Path.IndexOf('/');
            payloadTopSegments.Add(slash > 0 ? entry.Path[..slash] : entry.Path);
        }

        string? payloadTopFolder = null;
        if (payloadFiles.Count > 0 && payloadTopSegments.Count == 1)
        {
            string only = payloadTopSegments.First();
            // A genuine folder (not a single loose file named the same)
            if (payloadFiles.Any(f => f.Path.StartsWith(only + "/", StringComparison.OrdinalIgnoreCase)))
                payloadTopFolder = only;
        }

        bool looksClient = payloadFiles.Any(f => IsDll(f.Path)) && ProbePayloadForBepInPlugin(archive, payloadFiles);

        // package.json / data folders are strong server-mod markers that outrank a lone plugin probe
        bool serverMarkers = payloadFiles.Any(f =>
            f.Path.EndsWith("package.json", StringComparison.OrdinalIgnoreCase) ||
            f.Path.Contains("/data/", StringComparison.OrdinalIgnoreCase) ||
            f.Path.StartsWith("data/", StringComparison.OrdinalIgnoreCase));

        return new ArchiveLayout(rootStructured, wrapped, payloadFiles.Count > 0, payloadTopFolder,
            PayloadLooksClient: looksClient && !serverMarkers);
    }

    private static bool IsDll(string path) => path.EndsWith(".dll", StringComparison.OrdinalIgnoreCase);

    /// <summary>Extracts up to 4 payload DLLs into memory and checks them for [BepInPlugin].</summary>
    private static bool ProbePayloadForBepInPlugin(UnifiedArchive archive, List<UnifiedArchive.Entry> payloadFiles)
    {
        const long maxProbeBytes = 64 * 1024 * 1024;
        int probed = 0;
        foreach (UnifiedArchive.Entry entry in payloadFiles.Where(f => IsDll(f.Path)))
        {
            if (probed++ >= 4) break;
            if (entry.Size is > maxProbeBytes) continue;
            try
            {
                using Stream entryStream = archive.OpenEntry(entry);
                using var ms = new MemoryStream();
                entryStream.CopyTo(ms, 128 * 1024);
                if (ms.Length > maxProbeBytes) continue;
                ms.Position = 0;
                if (PluginMetadata.TryReadBepInPlugin(ms) is not null) return true;
            }
            catch (Exception ex) when (ex is IOException or InvalidOperationException or NotSupportedException)
            {
                // unprobeable entry — keep going
            }
        }
        return false;
    }

    // ------------------------------------------------------------------ staged high-speed extraction

    /// <summary>Files under this size (1 MB) are "tiny" (database JSONs, configs) and extract
    /// concurrently; larger media/bundle files extract sequentially to prevent RAM spikes.</summary>
    private const long SmallFileThresholdBytes = 1024 * 1024;

    /// <summary>Progress dispatch gate: at most ONE UI update per 150 ms — updates that arrive
    /// between intervals are dropped entirely (not queued), so thousands of tiny files can never
    /// flood the WPF dispatcher.</summary>
    private const int ProgressGateIntervalMs = 150;

    /// <summary>Unique staging folder in Path.GetTempPath() for one extraction run.</summary>
    private static string NewStagingRoot() =>
        Path.Combine(Path.GetTempPath(), "bs-extract-" + Guid.NewGuid().ToString("N")[..12]);

    /// <summary>
    /// Extracts an archive into the SPT root with full layout handling — aggressively optimized
    /// for archives with thousands of tiny files (SPT database mods):
    ///   Phase A — every entry is raw-extracted (archive structure verbatim) into a unique
    ///             %TEMP%\bs-extract-* staging folder: tiny files (&lt; 1 MB) run CONCURRENTLY
    ///             (Parallel.ForEachAsync over ProcessorCount batches, one independent archive
    ///             reader per batch) while large media/bundle files extract sequentially
    ///             alongside them (bounded RAM). Progress is tracked in BYTES (Interlocked) and
    ///             dispatched at most once per 150 ms.
    ///   Phase B — with every stream closed, the staged tree moves into the SPT root at the
    ///             highest possible directory granularity: brand-new mod folders land via a
    ///             single atomic Directory.Move (a rename — the live game directory never sees
    ///             per-file writes, which is what triggers real-time AV scans file-by-file);
    ///             merging into existing trees recurses per child; cross-volume moves fall back
    ///             to high-speed per-child moves.
    /// payloadTargetDir: where bare payload folders/files go (an already-known mod parent such as
    /// user\mods or BepInEx\plugins). When null, payload is routed by its classification.
    /// looseFolderName: folder name to wrap loose (top-folder-less) payload files into.
    /// </summary>
    public static async Task ExtractSmartAsync(
        string archivePath, ArchiveKind kind, string sptRoot,
        string? payloadTargetDir = null, string? looseFolderName = null, ArchiveLayout? layout = null,
        IProgress<double>? progress = null)
    {
        if (kind is ArchiveKind.Html or ArchiveKind.Unknown)
            throw new InvalidDataException(kind == ArchiveKind.Html
                ? "The download URL returned a web page or error payload instead of an archive (the file link is probably dead — open the mod page and download manually)."
                : "The downloaded file is not a recognized archive (zip/rar/7z).");

        layout ??= Analyze(archivePath, kind);

        string stagingRoot = NewStagingRoot();
        try
        {
            Directory.CreateDirectory(stagingRoot);
            List<string> directoryEntries = await ExtractAllEntriesToStagingAsync(archivePath, kind, stagingRoot, progress).ConfigureAwait(false);
            MoveStagingIntoPlace(stagingRoot, sptRoot, layout, payloadTargetDir, looseFolderName, directoryEntries);
        }
        finally
        {
            // Fully-moved pieces leave an empty shell; failed runs leave everything — both go.
            DeleteDirectoryRobust(stagingRoot);
        }
    }

    /// <summary>Phase A: raw-extracts every archive entry into the staging folder — tiny files
    /// concurrently on ProcessorCount workers, large files sequentially — with byte-gated
    /// progress. Returns the archive's directory-entry list for Phase B.</summary>
    private static async Task<List<string>> ExtractAllEntriesToStagingAsync(
        string archivePath, ArchiveKind kind, string stagingRoot, IProgress<double>? progress)
    {
        List<(string Path, long Size)> files;
        List<string> directoryEntries;
        using (UnifiedArchive meta = UnifiedArchive.Open(archivePath, kind))
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
            if (IsPathInside(stagingRoot, dirPath)) Directory.CreateDirectory(dirPath);
        }
        foreach ((string filePath, _) in files)
        {
            string fileDir = Path.GetDirectoryName(Path.GetFullPath(Path.Combine(stagingRoot, filePath)))!;
            if (IsPathInside(stagingRoot, fileDir)) Directory.CreateDirectory(fileDir);
        }

        // ---- progress: BYTE totals (Interlocked) + 150 ms dispatch gate (in-between updates are dropped)
        long bytesExtracted = 0;
        double lastDispatchedPercent = 0.0;
        long lastDispatchedMs = 0;
        var gateLock = new object();
        var gateClock = Stopwatch.StartNew();

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

        // ---- split: tiny files extract concurrently; large media/bundle files stay sequential (RAM ceiling)
        List<string> smallFiles = files.Where(f => f.Size < SmallFileThresholdBytes).Select(f => f.Path).ToList();
        List<string> largeFiles = files.Where(f => f.Size >= SmallFileThresholdBytes).Select(f => f.Path).ToList();
        var sizeByPath = files.GroupBy(f => f.Path, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.Sum(x => x.Size), StringComparer.Ordinal);

        Task smallWave = smallFiles.Count == 0
            ? Task.CompletedTask
            : Parallel.ForEachAsync(
                PartitionIntoBatches(smallFiles, Environment.ProcessorCount),
                new ParallelOptions { MaxDegreeOfParallelism = Environment.ProcessorCount },
                async (batch, cancellationToken) =>
                {
                    // One independent archive reader per batch — archive readers are not thread-safe.
                    using UnifiedArchive archive = UnifiedArchive.Open(archivePath, kind);
                    Dictionary<string, UnifiedArchive.Entry> entryIndex = BuildEntryIndex(archive);
                    foreach (string entryPath in batch)
                    {
                        await ExtractEntryToStagingAsync(archive, entryIndex, entryPath, stagingRoot).ConfigureAwait(false);
                        Interlocked.Add(ref bytesExtracted, sizeByPath[entryPath]);
                        MaybeReportProgress();
                    }
                });

        Task largeWave = largeFiles.Count == 0
            ? Task.CompletedTask
            : Task.Run(async () =>
            {
                using UnifiedArchive archive = UnifiedArchive.Open(archivePath, kind);
                Dictionary<string, UnifiedArchive.Entry> entryIndex = BuildEntryIndex(archive);
                foreach (string entryPath in largeFiles) // sequential — one large stream at a time
                {
                    await ExtractEntryToStagingAsync(archive, entryIndex, entryPath, stagingRoot).ConfigureAwait(false);
                    Interlocked.Add(ref bytesExtracted, sizeByPath[entryPath]);
                    MaybeReportProgress();
                }
            });

        await Task.WhenAll(smallWave, largeWave).ConfigureAwait(false);
        progress?.Report(100.0);
        return directoryEntries;
    }

    /// <summary>Indexes a worker's archive entries by path (first occurrence wins for archives
    /// with duplicate names — matching the legacy last-write order semantics per file).</summary>
    private static Dictionary<string, UnifiedArchive.Entry> BuildEntryIndex(UnifiedArchive archive)
    {
        var index = new Dictionary<string, UnifiedArchive.Entry>(StringComparer.Ordinal);
        foreach (UnifiedArchive.Entry entry in archive.Entries)
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
        UnifiedArchive archive, Dictionary<string, UnifiedArchive.Entry> entryIndex, string entryPath, string stagingRoot)
    {
        if (!entryIndex.TryGetValue(entryPath, out UnifiedArchive.Entry? entry))
            throw new IOException($"Archive entry disappeared: \u201C{entryPath}\u201D.");
        string destPath = Path.GetFullPath(Path.Combine(stagingRoot, entry.Path));
        if (!IsPathInside(stagingRoot, destPath))
            throw new IOException($"Blocked unsafe archive entry path: \u201C{entry.Path}\u201D.");
        using Stream source = archive.OpenEntry(entry);
        await WriteFileHighSpeedAsync(source, destPath).ConfigureAwait(false);
    }

    /// <summary>Phase B: moves the staged tree into the SPT root at the highest possible directory
    /// granularity (atomic Directory.Move for new folders, recursive merge for existing trees,
    /// cross-volume fallback). Nothing is written file-by-file into the live game directory.</summary>
    private static void MoveStagingIntoPlace(
        string stagingRoot, string sptRoot, ArchiveLayout layout, string? payloadTargetDir,
        string? looseFolderName, List<string> directoryEntries)
    {
        string rootFull = Path.GetFullPath(sptRoot);

        // Configured mod folders (Settings tab) drive payload routing; archives that already carry
        // the canonical user/mods or BepInEx/plugins structure are remapped to the configured paths.
        var settings = SettingsService.Instance;
        string serverPath = settings?.ServerModPathEffective ?? DefaultServerRoot;
        string clientPath = settings?.ClientModPathEffective ?? DefaultClientRoot;
        string payloadRoot = payloadTargetDir
            ?? (layout.PayloadLooksClient
                ? Path.Combine(rootFull, clientPath)
                : Path.Combine(rootFull, serverPath));

        // Mapped directory entries keep materializing at the destination (empty folders included).
        foreach (string dir in directoryEntries)
        {
            string? mapped = MapToRoot(dir);
            if (mapped is null) continue;
            EnsureDirectoryInside(rootFull, Path.Combine(rootFull, RemapConfiguredPaths(mapped)));
        }

        foreach (string top in Directory.EnumerateFileSystemEntries(stagingRoot).ToList())
        {
            string name = Path.GetFileName(top);

            // "user" / "BepInEx" / "EscapeFromTarkov_Data" at the archive root → merge into the
            // SPT root, remapping each child to its CONFIGURED path (user/mods → SPT_Runtime/user/mods
            // or a custom subpath; BepInEx/plugins likewise).
            if (RecognizedRootFolderName(name) is not null)
            {
                MoveRecognizedFolderIntoRoot(top, name, rootFull);
                continue;
            }

            if (Directory.Exists(top))
            {
                // Wrapper folder ("SPT/…"): recognized children merge into the root (remapped);
                // the rest is payload and keeps its archived relative path.
                List<string> children = Directory.EnumerateFileSystemEntries(top).ToList();
                if (children.Any(c => RecognizedRootFolderName(Path.GetFileName(c)) is not null))
                {
                    foreach (string child in children)
                    {
                        string childName = Path.GetFileName(child);
                        if (RecognizedRootFolderName(childName) is not null)
                            MoveRecognizedFolderIntoRoot(child, childName, rootFull);
                        else
                            MovePayloadPiece(child, name + "/" + childName, payloadRoot, layout, looseFolderName);
                    }
                    continue;
                }
            }

            MovePayloadPiece(top, name, payloadRoot, layout, looseFolderName);
        }
    }

    /// <summary>Moves the children of a recognized root folder (user / BepInEx /
    /// EscapeFromTarkov_Data) into the SPT root, applying the CONFIGURED path remap per child
    /// ("user/mods" → the effective server path, "BepInEx/plugins" → the effective client path;
    /// everything else keeps its archived location).</summary>
    private static void MoveRecognizedFolderIntoRoot(string dir, string rootFolderName, string rootFull)
    {
        foreach (string child in Directory.EnumerateFileSystemEntries(dir).ToList())
        {
            string childName = Path.GetFileName(child);
            string destRelative = RemapConfiguredPaths(rootFolderName + "/" + childName);
            MoveTreeMerge(child, Path.Combine(rootFull, destRelative));
        }
    }

    private static string? RecognizedRootFolderName(string name) =>
        name.Equals("user", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("BepInEx", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("EscapeFromTarkov_Data", StringComparison.OrdinalIgnoreCase)
            ? name
            : null;

    /// <summary>Moves one payload piece (bare mod folder or loose file) to its destination,
    /// preserving the archived relative path and honoring the loose-folder wrap. The common case —
    /// a single payload top folder — is ONE atomic Directory.Move into the mods folder.</summary>
    private static void MovePayloadPiece(
        string source, string relativePath, string payloadRoot, ArchiveLayout layout, string? looseFolderName)
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

    /// <summary>Moves a staged file/directory to its destination. An absent target receives a
    /// single atomic Directory.Move (same-volume rename — no per-file I/O); existing trees merge
    /// recursively with overwrite; cross-volume directory moves fall back to per-child moves
    /// (files move cross-volume natively).</summary>
    private static void MoveTreeMerge(string source, string destination)
    {
        if (!File.Exists(source) && !Directory.Exists(source)) return;

        if (File.Exists(source))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(destination))!);
            if (File.Exists(destination)) DeleteFileRobust(destination);
            File.Move(source, destination, overwrite: true);
            return;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(destination))!);
        if (!Directory.Exists(destination) && !File.Exists(destination))
        {
            try
            {
                Directory.Move(source, destination); // atomic same-volume rename
                return;
            }
            catch (IOException)
            {
                // Cross-volume or locked — merge child-by-child instead.
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

    /// <summary>Copies a directory tree into a destination, merging and force-overwriting files.</summary>
    public static void CopyDirectoryMerge(string sourceDir, string destinationDir)
    {
        Directory.CreateDirectory(destinationDir);
        var options = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true };

        foreach (string sourceFile in Directory.EnumerateFiles(sourceDir, "*", options))
        {
            string relative = Path.GetRelativePath(sourceDir, sourceFile);
            string destFile = Path.GetFullPath(Path.Combine(destinationDir, relative));
            if (!IsPathInside(destinationDir, destFile)) continue;

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

    public static void DeleteFileRobust(string filePath)
    {
        if (!File.Exists(filePath)) return;
        try { File.SetAttributes(filePath, FileAttributes.Normal); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or PlatformNotSupportedException) { }
        File.Delete(filePath);
    }
}
