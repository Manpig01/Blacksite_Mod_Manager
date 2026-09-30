using System.Buffers;
using System.IO;
using System.Text;
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
        => SafeEnumerate(dir, "*", directories: true, maxDepth: 0);

    private static IEnumerable<string> SafeEnumerateFiles(string dir, string pattern, int maxDepth)
        => SafeEnumerate(dir, pattern, directories: false, maxDepth);

    /// <summary>Lazy enumeration avoids allocating complete path arrays and tolerates folders
    /// becoming inaccessible while a large SPT tree is being scanned.</summary>
    private static IEnumerable<string> SafeEnumerate(string dir, string pattern, bool directories, int maxDepth)
    {
        IEnumerator<string>? enumerator = null;
        try
        {
            var options = new EnumerationOptions
            {
                RecurseSubdirectories = maxDepth > 0,
                IgnoreInaccessible = true,
                ReturnSpecialDirectories = false,
                MaxRecursionDepth = maxDepth > 0 ? maxDepth : 0
            };
            IEnumerable<string> paths = directories
                ? Directory.EnumerateDirectories(dir, pattern, options)
                : Directory.EnumerateFiles(dir, pattern, options);
            enumerator = paths.GetEnumerator();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException) { }

        if (enumerator is null) yield break;
        try
        {
            while (true)
            {
                bool hasNext = false;
                string? current = null;
                try
                {
                    hasNext = enumerator.MoveNext();
                    if (hasNext) current = enumerator.Current;
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
                {
                    // A directory can disappear or become locked mid-scan; keep the rows already found.
                }
                if (!hasNext) yield break;
                yield return current!;
            }
        }
        finally
        {
            enumerator.Dispose();
        }
    }

    // ------------------------------------------------------------------ JSON parsing

    private sealed class PackageJsonData
    {
        public string? Name, Id, Guid, Version, AuthorText, Main, SptVersion, AkiVersion;
    }

    /// <summary>
    /// Tolerant, selective UTF-8 reader for the handful of package.json fields the scanner uses.
    /// It avoids File.ReadAllText's UTF-16 copy and JsonDocument's full DOM allocation for every
    /// installed mod; the temporary input buffer is pooled and capped to reject pathological files.
    /// </summary>
    private static PackageJsonData? TryParsePackageJson(string path)
    {
        byte[]? utf8 = null;
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete, 4096, FileOptions.SequentialScan);
            int length = GetMetadataLength(stream);
            if (length <= 0) return null;
            utf8 = ArrayPool<byte>.Shared.Rent(length);
            stream.ReadExactly(utf8.AsSpan(0, length));

            int offset = length >= 3 && utf8[0] == 0xEF && utf8[1] == 0xBB && utf8[2] == 0xBF ? 3 : 0;
            var reader = new Utf8JsonReader(utf8.AsSpan(offset, length - offset), new JsonReaderOptions
            {
                CommentHandling = JsonCommentHandling.Skip,
                AllowTrailingCommas = true
            });
            if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject) return null;

            var data = new PackageJsonData();
            string? author = null;
            string? authorsText = null;
            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.EndObject && reader.CurrentDepth == 0) break;
                if (reader.TokenType != JsonTokenType.PropertyName || reader.CurrentDepth != 1) continue;
                bool isName = reader.ValueTextEquals("name");
                bool isId = reader.ValueTextEquals("id");
                bool isGuid = reader.ValueTextEquals("guid");
                bool isVersion = reader.ValueTextEquals("version");
                bool isAuthor = reader.ValueTextEquals("author");
                bool isAuthors = reader.ValueTextEquals("authors");
                bool isMain = reader.ValueTextEquals("main");
                bool isSpt = reader.ValueTextEquals("sptVersion");
                bool isAki = reader.ValueTextEquals("akiVersion");
                if (!reader.Read()) break;

                if (isAuthors)
                {
                    authorsText = ReadAuthors(ref reader);
                    continue;
                }

                if (isName) data.Name = ReadJsonScalar(ref reader);
                else if (isId) data.Id = ReadJsonScalar(ref reader);
                else if (isGuid) data.Guid = ReadJsonScalar(ref reader);
                else if (isVersion) data.Version = ReadJsonScalar(ref reader);
                else if (isAuthor) author = ReadJsonScalar(ref reader);
                else if (isMain) data.Main = ReadJsonScalar(ref reader);
                else if (isSpt) data.SptVersion = ReadJsonScalar(ref reader);
                else if (isAki) data.AkiVersion = ReadJsonScalar(ref reader);
                else if (reader.TokenType is JsonTokenType.StartObject or JsonTokenType.StartArray)
                    reader.Skip();
            }

            data.AuthorText = !string.IsNullOrWhiteSpace(author) ? author : authorsText;
            return data;
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException or ArgumentException)
        {
            return null;
        }
        finally
        {
            if (utf8 is not null) ArrayPool<byte>.Shared.Return(utf8);
        }
    }

    private sealed class ManifestData
    {
        public string? Name, FullName, VersionNumber;
    }

    /// <summary>Thunderstore/r2modman-style manifest.json reader; only three root tokens are needed.</summary>
    private static ManifestData? TryParseManifestJson(string path)
    {
        byte[]? utf8 = null;
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete, 4096, FileOptions.SequentialScan);
            int length = GetMetadataLength(stream);
            if (length <= 0) return null;
            utf8 = ArrayPool<byte>.Shared.Rent(length);
            stream.ReadExactly(utf8.AsSpan(0, length));

            int offset = length >= 3 && utf8[0] == 0xEF && utf8[1] == 0xBB && utf8[2] == 0xBF ? 3 : 0;
            var reader = new Utf8JsonReader(utf8.AsSpan(offset, length - offset), new JsonReaderOptions
            {
                CommentHandling = JsonCommentHandling.Skip,
                AllowTrailingCommas = true
            });
            if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject) return null;

            string? ns = null, name = null, version = null;
            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.EndObject && reader.CurrentDepth == 0) break;
                if (reader.TokenType != JsonTokenType.PropertyName || reader.CurrentDepth != 1) continue;
                bool isNamespace = reader.ValueTextEquals("namespace");
                bool isName = reader.ValueTextEquals("name");
                bool isVersion = reader.ValueTextEquals("version_number");
                if (!reader.Read()) break;

                if (isNamespace) ns = ReadJsonScalar(ref reader);
                else if (isName) name = ReadJsonScalar(ref reader);
                else if (isVersion) version = ReadJsonScalar(ref reader);
                else if (reader.TokenType is JsonTokenType.StartObject or JsonTokenType.StartArray)
                    reader.Skip();
            }

            return new ManifestData
            {
                Name = name,
                FullName = ns is not null && name is not null ? $"{ns}.{name}" : name,
                VersionNumber = version
            };
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException or ArgumentException)
        {
            return null;
        }
        finally
        {
            if (utf8 is not null) ArrayPool<byte>.Shared.Return(utf8);
        }
    }

    private const long MaximumMetadataJsonBytes = 4 * 1024 * 1024;

    private static int GetMetadataLength(FileStream stream)
    {
        long length = stream.Length;
        return length is > 0 and <= MaximumMetadataJsonBytes ? (int)length : 0;
    }

    private static string? ReadJsonScalar(ref Utf8JsonReader reader)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            string? value = reader.GetString();
            return string.IsNullOrWhiteSpace(value) ? null : value;
        }
        // Some legacy packages encode a version as a number rather than a JSON string.
        if (reader.TokenType == JsonTokenType.Number)
            return Encoding.UTF8.GetString(reader.ValueSpan);
        return null;
    }

    private static string? ReadAuthors(ref Utf8JsonReader reader)
    {
        if (reader.TokenType == JsonTokenType.String)
            return reader.GetString();
        if (reader.TokenType != JsonTokenType.StartArray) return null;

        var names = new List<string>();
        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndArray && reader.CurrentDepth == 1) break;
            if (reader.TokenType == JsonTokenType.String && reader.CurrentDepth == 2)
            {
                string? value = reader.GetString();
                if (!string.IsNullOrWhiteSpace(value)) names.Add(value);
            }
            else if (reader.TokenType == JsonTokenType.StartObject && reader.CurrentDepth == 2)
            {
                string? name = null, username = null;
                while (reader.Read())
                {
                    if (reader.TokenType == JsonTokenType.EndObject && reader.CurrentDepth == 2) break;
                    if (reader.TokenType != JsonTokenType.PropertyName || reader.CurrentDepth != 3) continue;
                    bool isName = reader.ValueTextEquals("name");
                    bool isUsername = reader.ValueTextEquals("username");
                    if (!reader.Read()) break;
                    if (isName) name = ReadJsonScalar(ref reader);
                    else if (isUsername) username = ReadJsonScalar(ref reader);
                    else if (reader.TokenType is JsonTokenType.StartObject or JsonTokenType.StartArray)
                        reader.Skip();
                }
                string? display = !string.IsNullOrWhiteSpace(name) ? name : username;
                if (!string.IsNullOrWhiteSpace(display)) names.Add(display);
            }
            else if (reader.TokenType is JsonTokenType.StartObject or JsonTokenType.StartArray)
            {
                reader.Skip();
            }
        }
        return names.Count == 0 ? null : string.Join(", ", names);
    }
}
