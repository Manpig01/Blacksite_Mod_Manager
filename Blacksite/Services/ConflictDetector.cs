using System.IO;
using System.Text.Json;
using Blacksite.Models;

namespace Blacksite.Services;

/// <summary>One detected conflict/duplicate across installed mods.</summary>
/// <param name="Files">The exact conflicting paths on disk (dll files, or duplicate mod folders for server packages).</param>
public sealed record ModConflict(
    InstalledModKind Kind,
    string Key,
    IReadOnlyList<string> Files,
    string Summary)
{
    public string KindText => Kind == InstalledModKind.Server ? "Server" : "Client";
}

/// <summary>
/// Real file-system conflict &amp; duplicate detection:
///  • Client: duplicate .dll FILENAMES living in different subfolders of the client mods folder(s)
///    (BepInEx/plugins by default) — SPT loads both and BepInEx refuses duplicate plugin GUIDs.
///  • Server: duplicate package IDs ("name"/"id" in package.json) across mod folders in the
///    server mods folder(s) (user/mods by default).
/// Custom paths configured in the Settings tab are scanned first; canonical folders are included
/// when customized so legacy installs are covered too.
/// </summary>
public static class ConflictDetector
{
    public static List<ModConflict> Detect(string sptRoot)
    {
        var conflicts = new List<ModConflict>();
        if (string.IsNullOrWhiteSpace(sptRoot) || !Directory.Exists(sptRoot)) return conflicts;

        var settings = SettingsService.Instance;
        string serverPath = settings?.ServerModPathEffective ?? "user/mods";
        string clientPath = settings?.ClientModPathEffective ?? "BepInEx/plugins";

        var serverDirs = new List<string> { serverPath };
        if (!string.Equals(serverPath, "user/mods", StringComparison.OrdinalIgnoreCase))
            serverDirs.Add("user/mods");
        var clientDirs = new List<string> { clientPath };
        if (!string.Equals(clientPath, "BepInEx/plugins", StringComparison.OrdinalIgnoreCase))
            clientDirs.Add("BepInEx/plugins");

        foreach (string rel in clientDirs.Distinct(StringComparer.OrdinalIgnoreCase))
            DetectClientDuplicates(Path.Combine(sptRoot, rel), conflicts);
        foreach (string rel in serverDirs.Distinct(StringComparer.OrdinalIgnoreCase))
            DetectServerDuplicates(Path.Combine(sptRoot, rel), conflicts);

        return conflicts;
    }

    /// <summary>Duplicate .dll filenames in different subfolders of the client mods folder.</summary>
    private static void DetectClientDuplicates(string clientModsDir, List<ModConflict> conflicts)
    {
        if (!Directory.Exists(clientModsDir)) return;

        var byFileName = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (string dll in Directory.EnumerateFiles(clientModsDir, "*.dll", SearchOption.AllDirectories))
            {
                string full;
                try { full = Path.GetFullPath(dll); }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException) { continue; }
                string name = Path.GetFileName(full);
                if (!byFileName.TryGetValue(name, out var list)) byFileName[name] = list = new List<string>();
                if (!list.Contains(full, StringComparer.OrdinalIgnoreCase)) list.Add(full);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return; }

        foreach (var (fileName, files) in byFileName)
        {
            if (files.Count < 2) continue;

            // Only a conflict when the copies live in DIFFERENT folders (same-folder copies are
            // impossible for identical paths; nested duplicates in one mod folder are its own business).
            var distinctDirs = files.Select(Path.GetDirectoryName).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (distinctDirs.Count < 2) continue;

            conflicts.Add(new ModConflict(
                InstalledModKind.Client,
                fileName,
                files,
                $"Duplicate client plugin “{fileName}” is installed {files.Count} times in different folders — SPT may fail to load or behave unpredictably."));
        }
    }

    /// <summary>Duplicate package IDs across server mod folders (package.json name/id).</summary>
    private static void DetectServerDuplicates(string serverModsDir, List<ModConflict> conflicts)
    {
        if (!Directory.Exists(serverModsDir)) return;

        var byPackageId = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (string dir in Directory.EnumerateDirectories(serverModsDir))
            {
                string? packageId = TryReadPackageId(Path.Combine(dir, "package.json"));
                if (string.IsNullOrWhiteSpace(packageId)) continue;
                if (!byPackageId.TryGetValue(packageId, out var list)) byPackageId[packageId] = list = new List<string>();
                if (!list.Contains(dir, StringComparer.OrdinalIgnoreCase)) list.Add(dir);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return; }

        foreach (var (packageId, dirs) in byPackageId)
        {
            if (dirs.Count < 2) continue;
            conflicts.Add(new ModConflict(
                InstalledModKind.Server,
                packageId,
                dirs,
                $"Server package “{packageId}” is installed {dirs.Count} times — the server will load both copies and likely break."));
        }
    }

    /// <summary>Reads a real package.json and extracts its package id ("name", falling back to "id").</summary>
    public static string? TryReadPackageId(string packageJsonPath)
    {
        try
        {
            if (!File.Exists(packageJsonPath)) return null;
            using JsonDocument doc = JsonDocument.Parse(File.ReadAllText(packageJsonPath));
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;
            if (doc.RootElement.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String)
            {
                string? value = name.GetString();
                if (!string.IsNullOrWhiteSpace(value)) return value;
            }
            if (doc.RootElement.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String)
            {
                string? value = id.GetString();
                if (!string.IsNullOrWhiteSpace(value)) return value;
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
        {
            return null;
        }
        return null;
    }

    /// <summary>All conflicts that involve a given mod install path (file/dir inside it, or the path itself).</summary>
    public static IReadOnlyList<ModConflict> ForPath(IReadOnlyList<ModConflict> conflicts, string modInstallPath)
    {
        if (conflicts.Count == 0 || string.IsNullOrWhiteSpace(modInstallPath)) return Array.Empty<ModConflict>();
        string mod = Path.GetFullPath(modInstallPath);

        return conflicts
            .Where(c => c.Files.Any(f =>
            {
                try
                {
                    string full = Path.GetFullPath(f);
                    return string.Equals(full, mod, StringComparison.OrdinalIgnoreCase)
                        || IsInside(full, mod) || IsInside(mod, full);
                }
                catch (Exception ex) when (ex is IOException or ArgumentException or UnauthorizedAccessException)
                {
                    return false;
                }
            }))
            .ToList();
    }

    private static bool IsInside(string path, string directory)
    {
        string dir = directory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        return path.StartsWith(dir, StringComparison.OrdinalIgnoreCase);
    }
}
