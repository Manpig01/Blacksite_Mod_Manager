using System.IO;

namespace Blacksite.Services;

/// <summary>One discovered configuration file inside a mod's install folder.</summary>
public sealed record ModConfigFile(string RelativePath, string FullPath, long SizeBytes)
{
    public string SizeText => SizeBytes >= 1024
        ? $"{SizeBytes / 1024.0:F1} KB"
        : $"{SizeBytes} B";

    public string Extension => Path.GetExtension(RelativePath).ToLowerInvariant();
}

/// <summary>
/// Real file-system config discovery + editing support for the in-app "Edit Configs" modal:
/// recursively finds .json / .jsonc / .cfg / .yaml (.yml) files inside a mod's folder and
/// reads/writes them on disk.
/// </summary>
public static class ModConfigService
{
    private static readonly HashSet<string> TargetExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".json", ".jsonc", ".cfg", ".yaml", ".yml"
    };

    /// <summary>
    /// Recursively scans a mod's directory for configuration files. Results are ordered
    /// by relative path (shallow, stable). The scan is capped so a pathological mod folder
    /// can never hang the UI.
    /// </summary>
    public static List<ModConfigFile> FindConfigFiles(string modPath, int maxFiles = 200)
    {
        var results = new List<ModConfigFile>();
        if (string.IsNullOrWhiteSpace(modPath) || !Directory.Exists(modPath)) return results;

        string root = Path.GetFullPath(modPath);
        var queue = new Queue<string>();
        queue.Enqueue(root);

        while (queue.Count > 0 && results.Count < maxFiles)
        {
            string dir = queue.Dequeue();

            IEnumerable<string> files;
            try { files = Directory.EnumerateFiles(dir); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { continue; }

            foreach (string file in files)
            {
                if (results.Count >= maxFiles) break;
                if (!TargetExtensions.Contains(Path.GetExtension(file))) continue;
                try
                {
                    string full = Path.GetFullPath(file);
                    results.Add(new ModConfigFile(
                        Path.GetRelativePath(root, full),
                        full,
                        new FileInfo(full).Length));
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            }

            IEnumerable<string> subDirs;
            try { subDirs = Directory.EnumerateDirectories(dir); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { continue; }

            foreach (string sub in subDirs)
                queue.Enqueue(sub);
        }

        return results
            .OrderBy(f => f.RelativePath.Count(ch => ch is '/' or '\\'))
            .ThenBy(f => f.RelativePath, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>Reads a config file from disk (UTF-8 with detection, no size cap on purpose —
    /// configs are small and users may legitimately edit large generated ones).</summary>
    public static string ReadText(string path) => File.ReadAllText(path);

    /// <summary>
    /// Writes edited text directly back to the file on disk. Read-only flags are cleared first
    /// so a locked-down file can still be edited (same hardening as the extraction engine).
    /// </summary>
    public static void WriteText(string path, string text)
    {
        if (File.Exists(path))
        {
            try { File.SetAttributes(path, FileAttributes.Normal); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or PlatformNotSupportedException) { }
        }
        File.WriteAllText(path, text);
    }
}
