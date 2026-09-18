using System.Text.RegularExpressions;

namespace Blacksite.Services;

/// <summary>
/// Minimal semantic-version implementation sufficient for the SPT ecosystem:
/// major.minor[.patch[.build]][-prerelease][+metadata], e.g. "1.1.0+aki-37x", "4.0.12", "2.0.0-beta.1".
/// </summary>
public sealed partial class SemVersion : IComparable<SemVersion>, IEquatable<SemVersion>
{
    public static readonly SemVersion Zero = new(0, 0, 0, 0, null, null);

    public int Major { get; }
    public int Minor { get; }
    public int Patch { get; }
    public int Build { get; }
    public string? Prerelease { get; }
    public string? Metadata { get; }
    public string Original { get; }

    private SemVersion(int major, int minor, int patch, int build, string? prerelease, string? metadata, string? original = null)
    {
        Major = major; Minor = minor; Patch = patch; Build = build;
        Prerelease = prerelease; Metadata = metadata;
        Original = original ?? $"{major}.{minor}.{patch}";
    }

    public static bool TryParse(string? text, out SemVersion? version)
    {
        version = null;
        if (string.IsNullOrWhiteSpace(text)) return false;
        var m = VersionRegex().Match(text.Trim());
        if (!m.Success) return false;

        int major = int.Parse(m.Groups["major"].Value);
        int minor = m.Groups["minor"].Success ? int.Parse(m.Groups["minor"].Value) : 0;
        int patch = m.Groups["patch"].Success ? int.Parse(m.Groups["patch"].Value) : 0;
        int build = m.Groups["build"].Success ? int.Parse(m.Groups["build"].Value) : 0;
        string? pre = m.Groups["pre"].Success ? m.Groups["pre"].Value : null;
        string? meta = m.Groups["meta"].Success ? m.Groups["meta"].Value : null;

        version = new SemVersion(major, minor, patch, build, pre, meta, text.Trim());
        return true;
    }

    public static SemVersion? TryParse(string? text) => TryParse(text, out var v) ? v : null;

    public int CompareTo(SemVersion? other)
    {
        if (other is null) return 1;
        int c = Major.CompareTo(other.Major); if (c != 0) return c;
        c = Minor.CompareTo(other.Minor); if (c != 0) return c;
        c = Patch.CompareTo(other.Patch); if (c != 0) return c;
        c = Build.CompareTo(other.Build); if (c != 0) return c;

        // A version without prerelease outranks one with a prerelease.
        if (Prerelease is null && other.Prerelease is null) return 0;
        if (Prerelease is null) return 1;
        if (other.Prerelease is null) return -1;

        string[] a = Prerelease.Split('.');
        string[] b = other.Prerelease.Split('.');
        for (int i = 0; i < Math.Min(a.Length, b.Length); i++)
        {
            bool aNum = int.TryParse(a[i], out int ai);
            bool bNum = int.TryParse(b[i], out int bi);
            c = (aNum, bNum) switch
            {
                (true, true) => ai.CompareTo(bi),
                (true, false) => -1,
                (false, true) => 1,
                (false, false) => string.Compare(a[i], b[i], StringComparison.OrdinalIgnoreCase)
            };
            if (c != 0) return c;
        }
        return a.Length.CompareTo(b.Length);
    }

    public bool Equals(SemVersion? other) => other is not null && CompareTo(other) == 0;
    public override bool Equals(object? obj) => Equals(obj as SemVersion);
    public override int GetHashCode() => HashCode.Combine(Major, Minor, Patch, Build, Prerelease?.ToLowerInvariant());
    public override string ToString() => Original;

    [GeneratedRegex(@"^(?<major>\d+)(?:\.(?<minor>\d+))?(?:\.(?<patch>\d+))?(?:\.(?<build>\d+))?(?:-(?<pre>[0-9A-Za-z\-.]+))?(?:\+(?<meta>[0-9A-Za-z\-.]+))?$")]
    private static partial Regex VersionRegex();
}

/// <summary>
/// Version-constraint evaluator for the "spt_version_constraint" strings returned by the API
/// (e.g. "~4.0.12", "&gt;=4.0.13 &lt;4.1.0", "4.1.3", "^3.9.0", "*", " 4.0.10 ").
/// Supports || (OR), whitespace/comma separated comparators (AND), and ~ ^ &gt;= &lt;= &gt; &lt; = operators.
/// Unknown/malformed constraints are treated as "matches everything" so a bad string never blocks an install.
/// </summary>
public sealed partial class VersionConstraint
{
    private readonly List<List<Comparator>> _orGroups;
    public bool IsWildcard { get; }

    private VersionConstraint(List<List<Comparator>> orGroups, bool wildcard)
    {
        _orGroups = orGroups;
        IsWildcard = wildcard;
    }

    public static VersionConstraint Parse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Trim() is "*" or "any")
            return new VersionConstraint(new List<List<Comparator>>(), true);

        var orGroups = new List<List<Comparator>>();
        foreach (string orPart in text.Split("||", StringSplitOptions.TrimEntries))
        {
            var andGroup = new List<Comparator>();
            foreach (Match m in ComparatorRegex().Matches(orPart))
            {
                if (!SemVersion.TryParse(m.Groups["ver"].Value, out var v) || v is null) continue;
                string op = m.Groups["op"].Success ? m.Groups["op"].Value : "=";
                andGroup.Add(new Comparator(op, v));
            }
            orGroups.Add(andGroup);
        }
        return new VersionConstraint(orGroups, false);
    }

    public bool IsSatisfiedBy(SemVersion version)
    {
        if (IsWildcard) return true;
        if (_orGroups.Count == 0) return true;
        return _orGroups.Any(group => group.All(c => c.Matches(version)));
    }

    private sealed record Comparator(string Op, SemVersion Version)
    {
        public bool Matches(SemVersion v)
        {
            switch (Op)
            {
                case ">": return v.CompareTo(Version) > 0;
                case ">=": return v.CompareTo(Version) >= 0;
                case "<": return v.CompareTo(Version) < 0;
                case "<=": return v.CompareTo(Version) <= 0;
                case "=": return v.CompareTo(Version) == 0;
                case "~":
                {
                    // ~X.Y.Z  => >= X.Y.Z and < X.(Y+1).0
                    // ~X.Y    => >= X.Y.0 and < X.(Y+1).0
                    if (v.CompareTo(Version) < 0) return false;
                    var upper = new VersionBound(Version.Major, Version.Minor + 1);
                    return LessThanUpper(v, upper.Major, upper.Minor);
                }
                case "^":
                {
                    // ^X.Y.Z => >= X.Y.Z and < (X+1).0.0  (for X > 0)
                    if (v.CompareTo(Version) < 0) return false;
                    if (Version.Major > 0) return v.Major == Version.Major;
                    if (Version.Minor > 0) return v.Major == 0 && v.Minor == Version.Minor;
                    return v.Major == 0 && v.Minor == 0 && v.Patch == Version.Patch;
                }
                default: return true;
            }
        }

        private static bool LessThanUpper(SemVersion v, int major, int minor)
            => v.Major < major || (v.Major == major && v.Minor < minor);

        private readonly record struct VersionBound(int Major, int Minor);
    }

    [GeneratedRegex(@"(?<op>>=|<=|~>|~|\^|>|<|=)?\s*(?<ver>\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z\-.]+)?(?:\+[0-9A-Za-z\-.]+)?)")]
    private static partial Regex ComparatorRegex();
}

/// <summary>Picks the best release for a mod given the user's SPT version.</summary>
public static class VersionSelector
{
    public sealed record Selection(Models.ModVersion Version, bool CompatibleWithSpt);

    public static Selection? PickBest(IReadOnlyList<Models.ModVersion> versions, string? sptVersion)
    {
        if (versions.Count == 0) return null;

        var parsed = versions
            .Where(v => !string.IsNullOrWhiteSpace(v.Link))
            .Select(v => (Mod: v, Sem: SemVersion.TryParse(v.Version) ?? SemVersion.Zero))
            .ToList();
        if (parsed.Count == 0) return null;

        if (!string.IsNullOrWhiteSpace(sptVersion) && SemVersion.TryParse(sptVersion, out var spt) && spt is not null)
        {
            var compatible = parsed
                .Where(x => VersionConstraint.Parse(x.Mod.SptVersionConstraint).IsSatisfiedBy(spt))
                .OrderByDescending(x => x.Sem)
                .ThenByDescending(x => x.Mod.PublishedAt ?? DateTimeOffset.MinValue)
                .ToList();
            if (compatible.Count > 0)
                return new Selection(compatible[0].Mod, true);
        }

        var best = parsed
            .OrderByDescending(x => x.Sem)
            .ThenByDescending(x => x.Mod.PublishedAt ?? DateTimeOffset.MinValue)
            .First();
        return new Selection(best.Mod, false);
    }
}
