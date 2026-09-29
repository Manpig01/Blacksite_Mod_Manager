using Blacksite.Models;

namespace Blacksite.Services;

/// <summary>
/// Local (client-side) filtering + sorting for the Installed Mods view. Pure logic, no UI
/// dependencies — the view-model forwards user input here and re-renders the grid from the result.
/// </summary>
public sealed record InstalledFilter
{
    public string SearchText { get; init; } = string.Empty;
    public bool HideDisabled { get; init; }
    /// <summary>When true, mods with a known available update are hidden (only up-to-date rows remain).</summary>
    public bool HideOutdated { get; init; }
    public bool OnlyServer { get; init; }
    public bool OnlyClient { get; init; }

    public bool HasConstraints =>
        !string.IsNullOrWhiteSpace(SearchText) || HideDisabled || HideOutdated || OnlyServer || OnlyClient;

    public static InstalledFilter None { get; } = new();
}

public enum InstalledSortColumn { Name, Type, Status, Version, Author }

public enum SortDirection { None, Ascending, Descending }

/// <summary>One installed row's data as consumed by the filter engine.</summary>
public readonly record struct InstalledRowData(InstalledModInfo Info, UpdateCheckOutcome? Outcome);

public static class ModFilterEngine
{
    /// <summary>
    /// Text match against the local metadata the scanner harvested: display name (package.json
    /// "name" / BepInPlugin name / folder), author(s) and package ID.
    /// </summary>
    public static bool MatchesText(in InstalledRowData row, string query)
    {
        if (string.IsNullOrWhiteSpace(query)) return true;
        query = query.Trim();

        if (row.Info.DisplayName.Contains(query, StringComparison.OrdinalIgnoreCase)) return true;
        if (!string.IsNullOrWhiteSpace(row.Info.Authors) &&
            row.Info.Authors!.Contains(query, StringComparison.OrdinalIgnoreCase)) return true;
        if (!string.IsNullOrWhiteSpace(row.Info.PackageId) &&
            row.Info.PackageId!.Contains(query, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    /// <summary>Full predicate: text + status toggles ("Hide Disabled", "Hide Out-of-Date", "Only Server", "Only Client").</summary>
    public static bool Matches(in InstalledRowData row, InstalledFilter filter)
    {
        if (!MatchesText(row, filter.SearchText)) return false;

        if (filter.HideDisabled && row.Info.IsDisabled) return false;

        if (filter.HideOutdated && row.Outcome is { Status: UpdateStatus.UpdateAvailable }) return false;

        // Component flags (not raw Kind): a consolidated card carrying BOTH a server and a
        // client half must appear under either filter. For raw single rows these equal Kind.
        if (filter.OnlyServer && !row.Info.HasServerMod) return false;
        if (filter.OnlyClient && !row.Info.HasClientPlugin) return false;

        // "Show Only Server" and "Show Only Client" are mutually exclusive by definition.
        return true;
    }

    /// <summary>Applies text + toggle filters, preserving the incoming order.</summary>
    public static List<InstalledRowData> Apply(IEnumerable<InstalledRowData> source, InstalledFilter filter)
        => source.Where(r => Matches(r, filter)).ToList();

    /// <summary>Sorts filtered rows by the selected column/direction. Rows keep their current order for <see cref="SortDirection.None"/>.</summary>
    public static void Sort(List<InstalledRowData> rows, InstalledSortColumn column, SortDirection direction)
    {
        if (direction == SortDirection.None) return;

        Comparison<InstalledRowData> comparison;
        switch (column)
        {
            case InstalledSortColumn.Name:
                comparison = (a, b) => string.Compare(a.Info.DisplayName, b.Info.DisplayName, StringComparison.OrdinalIgnoreCase);
                break;
            case InstalledSortColumn.Author:
                comparison = (a, b) => string.Compare(a.Info.Authors ?? "\uffff", b.Info.Authors ?? "\uffff", StringComparison.OrdinalIgnoreCase);
                break;
            case InstalledSortColumn.Type:
                // Ascending follows the visible type text: "Client Plugin" before "Server Mod".
                comparison = (a, b) => b.Info.Kind.CompareTo(a.Info.Kind); // Client (1) before Server (0)
                break;
            case InstalledSortColumn.Status:
                comparison = (a, b) => (a.Info.IsDisabled ? 1 : 0).CompareTo(b.Info.IsDisabled ? 1 : 0); // Active first
                break;
            case InstalledSortColumn.Version:
                comparison = (a, b) => CompareVersions(a.Info.Version, b.Info.Version);
                break;
            default:
                comparison = (a, b) => 0;
                break;
        }

        rows.Sort((a, b) =>
        {
            int result = comparison(a, b);
            return direction == SortDirection.Ascending ? result : -result;
        });
    }

    /// <summary>Semantic version ordering; unparsable versions sink to the bottom regardless of direction.</summary>
    private static int CompareVersions(string? x, string? y)
    {
        bool xOk = SemVersion.TryParse(x ?? "", out var xVer);
        bool yOk = SemVersion.TryParse(y ?? "", out var yVer);
        return (xOk, yOk) switch
        {
            (true, true) => xVer!.CompareTo(yVer),
            (true, false) => -1,
            (false, true) => 1,
            _ => string.Compare(x ?? "", y ?? "", StringComparison.OrdinalIgnoreCase)
        };
    }
}
