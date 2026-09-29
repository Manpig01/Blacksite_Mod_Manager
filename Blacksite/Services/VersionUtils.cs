using System.Text.RegularExpressions;

namespace Blacksite.Services;

/// <summary>
/// Central version-sanitizing parser for every "is there an update?" decision (the false
/// "⬆ Update" button fix). Authors format versions wildly — "v4.1.0", "V 2.0", "ver-2.5",
/// "4.1.0-release", "4.1.0 RC2", plain "2" — so raw string comparisons and string-match
/// server verdicts fabricate updates. Everything flows through
/// <see cref="ParseVersion"/> (sanitize → numeric core → <see cref="Version"/>) and
/// <see cref="IsNewer"/> (STRICT <c>&gt;</c> only; equal, older or unparseable sides are
/// NEVER an update).
/// </summary>
public static partial class VersionUtils
{
    /// <summary>Strips leading markers: "version", "ver", "v"/"V" (case-insensitive) plus any
    /// separators/whitespace after them. "v4.1.0" → "4.1.0", "ver-2.5" → "2.5".</summary>
    [GeneratedRegex(@"^(?:version|ver|v)[\s\-.]*", RegexOptions.IgnoreCase)]
    private static partial Regex LeadingMarkerRegex();

    /// <summary>The numeric dotted core at the head of the string (1–4 segments); everything
    /// after it (prerelease tags, build metadata, free-text annotations) is ignored.</summary>
    [GeneratedRegex(@"^(?<core>\d+(?:\.\d+){0,3})")]
    private static partial Regex NumericCoreRegex();

    /// <summary>
    /// Parses a raw version string into a comparable <see cref="Version"/>:
    ///   1. strip leading v/V/ver-/version markers and whitespace;
    ///   2. take the leading numeric dotted core (suffixes like "-beta", "-release",
    ///      "+build", " RC2" are dropped — formatting, not semantics);
    ///   3. parse with <see cref="Version.TryParse"/> (single integers are padded to
    ///      major.minor so "2" compares cleanly against "2.0").
    /// Returns null when nothing numeric can be extracted.
    /// </summary>
    public static Version? ParseVersion(string? rawVersion)
    {
        if (string.IsNullOrWhiteSpace(rawVersion)) return null;

        string text = LeadingMarkerRegex().Replace(rawVersion.Trim(), string.Empty);
        var match = NumericCoreRegex().Match(text);
        if (!match.Success) return null;

        string core = match.Groups["core"].Value;
        if (!core.Contains('.')) core += ".0"; // integer fallback: "2" → "2.0"

        return Version.TryParse(core, out Version? parsed) ? parsed : null;
    }

    /// <summary>
    /// STRICT update test: true only when <paramref name="remote"/> parses to a version
    /// strictly GREATER than <paramref name="local"/>. Equal, older, or unparseable sides
    /// (either one) return false — when "newer" cannot be PROVEN, no update is shown.
    /// </summary>
    public static bool IsNewer(string? remote, string? local)
    {
        Version? remoteVersion = ParseVersion(remote);
        Version? localVersion = ParseVersion(local);
        if (remoteVersion is null || localVersion is null) return false;
        return remoteVersion.CompareTo(localVersion) > 0;
    }
}
