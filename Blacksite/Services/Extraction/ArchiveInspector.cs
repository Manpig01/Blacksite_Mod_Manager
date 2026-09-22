using System.IO;
using System.IO.Compression;
using System.Text;
using SharpCompress.Archives;
using Blacksite.Models;

namespace Blacksite.Services.Extraction;

/// <summary>One archive entry, normalized: forward slashes, no trailing separator for files.</summary>
public sealed record ArchiveEntryInfo(string Path, bool IsDirectory, long Size);

/// <summary>
/// Unit 1 of the extraction architecture (clean-slate rewrite): DETECTION + ANALYSIS.
/// Identifies archive bytes (zip / 7z / RAR incl. RAR5 / HTML error pages / SFX-prefixed zips),
/// lists entries from the central directory without extracting, and classifies the archive's
/// SPT layout. Pure read-only logic — no staging, no placement, no side effects.
/// </summary>
public interface IArchiveInspector
{
    ArchiveKind Detect(string filePath);
    ArchiveKind DetectWithExtensionFallback(string filePath);
    bool IsStructurallyIntactArchive(string filePath);
    ArchiveLayout Analyze(string filePath, ArchiveKind kind);
    IReadOnlyList<ArchiveEntryInfo> ListEntries(string filePath, ArchiveKind kind);
}

public sealed class ArchiveInspector : IArchiveInspector
{
    public static ArchiveInspector Default { get; } = new();

    // ------------------------------------------------------------------ magic-byte detection

    public ArchiveKind Detect(string filePath)
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
        string asText = Encoding.UTF8.GetString(head, 0, read).TrimStart('\uFEFF', ' ', '\t', '\r', '\n');
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
    /// before the zip signature), the file extension routes the open attempt to the matching
    /// reader — which then either succeeds or fails with a clear error.
    /// </summary>
    public ArchiveKind DetectWithExtensionFallback(string filePath)
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
    /// API's content_length metadata disagrees with the bytes actually served. For zips this
    /// requires an intact End-of-Central-Directory record and readable central directory,
    /// i.e. the file is complete; a body truncated mid-file cannot enumerate entries.
    /// </summary>
    public bool IsStructurallyIntactArchive(string filePath)
    {
        try
        {
            switch (Detect(filePath))
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

    public IReadOnlyList<ArchiveEntryInfo> ListEntries(string filePath, ArchiveKind kind)
    {
        using UnifiedArchive archive = UnifiedArchive.Open(filePath, kind);
        return archive.Entries
            .Where(e => e.Path.Length > 0)
            .Select(e => new ArchiveEntryInfo(e.Path, e.IsDirectory, e.Size ?? 0))
            .ToList();
    }

    // ------------------------------------------------------------- SFX-tolerant zip open

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

    /// <summary>Unified read access: ZIP via System.IO.Compression, RAR/7z via SharpCompress.
    /// NOT thread-safe — one instance (or a per-batch instance) per sequential consumer.</summary>
    internal sealed class UnifiedArchive : IDisposable
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

    internal static string Normalize(string path) => path.Replace('\\', '/');

    private static bool IsDirPath(string path) => path.EndsWith('/') || path.EndsWith('\\');

    // ------------------------------------------------------------------ layout analysis

    public ArchiveLayout Analyze(string filePath, ArchiveKind kind)
    {
        using UnifiedArchive archive = UnifiedArchive.Open(filePath, kind);
        return Analyze(archive);
    }

    internal static ArchiveLayout Analyze(UnifiedArchive archive)
    {
        bool rootStructured = false;
        bool wrapped = false;
        var payloadFiles = new List<UnifiedArchive.Entry>();
        var payloadTopSegments = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (UnifiedArchive.Entry entry in archive.Entries)
        {
            if (entry.IsDirectory || entry.Path.Length == 0) continue;

            string? mapped = SptRouteTable.Default.MapToRoot(entry.Path);
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
}
