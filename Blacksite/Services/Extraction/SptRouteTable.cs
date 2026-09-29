using Blacksite.Models;

namespace Blacksite.Services.Extraction;

/// <summary>One remap rule: a canonical archive subpath that redirects to a CONFIGURED path
/// (Settings tab) when the user customized it. Data, not code — future SPT layout changes
/// land here as new rows.</summary>
public sealed record RouteRemapRule(string CanonicalSubPath, Func<SettingsService, string> EffectivePath);

/// <summary>One recognized SPT root folder that archives may carry ("user/…", "BepInEx/…").</summary>
public sealed record RootFolderRule(string Folder, RouteRemapRule[] Remaps);

/// <summary>
/// Unit 2 of the extraction architecture: SPT PATH ROUTING as a DATA-DRIVEN TABLE.
/// The previous nested if-trees ("user"/"BepInEx"/"EscapeFromTarkov_Data" string comparisons
/// sprinkled through the placement code) are replaced by rows in this table; the placement
/// engine walks the table instead of branching on names. New SPT layouts are absorbed by
/// adding rows, not by editing placement logic.
/// Semantics are byte-identical to the pre-rewrite rules (characterized by QueueSmokeTest §B/§C/§L
/// and InstalledSmokeTest §B/§C).
/// </summary>
public sealed class SptRouteTable
{
    public static SptRouteTable Default { get; } = new();

    /// <summary>How many leading wrapper folders ("SPT/…", "SPT_Runtime/…") may sit between the
    /// archive root and a recognized folder before the entry counts as payload. Current SPT
    /// packaging uses at most one.</summary>
    public int MaxWrapperDepth { get; init; } = 1;

    /// <summary>Folders an archive may root at that merge directly into the SPT install root.</summary>
    public IReadOnlyList<RootFolderRule> RootFolders { get; init; } = new[]
    {
        new RootFolderRule("user", new[]
        {
            // server mods → the effective server path (SPT 4.x: {root}\{runtime}\user\mods)
            new RouteRemapRule("user/mods", s => s.ServerModPathEffective),
        }),
        new RootFolderRule("BepInEx", new[]
        {
            // client plugins → the effective client path (root BepInEx\plugins by default)
            new RouteRemapRule("BepInEx/plugins", s => s.ClientModPathEffective),
        }),
        new RootFolderRule("EscapeFromTarkov_Data", Array.Empty<RouteRemapRule>()),
    };

    /// <summary>Bare payload folders/files route to the server mods path unless the payload
    /// probes as a client plugin ([BepInPlugin]) — table row, not an if-tree.</summary>
    public Func<SettingsService, bool, string> PayloadRootRule { get; init; } =
        (settings, looksClient) => looksClient ? settings.ClientModPathEffective : settings.ServerModPathEffective;

    /// <summary>Matches a staging top-level name against the table's recognized root folders
    /// (case-insensitive). Returns the canonical folder name, or null for payload.</summary>
    public string? MatchRootFolder(string name)
    {
        foreach (RootFolderRule rule in RootFolders)
            if (name.Equals(rule.Folder, StringComparison.OrdinalIgnoreCase))
                return rule.Folder;
        return null;
    }

    private bool StartsWithRootFolder(string p)
    {
        foreach (RootFolderRule rule in RootFolders)
            if (p.StartsWith(rule.Folder + "/", StringComparison.OrdinalIgnoreCase))
                return true;
        return false;
    }

    /// <summary>Maps an archive entry path to its SPT-root-relative path, stripping up to
    /// <see cref="MaxWrapperDepth"/> wrapper folders ("SPT/user/mods/x" → "user/mods/x").
    /// Returns null for payload entries.</summary>
    public string? MapToRoot(string normalizedPath)
    {
        if (StartsWithRootFolder(normalizedPath)) return normalizedPath;

        string current = normalizedPath;
        for (int depth = 0; depth < MaxWrapperDepth; depth++)
        {
            int slash = current.IndexOf('/');
            if (slash <= 0 || slash >= current.Length - 1) break;
            current = current[(slash + 1)..];
            if (StartsWithRootFolder(current)) return current;
        }
        return null;
    }

    /// <summary>Remaps canonical mod folders to the user's CONFIGURED subpaths (Settings tab).
    /// Entries keep their canonical location when the defaults are in use.</summary>
    public string RemapConfigured(string mappedRelative)
    {
        var settings = SettingsService.Instance;
        if (settings is null) return mappedRelative;

        foreach (RootFolderRule rule in RootFolders)
        {
            foreach (RouteRemapRule remap in rule.Remaps)
            {
                string effective = remap.EffectivePath(settings);
                if (effective != remap.CanonicalSubPath && IsOrStartsWith(mappedRelative, remap.CanonicalSubPath))
                    return ReplacePrefix(mappedRelative, remap.CanonicalSubPath, effective);
            }
        }
        return mappedRelative;
    }

    /// <summary>Where bare payload content goes inside the SPT root.</summary>
    public string PayloadRelativePath(bool payloadLooksClient)
    {
        var settings = SettingsService.Instance;
        return settings is not null ? PayloadRootRule(settings, payloadLooksClient) : ServerDefault;
    }

    internal const string ServerDefault = "user/mods";
    internal const string ClientDefault = "BepInEx/plugins";

    private static bool IsOrStartsWith(string path, string prefix) =>
        string.Equals(path, prefix, StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith(prefix + "/", StringComparison.OrdinalIgnoreCase);

    private static string ReplacePrefix(string path, string prefix, string replacement) =>
        path.Length == prefix.Length ? replacement : replacement + path[prefix.Length..];
}
