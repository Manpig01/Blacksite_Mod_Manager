using System.IO;
using System.Text.Json;
using Blacksite.Models;

namespace Blacksite.Services;

/// <summary>
/// Scans a live SPT installation and builds the index of installed mods:
///   • user\mods\*          → server mods (package.json parsed when present, DLL metadata as fallback)
///   • user\mods\*.js/.ts   → loose legacy server scripts
///   • BepInEx\plugins\*    → client plugins: plugin folders (manifest.json / [BepInPlugin] metadata)
///                            and loose plugin DLLs. The SPT core folder ("spt") is excluded.
/// Folders/files renamed with a ".disabled" suffix are reported as disabled.
/// </summary>
public sealed class LocalModScanner
{
    private const string DisabledSuffix = ".disabled";

    public List<InstalledModInfo> Scan(string sptRoot)
    {
        var results = new List<InstalledModInfo>();
        // Configured mod folders (Settings tab) are scanned first; the canonical folders are also
        // scanned when customized so older installs in default locations stay visible.
        var settings = SettingsService.Instance;
        string serverPath = settings?.ServerModPathEffective ?? "user/mods";
        string clientPath = settings?.ClientModPathEffective ?? "BepInEx/plugins";

        ScanServerMods(Path.Combine(sptRoot, serverPath), results);
        ScanClientMods(Path.Combine(sptRoot, clientPath), results);

        if (!string.Equals(serverPath, "user/mods", StringComparison.OrdinalIgnoreCase))
            ScanServerMods(Path.Combine(sptRoot, "user", "mods"), results);
        if (!string.Equals(clientPath, "BepInEx/plugins", StringComparison.OrdinalIgnoreCase))
            ScanClientMods(Path.Combine(sptRoot, "BepInEx", "plugins"), results);
        return results
            .OrderBy(m => m.Kind)
            .ThenBy(m => m.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    // ------------------------------------------------------------------ server mods

    private static void ScanServerMods(string modsDir, List<InstalledModInfo> results)
    {
        if (!Directory.Exists(modsDir)) return;

        foreach (string dir in SafeEnumerateDirectories(modsDir))
        {
            string folderName = Path.GetFileName(dir);
            var (logicalName, disabled) = SplitDisabled(folderName);

            string? packageId = null, version = null, authors = null, main = null, sptHint = null;
            string source = "folder";

            string packageJsonPath = Path.Combine(dir, "package.json");
            if (File.Exists(packageJsonPath))
            {
                var pkg = TryParsePackageJson(packageJsonPath);
                if (pkg is not null)
                {
                    packageId = FirstNonEmpty(pkg.Name, pkg.Id, pkg.Guid);
                    version = pkg.Version;
                    authors = pkg.AuthorText;
                    main = pkg.Main;
                    sptHint = FirstNonEmpty(pkg.SptVersion, pkg.AkiVersion);
                    source = "package.json";
                }
            }

            if (version is null)
            {
                // Fall back to the metadata of the mod's DLLs (main entry first).
                foreach (string dll in SafeEnumerateFiles(dir, "*.dll", maxDepth: 2).Take(8))
                {
                    string? v = PluginMetadata.TryGetFileVersion(dll);
                    if (v is not null) { version = v; if (source == "folder") source = "assembly info"; break; }
                }
            }

            main ??= FindMainCandidate(dir, logicalName);

            results.Add(new InstalledModInfo
            {
                Kind = InstalledModKind.Server,
                InstallPath = dir,
                IsDirectory = true,
                ParentDirectory = modsDir,
                DisplayName = logicalName,
                PackageId = packageId,
                Version = version,
                Authors = authors,
                MainEntry = main,
                SptVersionHint = sptHint,
                IsDisabled = disabled,
                InfoSource = source
            });
        }

        // Loose legacy server scripts (user/mods/*.js|*.ts and their .disabled variants)
        foreach (string file in SafeEnumerateFiles(modsDir, "*.*", maxDepth: 0))
        {
            string fileName = Path.GetFileName(file);
            var (logicalFile, disabled) = SplitDisabled(fileName);
            string ext = Path.GetExtension(logicalFile).ToLowerInvariant();
            if (ext is not (".js" or ".ts" or ".mjs" or ".cjs")) continue;

            results.Add(new InstalledModInfo
            {
                Kind = InstalledModKind.Server,
                InstallPath = file,
                IsDirectory = false,
                ParentDirectory = modsDir,
                DisplayName = Path.GetFileNameWithoutExtension(logicalFile),
                IsDisabled = disabled,
                InfoSource = "file"
            });
        }
    }

    private static string? FindMainCandidate(string dir, string logicalName)
    {
        try
        {
            string guess = Path.Combine(dir, logicalName + ".dll");
            if (File.Exists(guess)) return logicalName + ".dll";
            return SafeEnumerateFiles(dir, "*.dll", maxDepth: 0).Select(Path.GetFileName).FirstOrDefault();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    // ------------------------------------------------------------------ client mods

    private static void ScanClientMods(string pluginsDir, List<InstalledModInfo> results)
    {
        if (!Directory.Exists(pluginsDir)) return;

        foreach (string dir in SafeEnumerateDirectories(pluginsDir))
        {
            string folderName = Path.GetFileName(dir);
            var (logicalName, disabled) = SplitDisabled(folderName);
            if (logicalName.Equals("spt", StringComparison.OrdinalIgnoreCase)) continue; // the SPT core itself

            string? packageId = null, version = null, authors = null, displayName = logicalName;
            string source = "folder";

            string manifestPath = Path.Combine(dir, "manifest.json");
            var manifest = File.Exists(manifestPath) ? TryParseManifestJson(manifestPath) : null;
            if (manifest is not null)
            {
                packageId = manifest.FullName;
                version = manifest.VersionNumber;
                displayName = manifest.Name ?? logicalName;
                source = "manifest.json";
            }

            // Find the actual BepInEx plugin DLL(s) inside the folder and read their metadata.
            PluginMetadata.BepInPluginInfo? plugin = null;
            string? pluginDllPath = null;
            foreach (string dll in SafeEnumerateFiles(dir, "*.dll", maxDepth: 3).Take(60))
            {
                var info = PluginMetadata.TryReadBepInPlugin(dll);
                if (info is not null) { plugin = info; pluginDllPath = dll; break; }
            }

            if (plugin is not null)
            {
                packageId ??= string.IsNullOrWhiteSpace(plugin.Guid) ? null : plugin.Guid;
                if (!string.IsNullOrWhiteSpace(plugin.Name)) displayName = plugin.Name;
                version = plugin.Version ?? version;
                source = "BepInPlugin";
            }
            else if (version is null)
            {
                // No plugin attribute found — fall back to version resources of the best-matching DLL.
                string? dll = GuessPrimaryDll(dir, logicalName, pluginDllPath);
                if (dll is not null)
                {
                    version = PluginMetadata.TryGetFileVersion(dll);
                    if (version is not null && source == "folder") source = "assembly info";
                }
            }

            results.Add(new InstalledModInfo
            {
                Kind = InstalledModKind.Client,
                InstallPath = dir,
                IsDirectory = true,
                ParentDirectory = pluginsDir,
                DisplayName = displayName,
                PackageId = packageId,
                Version = version,
                Authors = authors,
                MainEntry = pluginDllPath is null ? null : Path.GetRelativePath(dir, pluginDllPath),
                IsDisabled = disabled,
                InfoSource = source
            });
        }

        // Loose plugin DLLs directly in BepInEx\plugins (including *.dll.disabled)
        foreach (string file in SafeEnumerateFiles(pluginsDir, "*.*", maxDepth: 0))
        {
            string fileName = Path.GetFileName(file);
            var (logicalFile, disabled) = SplitDisabled(fileName);
            if (!logicalFile.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)) continue;

            var plugin = PluginMetadata.TryReadBepInPlugin(file);
            if (plugin is null) continue; // dependency DLL, not a plugin

            results.Add(new InstalledModInfo
            {
                Kind = InstalledModKind.Client,
                InstallPath = file,
                IsDirectory = false,
                ParentDirectory = pluginsDir,
                DisplayName = string.IsNullOrWhiteSpace(plugin.Name) ? Path.GetFileNameWithoutExtension(logicalFile) : plugin.Name,
                PackageId = string.IsNullOrWhiteSpace(plugin.Guid) ? null : plugin.Guid,
                Version = plugin.Version ?? PluginMetadata.TryGetFileVersion(file),
                IsDisabled = disabled,
                InfoSource = "BepInPlugin"
            });
        }
    }

    private static string? GuessPrimaryDll(string dir, string logicalName, string? anyPluginDll)
    {
        try
        {
            string guess = Path.Combine(dir, logicalName + ".dll");
            if (File.Exists(guess)) return guess;
            return SafeEnumerateFiles(dir, "*.dll", maxDepth: 0).FirstOrDefault() ?? anyPluginDll;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    // ------------------------------------------------------------------ helpers

    private static (string LogicalName, bool Disabled) SplitDisabled(string name)
    {
        if (name.EndsWith(DisabledSuffix, StringComparison.OrdinalIgnoreCase))
            return (name[..^DisabledSuffix.Length], true);
        return (name, false);
    }

    private static string? FirstNonEmpty(params string?[] values)
        => values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));

    private static IEnumerable<string> SafeEnumerateDirectories(string dir)
    {
        try { return Directory.EnumerateDirectories(dir); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return Array.Empty<string>(); }
    }

    private static IEnumerable<string> SafeEnumerateFiles(string dir, string pattern, int maxDepth)
    {
        try
        {
            if (maxDepth <= 0)
                return Directory.EnumerateFiles(dir, pattern);

            var options = new EnumerationOptions
            {
                RecurseSubdirectories = true,
                IgnoreInaccessible = true,
                MaxRecursionDepth = maxDepth
            };
            return Directory.EnumerateFiles(dir, pattern, options);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return Array.Empty<string>();
        }
    }

    // ------------------------------------------------------------------ JSON parsing

    private sealed class PackageJsonData
    {
        public string? Name, Id, Guid, Version, AuthorText, Main, SptVersion, AkiVersion;
    }

    /// <summary>Tolerant package.json reader — field types vary between mod authors, so every
    /// value is extracted defensively instead of via strict deserialization.</summary>
    private static PackageJsonData? TryParsePackageJson(string path)
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            JsonElement root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;

            var data = new PackageJsonData
            {
                Name = GetString(root, "name"),
                Id = GetString(root, "id"),
                Guid = GetString(root, "guid"),
                Version = GetString(root, "version"),
                Main = GetString(root, "main"),
                SptVersion = GetString(root, "sptVersion"),
                AkiVersion = GetString(root, "akiVersion")
            };

            string? author = GetString(root, "author");
            if (author is null && root.TryGetProperty("authors", out JsonElement authors))
            {
                if (authors.ValueKind == JsonValueKind.String)
                    author = authors.GetString();
                else if (authors.ValueKind == JsonValueKind.Array)
                {
                    var names = new List<string>();
                    foreach (JsonElement item in authors.EnumerateArray())
                    {
                        if (item.ValueKind == JsonValueKind.String) { var s = item.GetString(); if (s is not null) names.Add(s); }
                        else if (item.ValueKind == JsonValueKind.Object)
                        {
                            string? n = GetString(item, "name") ?? GetString(item, "username");
                            if (n is not null) names.Add(n);
                        }
                    }
                    if (names.Count > 0) author = string.Join(", ", names);
                }
            }
            data.AuthorText = author;
            return data;
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private sealed class ManifestData
    {
        public string? Name, FullName, VersionNumber;
    }

    /// <summary>Thunderstore/r2modman-style manifest.json reader.</summary>
    private static ManifestData? TryParseManifestJson(string path)
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            JsonElement root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;

            string? ns = GetString(root, "namespace");
            string? name = GetString(root, "name");
            return new ManifestData
            {
                Name = name,
                FullName = ns is not null && name is not null ? $"{ns}.{name}" : name,
                VersionNumber = GetString(root, "version_number")
            };
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static string? GetString(JsonElement element, string property)
    {
        if (element.TryGetProperty(property, out JsonElement value) && value.ValueKind == JsonValueKind.String)
        {
            string? s = value.GetString();
            return string.IsNullOrWhiteSpace(s) ? null : s;
        }
        // numbers (e.g. version: 1.2) are accepted too
        if (value.ValueKind == JsonValueKind.Number) return value.GetRawText();
        return null;
    }
}
