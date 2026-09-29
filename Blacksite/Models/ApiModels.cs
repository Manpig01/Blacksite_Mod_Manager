using System.Text.Json.Serialization;

namespace Blacksite.Models;

/// <summary>Laravel-style paginated envelope: { success, data: [ ... ], links, meta }.</summary>
public sealed class PagedResponse<T>
{
    [JsonPropertyName("success")] public bool Success { get; set; }
    [JsonPropertyName("code")] public string? Code { get; set; }
    [JsonPropertyName("message")] public string? Message { get; set; }
    [JsonPropertyName("data")] public List<T> Data { get; set; } = new();
    [JsonPropertyName("links")] public PageLinks? Links { get; set; }
    [JsonPropertyName("meta")] public PageMeta? Meta { get; set; }
}

/// <summary>Non-paginated envelope: { success, data } (also carries code/message on errors).</summary>
public sealed class ApiResponse<T>
{
    [JsonPropertyName("success")] public bool Success { get; set; }
    [JsonPropertyName("code")] public string? Code { get; set; }
    [JsonPropertyName("message")] public string? Message { get; set; }
    [JsonPropertyName("data")] public T? Data { get; set; }
}

public sealed class PageLinks
{
    [JsonPropertyName("first")] public string? First { get; set; }
    [JsonPropertyName("last")] public string? Last { get; set; }
    [JsonPropertyName("prev")] public string? Prev { get; set; }
    [JsonPropertyName("next")] public string? Next { get; set; }
}

public sealed class PageMeta
{
    [JsonPropertyName("current_page")] public int CurrentPage { get; set; }
    [JsonPropertyName("from")] public int? From { get; set; }
    [JsonPropertyName("last_page")] public int LastPage { get; set; }
    [JsonPropertyName("per_page")] public int PerPage { get; set; }
    [JsonPropertyName("to")] public int? To { get; set; }
    [JsonPropertyName("total")] public int Total { get; set; }
}

public sealed class ModOwner
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [JsonPropertyName("profile_photo_url")] public string? ProfilePhotoUrl { get; set; }
    [JsonPropertyName("cover_photo_url")] public string? CoverPhotoUrl { get; set; }
}

public sealed class ModCategory
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("hub_id")] public int? HubId { get; set; }
    [JsonPropertyName("title")] public string? Title { get; set; }
    [JsonPropertyName("slug")] public string? Slug { get; set; }
}

/// <summary>One entry of GET /mods.</summary>
public sealed class Mod
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("hub_id")] public int? HubId { get; set; }
    [JsonPropertyName("guid")] public string? Guid { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("slug")] public string? Slug { get; set; }
    [JsonPropertyName("teaser")] public string? Teaser { get; set; }
    [JsonPropertyName("thumbnail")] public string? Thumbnail { get; set; }
    [JsonPropertyName("downloads")] public int Downloads { get; set; }
    [JsonPropertyName("favourites_count")] public int FavouritesCount { get; set; }
    [JsonPropertyName("endorsements_count")] public int EndorsementsCount { get; set; }
    [JsonPropertyName("detail_url")] public string? DetailUrl { get; set; }
    [JsonPropertyName("featured")] public bool Featured { get; set; }
    [JsonPropertyName("contains_ads")] public bool ContainsAds { get; set; }
    [JsonPropertyName("contains_ai_content")] public bool ContainsAiContent { get; set; }
    [JsonPropertyName("cheat_notice")] public bool CheatNotice { get; set; }
    [JsonPropertyName("category_id")] public int? CategoryId { get; set; }
    [JsonPropertyName("fika_compatibility")] public bool? FikaCompatibility { get; set; }
    [JsonPropertyName("published_at")] public DateTimeOffset? PublishedAt { get; set; }
    [JsonPropertyName("created_at")] public DateTimeOffset? CreatedAt { get; set; }
    [JsonPropertyName("updated_at")] public DateTimeOffset? UpdatedAt { get; set; }
    [JsonPropertyName("owner")] public ModOwner? Owner { get; set; }
    [JsonPropertyName("additional_authors")] public List<ModOwner>? AdditionalAuthors { get; set; }
    [JsonPropertyName("category")] public ModCategory? Category { get; set; }

    [JsonIgnore] public string DisplayName => string.IsNullOrWhiteSpace(Name) ? $"Mod #{Id}" : Name!;
    [JsonIgnore] public string AuthorName => Owner?.Name ?? "Unknown";
    /// <summary>Package identifier — the GUID when the API provides one, otherwise the slug.</summary>
    [JsonIgnore] public string PackageId => string.IsNullOrWhiteSpace(Guid) ? (Slug ?? $"id-{Id}") : Guid!;

    [JsonIgnore]
    public string AllAuthors
    {
        get
        {
            if (AdditionalAuthors is not { Count: > 0 }) return AuthorName;
            var names = AdditionalAuthors.Where(a => !string.IsNullOrWhiteSpace(a.Name)).Select(a => a.Name);
            return AuthorName + ", " + string.Join(", ", names);
        }
    }
}

/// <summary>One entry of GET /mod/{id}/versions.</summary>
public sealed class ModVersion
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("hub_id")] public int? HubId { get; set; }
    [JsonPropertyName("version")] public string Version { get; set; } = string.Empty;
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("link")] public string? Link { get; set; }
    [JsonPropertyName("content_length")] public long? ContentLength { get; set; }
    [JsonPropertyName("spt_version_constraint")] public string? SptVersionConstraint { get; set; }
    [JsonPropertyName("downloads")] public int Downloads { get; set; }
    [JsonPropertyName("fika_compatibility")] public string? FikaCompatibility { get; set; }
    [JsonPropertyName("published_at")] public DateTimeOffset? PublishedAt { get; set; }
    [JsonPropertyName("created_at")] public DateTimeOffset? CreatedAt { get; set; }
    [JsonPropertyName("updated_at")] public DateTimeOffset? UpdatedAt { get; set; }
}

/// <summary>One resolved dependency returned by GET /mods/dependencies.</summary>
public sealed class DependencyInfo
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("guid")] public string? Guid { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("slug")] public string? Slug { get; set; }
    [JsonPropertyName("latest_compatible_version")] public CompatibleVersionInfo? LatestCompatibleVersion { get; set; }
    [JsonPropertyName("conflict")] public bool Conflict { get; set; }
    [JsonPropertyName("dependencies")] public List<DependencyInfo>? Dependencies { get; set; }

    [JsonIgnore] public string DisplayName => string.IsNullOrWhiteSpace(Name) ? $"Mod #{Id}" : Name!;
    [JsonIgnore] public string PackageId => string.IsNullOrWhiteSpace(Guid) ? (Slug ?? $"id-{Id}") : Guid!;
}

public sealed class CompatibleVersionInfo
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("version")] public string? Version { get; set; }
    [JsonPropertyName("link")] public string? Link { get; set; }
    [JsonPropertyName("content_length")] public long? ContentLength { get; set; }
    [JsonPropertyName("fika_compatibility")] public string? FikaCompatibility { get; set; }
}

/// <summary>One entry of GET /spt/versions (live SPT release list with per-version mod counts).</summary>
public sealed class SptVersionInfo
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("version")] public string Version { get; set; } = string.Empty;
    [JsonPropertyName("version_major")] public int VersionMajor { get; set; }
    [JsonPropertyName("version_minor")] public int VersionMinor { get; set; }
    [JsonPropertyName("version_patch")] public int VersionPatch { get; set; }
    [JsonPropertyName("version_labels")] public string? VersionLabels { get; set; }
    [JsonPropertyName("mod_count")] public int ModCount { get; set; }
    [JsonPropertyName("link")] public string? Link { get; set; }
    [JsonPropertyName("color_class")] public string? ColorClass { get; set; }
    [JsonPropertyName("created_at")] public DateTimeOffset? CreatedAt { get; set; }
    [JsonPropertyName("updated_at")] public DateTimeOffset? UpdatedAt { get; set; }

    [JsonIgnore] public string Display => $"{Version}  ·  {ModCount:N0} mods";
}

/// <summary>One entry of GET /mod-categories (the live category taxonomy used by the Forge).</summary>
public sealed class ModCategoryInfo
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("hub_id")] public int? HubId { get; set; }
    [JsonPropertyName("title")] public string Title { get; set; } = string.Empty;
    [JsonPropertyName("slug")] public string Slug { get; set; } = string.Empty;
    [JsonPropertyName("description")] public string? Description { get; set; }

    [JsonIgnore] public string Display => string.IsNullOrEmpty(Description) ? Title : Title;
}

// ------------------------------------------------------- catalog query model

/// <summary>Server-side ordering of GET /mods. Values map to the API's real sort keys.</summary>
public enum CatalogSort
{
    /// <summary>Most downloaded first (sort=-downloads) — the default presentation.</summary>
    MostDownloaded,
    /// <summary>Newest releases first (sort=-published_at).</summary>
    MostRecent,
    /// <summary>Alphabetical A→Z (sort=name).</summary>
    NameAz,
    /// <summary>Alphabetical Z→A (sort=-name).</summary>
    NameZa,
    /// <summary>Most endorsed first (sort=-endorsements_count).</summary>
    MostEndorsed,
    /// <summary>Most favourited first (sort=-favourites_count).</summary>
    MostFavourited
}

public static class CatalogSortExtensions
{
    /// <summary>Maps to the validated sort= query value, or null to omit the parameter.</summary>
    public static string? ToApiSort(this CatalogSort sort) => sort switch
    {
        CatalogSort.MostDownloaded => "-downloads",
        CatalogSort.MostRecent => "-published_at",
        CatalogSort.NameAz => "name",
        CatalogSort.NameZa => "-name",
        CatalogSort.MostEndorsed => "-endorsements_count",
        CatalogSort.MostFavourited => "-favourites_count",
        _ => null
    };

    public static string ToDisplay(this CatalogSort sort) => sort switch
    {
        CatalogSort.MostDownloaded => "Most Downloaded",
        CatalogSort.MostRecent => "Most Recent",
        CatalogSort.NameAz => "Alphabetical (A–Z)",
        CatalogSort.NameZa => "Alphabetical (Z–A)",
        CatalogSort.MostEndorsed => "Most Endorsed",
        CatalogSort.MostFavourited => "Most Favourited",
        _ => "Most Downloaded"
    };
}

/// <summary>
/// The complete server-side filter for GET /mods. Every set value becomes a real query parameter
/// (query=…, filter[spt_version]=…, filter[category_id]=…, filter[fika_compatibility]=1, sort=…),
/// all verified against the live API.
/// </summary>
public sealed record CatalogFilter
{
    public string? SearchText { get; init; }
    public string? SptVersion { get; init; }
    public int? CategoryId { get; init; }
    public bool FikaOnly { get; init; }
    public CatalogSort Sort { get; init; } = CatalogSort.MostDownloaded;

    /// <summary>True when any constraint beyond the default sort is active.</summary>
    public bool IsActive =>
        !string.IsNullOrWhiteSpace(SearchText) ||
        !string.IsNullOrWhiteSpace(SptVersion) ||
        CategoryId is not null ||
        FikaOnly;

    public CatalogFilter WithClearedConstraints() => new() { Sort = Sort };
}

/// <summary>Raised by the HTTP pipeline for user-visible notices (throttling, retries...).</summary>
public sealed record ApiNotice(string Message);

public sealed record CatalogProgress(int Page, int LastPage, int ModsLoaded);

public sealed record DownloadProgress(long BytesReceived, long? TotalBytes, double BytesPerSecond);

/// <summary>Live progress of one install pipeline run.</summary>
public sealed record InstallProgress(
    InstallStage Stage, string StatusText, double Percent, string? SpeedText = null, string? BytesText = null,
    string? SubTask = null);

public enum InstallStage
{
    Validating,
    Resolving,
    Dependencies,
    Downloading,
    Extracting,
    Complete,
    Failed
}

/// <summary>A download produced no bytes for the configured stall window (task 6.1, Fix D).
/// Deliberately NOT an IOException/HttpRequestException so the auto-resume retry filter in
/// SpModApiClient.DownloadFileAsync lets it through — the item fails fast and cleanly instead
/// of hanging through six 60-second stall cycles.</summary>
public sealed class DownloadStallException : Exception
{
    public DownloadStallException(string message) : base(message) { }
}

public sealed class ApiException : Exception
{
    public ApiException(string message) : base(message) { }
    public ApiException(string message, Exception inner) : base(message, inner) { }
}
