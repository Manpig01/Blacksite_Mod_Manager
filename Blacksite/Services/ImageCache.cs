using System.Collections.Concurrent;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Media.Imaging;

namespace Blacksite.Services;

/// <summary>
/// Two-level (memory + disk) thumbnail cache. Decoding happens off the UI thread and every
/// BitmapImage is frozen, so bindings can pick it up from any thread without blocking the UI.
/// Disk cache lives in %LocalAppData%\BlacksiteModManager\thumbs.
/// </summary>
public sealed class ImageCache
{
    private readonly SpModApiClient _api;
    private readonly string _cacheDirectory;
    private readonly ConcurrentDictionary<string, BitmapImage> _memory = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, Task<BitmapImage?>> _inFlight = new(StringComparer.OrdinalIgnoreCase);
    private readonly SemaphoreSlim _downloadGate = new(4, 4); // max 4 concurrent thumbnail downloads

    public ImageCache(SpModApiClient api)
    {
        _api = api;
        _cacheDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BlacksiteModManager", "thumbs");
        try { Directory.CreateDirectory(_cacheDirectory); } catch (IOException) { /* cache disabled */ }
    }

    /// <summary>
    /// Purges the whole cache — in-memory decoded thumbnails AND the on-disk thumbnail store.
    /// Returns (files deleted, bytes freed).
    /// </summary>
    public (int Files, long Bytes) ClearAll()
    {
        _memory.Clear();
        _inFlight.Clear();

        int files = 0;
        long bytes = 0;
        try
        {
            foreach (string file in Directory.EnumerateFiles(_cacheDirectory))
            {
                try
                {
                    bytes += new FileInfo(file).Length;
                    File.Delete(file);
                    files++;
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        return (files, bytes);
    }

    /// <summary>Returns a frozen BitmapImage for the URL, or null when it cannot be loaded/decoded.</summary>
    public Task<BitmapImage?> GetAsync(string? url, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(url)) return Task.FromResult<BitmapImage?>(null);
        if (_memory.TryGetValue(url, out var cached)) return Task.FromResult<BitmapImage?>(cached);

        return _inFlight.GetOrAdd(url, _ => LoadAsync(url, cancellationToken));
    }

    private async Task<BitmapImage?> LoadAsync(string url, CancellationToken cancellationToken)
    {
        try
        {
            string cacheFile = GetCacheFilePath(url);

            if (File.Exists(cacheFile))
            {
                var fromDisk = Decode(await File.ReadAllBytesAsync(cacheFile, cancellationToken).ConfigureAwait(false));
                if (fromDisk is not null) return _memory[url] = fromDisk;
            }

            await _downloadGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            byte[]? bytes;
            try { bytes = await _api.GetImageBytesAsync(url, cancellationToken).ConfigureAwait(false); }
            finally { _downloadGate.Release(); }

            if (bytes is null || bytes.Length == 0) return null;

            var image = Decode(bytes);
            if (image is null) return null; // e.g. unsupported webp payload — placeholder will show

            try { await File.WriteAllBytesAsync(cacheFile, bytes, cancellationToken).ConfigureAwait(false); }
            catch (IOException) { /* non-fatal */ }

            return _memory[url] = image;
        }
        catch (Exception ex) when (ex is OperationCanceledException or IOException or HttpRequestException or NotSupportedException)
        {
            return null;
        }
        finally
        {
            _inFlight.TryRemove(url, out _);
        }
    }

    private static BitmapImage? Decode(byte[] bytes)
    {
        try
        {
            var image = new BitmapImage();
            using var ms = new MemoryStream(bytes);
            image.BeginInit();
            image.CacheOption = BitmapCacheOption.OnLoad;
            image.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
            image.StreamSource = ms;
            image.EndInit();
            image.Freeze(); // makes it usable from any thread
            return image;
        }
        catch (Exception ex) when (ex is NotSupportedException or IOException or System.Runtime.InteropServices.ExternalException)
        {
            return null;
        }
    }

    private string GetCacheFilePath(string url)
    {
        byte[] hash = SHA1.HashData(Encoding.UTF8.GetBytes(url));
        string ext = ".img";
        int q = url.IndexOf('?');
        string path = q >= 0 ? url[..q] : url;
        if (path.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".jpeg", StringComparison.OrdinalIgnoreCase)) ext = ".jpg";
        else if (path.EndsWith(".png", StringComparison.OrdinalIgnoreCase)) ext = ".png";
        else if (path.EndsWith(".webp", StringComparison.OrdinalIgnoreCase)) ext = ".webp";
        else if (path.EndsWith(".gif", StringComparison.OrdinalIgnoreCase)) ext = ".gif";
        return Path.Combine(_cacheDirectory, Convert.ToHexString(hash) + ext);
    }
}
