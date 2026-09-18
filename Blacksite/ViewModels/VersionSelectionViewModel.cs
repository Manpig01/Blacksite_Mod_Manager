using System.Collections.ObjectModel;
using Blacksite.Models;
using Blacksite.Services;

namespace Blacksite.ViewModels;

/// <summary>
/// View model of the version selection modal: performs the real GET /mod/{id}/versions fetch,
/// orders releases newest-first (semver, then publish date) and exposes one live card per release.
/// </summary>
public sealed class VersionSelectionViewModel : ViewModelBase
{
    private readonly SpModApiClient _api;
    private readonly Action<VersionCardViewModel> _installHandler;
    private bool _isLoading = true;
    private string _loadingText = "Fetching versions from sp-mod.com…";
    private string _errorText = string.Empty;

    public VersionSelectionViewModel(Mod mod, SpModApiClient api, Action<VersionCardViewModel> installHandler)
    {
        Mod = mod;
        _api = api;
        _installHandler = installHandler;
    }

    public Mod Mod { get; }

    public string ModTitle => Mod.DisplayName;

    public ObservableCollection<VersionCardViewModel> Items { get; } = new();

    public bool IsLoading
    {
        get => _isLoading;
        private set => SetProperty(ref _isLoading, value);
    }

    public string LoadingText
    {
        get => _loadingText;
        private set => SetProperty(ref _loadingText, value);
    }

    public string ErrorText
    {
        get => _errorText;
        private set => SetProperty(ref _errorText, value);
    }

    public string CountText => Items.Count == 0
        ? string.Empty
        : $"{Items.Count} release{(Items.Count == 1 ? string.Empty : "s")} — newest first";

    /// <summary>Live fetch of the real version list (called once when the window opens).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken)
    {
        try
        {
            List<ModVersion> versions = await _api.GetVersionsAsync(Mod.Id, cancellationToken);

            List<ModVersion> ordered = versions
                .OrderByDescending(v => SemVersion.TryParse(v.Version) ?? SemVersion.Zero)
                .ThenByDescending(v => v.PublishedAt ?? DateTimeOffset.MinValue)
                .ToList();

            Items.Clear();
            for (int i = 0; i < ordered.Count; i++)
                Items.Add(new VersionCardViewModel(ordered[i], isLatest: i == 0, _installHandler));

            OnPropertyChanged(nameof(CountText));
            IsLoading = false;
        }
        catch (OperationCanceledException)
        {
            // window closed mid-fetch
        }
        catch (Exception ex)
        {
            IsLoading = false;
            ErrorText = $"Could not load versions: {ex.Message}";
        }
    }
}
