using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Blacksite.Services;

public sealed class AppSettings
{
    [JsonPropertyName("sptDirectory")] public string? SptDirectory { get; set; }
    [JsonPropertyName("sptVersion")] public string? SptVersion { get; set; }
    /// <summary>Custom client-mods subpath inside the SPT root (default: BepInEx/plugins).</summary>
    [JsonPropertyName("clientModPath")] public string? ClientModPath { get; set; }
    /// <summary>Custom server-mods subpath inside the SPT root (default: user/mods).</summary>
    [JsonPropertyName("serverModPath")] public string? ServerModPath { get; set; }
    /// <summary>Last catalog SPT-version constraint chosen in the filter panel (persists between launches).</summary>
    [JsonPropertyName("sptVersionFilter")] public string? SptVersionFilter { get; set; }

    /// <summary>Download stall watchdog (task 6.1, Fix D): a stream read with no bytes for this
    /// many seconds fails the install with a clean retryable error. Default 60.</summary>
    [JsonPropertyName("downloadStallTimeoutSeconds")] public int DownloadStallTimeoutSeconds { get; set; } = 60;
    [JsonPropertyName("installedMods")] public Dictionary<int, InstalledModRecord> InstalledMods { get; set; } = new();
}

public sealed class InstalledModRecord
{
    [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [JsonPropertyName("version")] public string Version { get; set; } = string.Empty;
    [JsonPropertyName("installedAtUtc")] public DateTime InstalledAtUtc { get; set; }
    /// <summary>Forge release id (the catalog's version-row id) this install came from;
    /// null on records written by older builds. Optional so existing settings.json files load.</summary>
    [JsonPropertyName("releaseId")] public int? ReleaseId { get; set; }
}

/// <summary>Persists settings to %AppData%\BlacksiteModManager\settings.json.</summary>
public sealed class SettingsService
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };
    private readonly string _settingsPath;

    /// <summary>
    /// Ambient instance — the static extraction/scanning layers read the configured mod paths
    /// through it. Set by the first construction (MainViewModel in the app; the harness in tests).
    /// </summary>
    public static SettingsService? Instance { get; private set; }

    public AppSettings Settings { get; private set; } = new();

    public string AppDataDir { get; }

    public SettingsService()
    {
        AppDataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "BlacksiteModManager");
        Directory.CreateDirectory(AppDataDir);
        _settingsPath = Path.Combine(AppDataDir, "settings.json");
        Load();
        Instance = this;
    }

    public const string DefaultClientModPath = "BepInEx/plugins";
    public const string DefaultServerModPath = "user/mods";

    /// <summary>
    /// SPT 4.1+ keeps the SERVER runtime (SPT.Server.exe and user\mods) inside an "SPT_Runtime"
    /// child folder of the install root (the 4.0-era name was "SPT"). BepInEx may live either at
    /// the install root (typical 4.1 layout) or inside the runtime. Returns the runtime folder
    /// name when the given root uses that layout, else null (classic layout).
    /// </summary>
    public static string? FindRuntimeFolderName(string? sptRoot)
    {
        if (string.IsNullOrWhiteSpace(sptRoot)) return null;
        try
        {
            foreach (string candidate in new[] { "SPT_Runtime", "SPT" })
            {
                string dir = Path.Combine(sptRoot, candidate);
                if (!Directory.Exists(dir)) continue;
                // Must actually look like a runtime: the server executable, or the mod folders.
                if (File.Exists(Path.Combine(dir, "SPT.Server.exe")) ||
                    File.Exists(Path.Combine(dir, "Aki.Server.exe")) ||
                    Directory.Exists(Path.Combine(dir, "user")) ||
                    Directory.Exists(Path.Combine(dir, "BepInEx")))
                    return candidate;
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException) { }
        return null;
    }

    /// <summary>The runtime folder name of the currently configured SPT root, if it uses the
    /// SPT 4.x layout (SPT_Runtime). Null on classic layouts.</summary>
    public string? RuntimeFolderName => FindRuntimeFolderName(Settings.SptDirectory);

    /// <summary>Configured client-mods subpath (validated; canonical fallback when blank/absolute).
    /// BepInEx stays where the game keeps it: at the install root (typical SPT 4.1 layout), and is
    /// only runtime-prefixed when the runtime folder carries its own BepInEx and the root does not.</summary>
    public string ClientModPathEffective => EffectiveClientSubpath(Settings.ClientModPath);

    /// <summary>Configured server-mods subpath (validated; canonical fallback when blank/absolute;
    /// on SPT 4.x layouts automatically prefixed with the runtime folder).</summary>
    public string ServerModPathEffective => EffectiveServerSubpath(Settings.ServerModPath);

    /// <summary>Effective client-mods subpath for an arbitrary configured value (Settings preview).</summary>
    public string EffectiveClientSubpath(string? configured)
    {
        string subpath = NormalizeSubpath(configured, DefaultClientModPath);
        string? runtime = RuntimeFolderName;
        if (runtime is null || !RuntimeHasOwnBepInEx) return subpath;
        return subpath.StartsWith(runtime + "/", StringComparison.OrdinalIgnoreCase)
            ? subpath : runtime + "/" + subpath;
    }

    /// <summary>Effective server-mods subpath for an arbitrary configured value (Settings preview).</summary>
    public string EffectiveServerSubpath(string? configured)
    {
        string subpath = NormalizeSubpath(configured, DefaultServerModPath);
        string? runtime = RuntimeFolderName;
        if (runtime is null) return subpath;
        return subpath.StartsWith(runtime + "/", StringComparison.OrdinalIgnoreCase)
            ? subpath : runtime + "/" + subpath;
    }

    /// <summary>True when BepInEx lives inside the runtime folder rather than the install root
    /// (the root has no BepInEx of its own).</summary>
    private bool RuntimeHasOwnBepInEx
    {
        get
        {
            string? runtime = RuntimeFolderName;
            string? root = Settings.SptDirectory;
            if (runtime is null || string.IsNullOrWhiteSpace(root)) return false;
            try
            {
                return Directory.Exists(Path.Combine(root, runtime, "BepInEx"))
                    && !Directory.Exists(Path.Combine(root, "BepInEx"));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
            {
                return false;
            }
        }
    }

    /// <summary>Preview helper: shows what will actually be used for a typed-in subpath.</summary>
    public string NormalizePreviewSubpath(string? value, string fallback) => NormalizeSubpath(value, fallback);

    private static string NormalizeSubpath(string? value, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value)) return fallback;
        string trimmed = value.Trim().TrimStart('/', '\\').TrimEnd('/', '\\');
        if (trimmed.Length == 0) return fallback;
        if (Path.IsPathRooted(trimmed)) return fallback; // subpaths only — absolute paths are rejected
        return trimmed.Replace('\\', '/');
    }

    /// <summary>Erases local app log files (crash.log etc.) from the app-data dir. Returns (files, bytes).</summary>
    public (int Files, long Bytes) ClearLogFiles()
    {
        int files = 0;
        long bytes = 0;
        try
        {
            foreach (string log in Directory.EnumerateFiles(AppDataDir, "*.log"))
            {
                try
                {
                    bytes += new FileInfo(log).Length;
                    File.Delete(log);
                    files++;
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        return (files, bytes);
    }

    private void Load()
    {
        try
        {
            if (File.Exists(_settingsPath))
            {
                var loaded = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(_settingsPath), JsonOptions);
                if (loaded is not null) Settings = loaded;
            }
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            Settings = new AppSettings(); // corrupted file — start fresh rather than crashing
        }
        Settings.InstalledMods ??= new Dictionary<int, InstalledModRecord>();
    }

    public void Save()
    {
        try
        {
            File.WriteAllText(_settingsPath, JsonSerializer.Serialize(Settings, JsonOptions));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Settings persistence is best-effort; never crash the app over it.
        }
    }

    public void RecordInstall(int modId, string name, string version, int? releaseId = null)
    {
        Settings.InstalledMods[modId] = new InstalledModRecord
        {
            Name = name,
            Version = version,
            InstalledAtUtc = DateTime.UtcNow,
            ReleaseId = releaseId
        };
        Save(); // explicit flush — the record must survive a restart the moment the install/update lands
    }
}
