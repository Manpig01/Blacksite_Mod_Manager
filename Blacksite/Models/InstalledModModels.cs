using System.Text.Json.Serialization;

namespace Blacksite.Models;

public enum InstalledModKind { Server, Client }

public enum UpdateStatus { Unknown, UpToDate, UpdateAvailable, Incompatible, Blocked }

/// <summary>Result of the live update check for one installed mod.</summary>
public sealed class UpdateCheckOutcome
{
    public UpdateStatus Status { get; init; } = UpdateStatus.Unknown;
    public string? NewVersion { get; init; }
    public string? Link { get; init; }
    public long? ContentLength { get; init; }
    public string? Reason { get; init; }
    public int? CatalogModId { get; init; }
}

/// <summary>One mod detected on disk by the local scanner.</summary>
public sealed class InstalledModInfo
{
    public required InstalledModKind Kind { get; init; }
    /// <summary>Absolute path of the mod's folder (or single plugin dll / script file).</summary>
    public required string InstallPath { get; init; }
    public required bool IsDirectory { get; init; }
    /// <summary>Absolute path of the containing directory (user\mods or BepInEx\plugins).</summary>
    public required string ParentDirectory { get; init; }
    public required string DisplayName { get; init; }
    /// <summary>GUID-like package identifier (package.json "name"/"id", BepInPlugin GUID or manifest namespace.name) when known.</summary>
    public string? PackageId { get; init; }
    public string? Version { get; init; }
    public string? Authors { get; init; }
    public string? MainEntry { get; init; }
    /// <summary>SPT version declared by the mod itself (package.json sptVersion/akiVersion), when present.</summary>
    public string? SptVersionHint { get; init; }
    public required bool IsDisabled { get; init; }
    /// <summary>Where the metadata came from: package.json / BepInPlugin / manifest.json / assembly info / folder.</summary>
    public required string InfoSource { get; init; }

    /// <summary>Stable identity across rescans/renames (enable/disable changes the path, not the identity).</summary>
    public string IdentityKey => $"{Kind}:{(PackageId ?? DisplayName).ToLowerInvariant()}";
}

// --------------------------------------------------------------- /mods/updates

public sealed class UpdatesData
{
    [JsonPropertyName("spt_version")] public string? SptVersion { get; set; }
    [JsonPropertyName("updates")] public List<UpdateEntry>? Updates { get; set; }
    [JsonPropertyName("blocked_updates")] public List<UpdateEntry>? BlockedUpdates { get; set; }
    [JsonPropertyName("up_to_date")] public List<CurrentVersionInfo>? UpToDate { get; set; }
    [JsonPropertyName("incompatible_with_spt")] public List<IncompatibleEntry>? IncompatibleWithSpt { get; set; }
}

public sealed class UpdateEntry
{
    [JsonPropertyName("current_version")] public CurrentVersionInfo? CurrentVersion { get; set; }
    [JsonPropertyName("recommended_version")] public RecommendedVersionInfo? RecommendedVersion { get; set; }
    [JsonPropertyName("update_reason")] public string? UpdateReason { get; set; }
    [JsonPropertyName("reason")] public string? Reason { get; set; }
}

public sealed class CurrentVersionInfo
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("mod_id")] public int? ModId { get; set; }
    [JsonPropertyName("guid")] public string? Guid { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("slug")] public string? Slug { get; set; }
    [JsonPropertyName("version")] public string? Version { get; set; }
}

public sealed class RecommendedVersionInfo
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("version")] public string? Version { get; set; }
    [JsonPropertyName("link")] public string? Link { get; set; }
    [JsonPropertyName("content_length")] public long? ContentLength { get; set; }
    [JsonPropertyName("fika_compatibility")] public string? FikaCompatibility { get; set; }
    [JsonPropertyName("spt_versions")] public List<string>? SptVersions { get; set; }
}

public sealed class IncompatibleEntry
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("mod_id")] public int? ModId { get; set; }
    [JsonPropertyName("guid")] public string? Guid { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("slug")] public string? Slug { get; set; }
    [JsonPropertyName("version")] public string? Version { get; set; }
    [JsonPropertyName("reason")] public string? Reason { get; set; }
    [JsonPropertyName("latest_compatible_version")] public RecommendedVersionInfo? LatestCompatibleVersion { get; set; }
}
