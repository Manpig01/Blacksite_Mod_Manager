using System.Globalization;
using System.Windows.Input;
using Blacksite.Models;
using Blacksite.Services;

namespace Blacksite.ViewModels;

/// <summary>
/// One version card in the version selection modal: the real release data from
/// GET /mod/{id}/versions — version, badges (Latest / Fika / downloads / date / SPT constraint),
/// an interactive changelog expander and the green Install button.
/// </summary>
public sealed class VersionCardViewModel : ViewModelBase
{
    private readonly Action<VersionCardViewModel> _installHandler;
    private bool _isExpanded;
    private bool _isQueued;

    public VersionCardViewModel(ModVersion version, bool isLatest, Action<VersionCardViewModel> installHandler)
    {
        Version = version;
        IsLatest = isLatest;
        _installHandler = installHandler;
        InstallCommand = new RelayCommand(() => _installHandler(this), () => !IsQueued);

        VersionLabel = version.Version;
        FikaCompatible = string.Equals(version.FikaCompatibility, "compatible", StringComparison.OrdinalIgnoreCase);
        FikaText = FikaCompatible ? "Fika Compatible" : "Fika unknown";
        DownloadsText = $"{FormatCount(version.Downloads)} downloads";
        DateText = version.PublishedAt is { } dt
            ? dt.UtcDateTime.ToString("yyyy MMM d", CultureInfo.InvariantCulture)
            : "unknown date";

        string constraint = (version.SptVersionConstraint ?? string.Empty).Trim();
        SptText = constraint.Length == 0 ? "★ SPT any" : $"★ SPT {constraint}";

        ChangelogText = HtmlText.ToPlainText(version.Description);
        HasChangelog = ChangelogText.Length > 0;
    }

    public ModVersion Version { get; }
    public ICommand InstallCommand { get; }

    public string VersionLabel { get; }
    public bool IsLatest { get; }
    public bool FikaCompatible { get; }
    public string FikaText { get; }
    public string DownloadsText { get; }
    public string DateText { get; }
    public string SptText { get; }
    public string ChangelogText { get; }
    public bool HasChangelog { get; }

    public string SizeText => Version.ContentLength is { } bytes
        ? $"{bytes / 1024.0 / 1024.0:F1} MB"
        : "size unknown";

    public bool IsExpanded
    {
        get => _isExpanded;
        set { if (SetProperty(ref _isExpanded, value)) OnPropertyChanged(nameof(ChangelogToggleText)); }
    }

    public string ChangelogToggleText => IsExpanded ? "Changelog  ▲" : "Changelog  ▼";

    public bool IsQueued
    {
        get => _isQueued;
        set
        {
            if (SetProperty(ref _isQueued, value))
            {
                OnPropertyChanged(nameof(InstallButtonText));
                ((RelayCommand)InstallCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public string InstallButtonText => IsQueued ? "Queued…" : "Install";

    private static string FormatCount(long count) => count >= 1000
        ? $"{count / 1000.0:F1}k"
        : count.ToString(CultureInfo.InvariantCulture);
}
