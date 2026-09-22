using System.Diagnostics;
using System.Windows.Media;
using System.Windows.Input;
using Blacksite.Models;
using Blacksite.Services;

namespace Blacksite.ViewModels;

/// <summary>One row of the Installed Mods list, backed by a real on-disk mod.</summary>
public sealed class InstalledModViewModel : ViewModelBase
{
    private readonly Func<InstalledModViewModel, Task> _updateHandler;
    private readonly Func<InstalledModViewModel, Task> _toggleHandler;
    private readonly Func<InstalledModViewModel, Task> _uninstallHandler;
    private readonly Action<InstalledModViewModel> _editConfigsHandler;
    private readonly Action<InstalledModViewModel> _conflictDetailsHandler;
    private readonly ImageCache? _imageCache;
    private readonly SpModApiClient? _api;
    private bool _thumbnailRequested;
    private bool _versionInfoRequested;
    private ImageSource? _thumbnail;
    private string? _latestVersionLabel;
    private string? _sptBadgeText;
    private InstalledModInfo _info;
    private UpdateCheckOutcome? _outcome;
    private Mod? _catalogMatch;
    private bool _isBusy;
    private IReadOnlyList<Services.ModConflict>? _conflicts;

    public InstalledModViewModel(
        InstalledModInfo info,
        Func<InstalledModViewModel, Task> updateHandler,
        Func<InstalledModViewModel, Task> toggleHandler,
        Func<InstalledModViewModel, Task> uninstallHandler,
        Action<InstalledModViewModel>? editConfigsHandler = null,
        Action<InstalledModViewModel>? conflictDetailsHandler = null,
        ImageCache? imageCache = null,
        SpModApiClient? api = null)
    {
        _info = info;
        _updateHandler = updateHandler;
        _toggleHandler = toggleHandler;
        _uninstallHandler = uninstallHandler;
        _editConfigsHandler = editConfigsHandler ?? (_ => { });
        _conflictDetailsHandler = conflictDetailsHandler ?? (_ => { });
        _imageCache = imageCache;
        _api = api;

        UpdateCommand = new RelayCommand(async () => await _updateHandler(this), () => !IsBusy && CanUpdateNow);
        ToggleCommand = new RelayCommand(async () => await _toggleHandler(this), () => !IsBusy);
        UninstallCommand = new RelayCommand(async () => await _uninstallHandler(this), () => !IsBusy);
        OpenPageCommand = new RelayCommand(OpenModPage);
        EditConfigsCommand = new RelayCommand(() => _editConfigsHandler(this), () => !IsBusy);
        ShowConflictCommand = new RelayCommand(() => _conflictDetailsHandler(this));
    }

    public ICommand UpdateCommand { get; }
    public ICommand ToggleCommand { get; }
    public ICommand UninstallCommand { get; }
    public ICommand OpenPageCommand { get; }
    public ICommand EditConfigsCommand { get; }
    public ICommand ShowConflictCommand { get; }

    public InstalledModInfo Info => _info;
    public string IdentityKey => _info.IdentityKey;

    /// <summary>Refreshes the row after a rescan (identity is stable, path/state may have changed).</summary>
    public void Update(InstalledModInfo info)
    {
        _info = info;
        OnPropertyChanged(string.Empty); // everything derives from Info
        RaiseCommandStates();
    }

    public UpdateCheckOutcome? Outcome
    {
        get => _outcome;
        set
        {
            if (_outcome?.Status == value?.Status && _outcome?.NewVersion == value?.NewVersion) return;
            _outcome = value;
            OnPropertyChanged(nameof(VersionDetailText));
            OnPropertyChanged(nameof(HasUpdate));
            OnPropertyChanged(nameof(CanUpdateNow));
            OnPropertyChanged(nameof(UpdateBadgeText));
            OnPropertyChanged(nameof(UpdateBadgeBrushKey));
            RaiseCommandStates();
        }
    }

    public Mod? CatalogMatch
    {
        get => _catalogMatch;
        set
        {
            _catalogMatch = value;
            OnPropertyChanged(nameof(HasDetailUrl));
            OnPropertyChanged(nameof(AuthorsText));
            OnPropertyChanged(nameof(AuthorPillText));
            OnPropertyChanged(nameof(SecondaryTagText));
            OnPropertyChanged(nameof(HasSecondaryTag));
            OnPropertyChanged(nameof(ShowFikaOverlay));
            OnPropertyChanged(nameof(TeaserText));
            OnPropertyChanged(nameof(StatsText));
            // the card may have materialized before enrichment matched this mod to the catalog
            EnsureCardArtRequested();
        }
    }

    /// <summary>Conflicts detected by the background conflict scan that involve this mod.</summary>
    public IReadOnlyList<Services.ModConflict> Conflicts
    {
        get => _conflicts ?? Array.Empty<Services.ModConflict>();
        set
        {
            _conflicts = value;
            OnPropertyChanged(nameof(HasConflict));
            OnPropertyChanged(nameof(ConflictBadgeText));
            OnPropertyChanged(nameof(ConflictToolTip));
        }
    }

    // ============================ Unified card surface (mirrors the browse grid) ============================

    /// <summary>Placeholder letter while the thumbnail loads (or when none exists).</summary>
    public string Initial
    {
        get
        {
            string name = DisplayName;
            return string.IsNullOrEmpty(name) ? "?" : name[..1].ToUpperInvariant();
        }
    }

    /// <summary>Cached web thumbnail of the catalog match — null until loaded (placeholder shows).</summary>
    public ImageSource? Thumbnail
    {
        get => _thumbnail;
        private set => SetProperty(ref _thumbnail, value);
    }

    /// <summary>Orange author pill: the catalog author when matched, otherwise the locally read author.</summary>
    public string AuthorPillText
    {
        get
        {
            if (_catalogMatch is not null) return _catalogMatch.AuthorName;
            string? first = _info.Authors?.Split(',', 2)[0].Trim();
            return string.IsNullOrWhiteSpace(first) ? "unknown" : first;
        }
    }

    /// <summary>Gray pill #1: where the mod lives (server mod / client plugin).</summary>
    public string PrimaryTagText => KindText;

    /// <summary>Gray pill (consolidated cards): the OTHER component kind — a mod with both a
    /// server half and a client half shows BOTH pills ("Server Mod" + "Client Plugin").</summary>
    public string SecondaryKindTagText => _info.HasServerMod && _info.HasClientPlugin
        ? (_info.Kind == InstalledModKind.Server ? "Client Plugin" : "Server Mod")
        : string.Empty;
    public bool HasSecondaryKindTag => SecondaryKindTagText.Length > 0;

    /// <summary>Gray pill #2: catalog category (when the mod is matched).</summary>
    public string SecondaryTagText => _catalogMatch?.Category?.Title ?? string.Empty;
    public bool HasSecondaryTag => !string.IsNullOrEmpty(SecondaryTagText);

    /// <summary>Metadata row: "Latest vX.X.X  •  Downloads X,XXX,XXX" — live data when the mod is
    /// matched to the catalog, otherwise the locally known version.</summary>
    public string StatsText
    {
        get
        {
            string? latest = _outcome?.NewVersion ?? _latestVersionLabel;
            if (_catalogMatch is not null)
                return $"Latest {latest ?? "v—"}  •  Downloads {_catalogMatch.Downloads:N0}";
            return latest is not null ? $"Latest {latest}  •  installed locally" : InstalledVersionText;
        }
    }

    /// <summary>Green thumbnail badge: "★ SPT 4.1.x" (the newest release's own SPT constraint).</summary>
    public string SptBadgeText => _sptBadgeText ?? string.Empty;
    public bool HasSptBadge => !string.IsNullOrEmpty(_sptBadgeText);

    /// <summary>Fika overlay badge on the thumbnail (bottom-left) — from the catalog API flag.</summary>
    public bool ShowFikaOverlay => _catalogMatch?.FikaCompatibility == true;

    /// <summary>Two-line description: the catalog teaser, or a factual note for unmatched local mods.</summary>
    public string TeaserText
    {
        get
        {
            string? teaser = _catalogMatch?.Teaser;
            if (!string.IsNullOrWhiteSpace(teaser)) return teaser!.Replace("\r", " ").Replace("\n", " ").Trim();
            return "Installed locally — no catalog description available for this mod.";
        }
    }

    /// <summary>Status line at the left of the action row (disabled state wins over update info).</summary>
    public string CardStatusText => _info.IsDisabled ? "Disabled" : UpdateBadgeText;
    public string CardStatusBrushKey => _info.IsDisabled ? "Muted" : UpdateBadgeBrushKey;

    /// <summary>Called by the view when the card materializes — lazily loads the web thumbnail
    /// and the latest-release badges (both session-cached, best-effort).</summary>
    public void EnsureCardArtRequested()
    {
        if (_imageCache is not null && !_thumbnailRequested &&
            !string.IsNullOrWhiteSpace(_catalogMatch?.Thumbnail))
        {
            _thumbnailRequested = true;
            _ = LoadThumbnailAsync();
        }

        if (_api is not null && !_versionInfoRequested && _catalogMatch is not null)
        {
            _versionInfoRequested = true;
            _ = LoadVersionInfoAsync();
        }
    }

    private async Task LoadThumbnailAsync()
    {
        ImageSource? image = await _imageCache!.GetAsync(_catalogMatch!.Thumbnail!).ConfigureAwait(true);
        if (image is not null) Thumbnail = image;
    }

    private async Task LoadVersionInfoAsync()
    {
        (string Version, string Spt)? info = await ModCardViewModel.GetOrCreateVersionInfoAsync(_api!, _catalogMatch!.Id).ConfigureAwait(true);
        if (info is null) return;
        _latestVersionLabel = $"v{info.Value.Version}";
        _sptBadgeText = info.Value.Spt;
        OnPropertyChanged(nameof(StatsText));
        OnPropertyChanged(nameof(SptBadgeText));
        OnPropertyChanged(nameof(HasSptBadge));
    }

    public bool HasConflict => Conflicts.Count > 0;

    public string ConflictBadgeText => Conflicts.Count == 1 ? "⚠" : $"⚠×{Conflicts.Count}";

    public string ConflictToolTip => HasConflict
        ? Conflicts.Count == 1
            ? "Conflict detected — click for details"
            : $"{Conflicts.Count} conflicts detected — click for details"
        : string.Empty;

    public string DisplayName => _info.DisplayName;

    public string AuthorsText
    {
        get
        {
            if (!string.IsNullOrWhiteSpace(_info.Authors)) return _info.Authors!;
            if (_catalogMatch is not null) return _catalogMatch.AllAuthors;
            return "—";
        }
    }

    public string PackageIdText => _info.PackageId ?? "—";
    public string KindText => _info.Kind == InstalledModKind.Server ? "Server Mod" : "Client Plugin";
    public bool IsServer => _info.Kind == InstalledModKind.Server;
    public bool IsActive => !_info.IsDisabled;
    public string StatusText => _info.IsDisabled ? "Disabled" : "Active";
    public string InstalledVersionText => string.IsNullOrWhiteSpace(_info.Version) ? "version unknown" : $"v{_info.Version}";
    public string SourceText => _info.InfoSource;
    public bool IsDisabled => _info.IsDisabled;

    public string ToggleText => _info.IsDisabled ? "Enable" : "Disable";
    public bool IsEnabled => !_info.IsDisabled;
    public string RelativePathText => _info.InstallPath;

    /// <summary>STRICT update gate (the false-⬆-Update fix): the button/badge only appear when
    /// the outcome's remote version parses STRICTLY newer than the local one. The server's
    /// verdict alone is not trusted — equal, older or unparseable remotes never show an
    /// update, and a stale outcome falls away the moment Info refreshes with the new version.</summary>
    private bool StrictlyOutdated =>
        _outcome is { Status: UpdateStatus.UpdateAvailable } &&
        VersionUtils.IsNewer(_outcome.NewVersion, _info.Version);

    public bool HasUpdate => StrictlyOutdated;

    public bool CanUpdateNow => StrictlyOutdated && _outcome is { Link: not null };

    public string UpdateBadgeText => _outcome?.Status switch
    {
        UpdateStatus.UpdateAvailable => StrictlyOutdated ? $"Update available → v{_outcome!.NewVersion}" : "Up to date",
        UpdateStatus.UpToDate => "Up to date",
        UpdateStatus.Incompatible => string.IsNullOrWhiteSpace(_outcome!.NewVersion)
            ? "No version for this SPT"
            : $"Latest for this SPT → v{_outcome.NewVersion}",
        UpdateStatus.Blocked => $"Update blocked: {_outcome!.Reason ?? "see mod page"}",
        _ => string.Empty
    };

    /// <summary>Brush key for the update badge (resolved via DynamicResource-free lookup in XAML triggers).</summary>
    public string UpdateBadgeBrushKey => _outcome?.Status switch
    {
        UpdateStatus.UpdateAvailable => StrictlyOutdated ? "Warn" : "Green",
        UpdateStatus.UpToDate => "Green",
        UpdateStatus.Incompatible => "Danger",
        UpdateStatus.Blocked => "Danger",
        _ => "Muted"
    };

    public string VersionDetailText => _outcome is { Status: UpdateStatus.UpdateAvailable, NewVersion: not null } && StrictlyOutdated
        ? $"v{_info.Version ?? "?"} installed  →  v{_outcome.NewVersion} available"
        : InstalledVersionText;

    public bool IsBusy
    {
        get => _isBusy;
        set
        {
            if (SetProperty(ref _isBusy, value)) RaiseCommandStates();
        }
    }

    public bool HasDetailUrl => !string.IsNullOrWhiteSpace(_catalogMatch?.DetailUrl);

    internal void RaiseCommandStates()
    {
        ((RelayCommand)UpdateCommand).RaiseCanExecuteChanged();
        ((RelayCommand)ToggleCommand).RaiseCanExecuteChanged();
        ((RelayCommand)UninstallCommand).RaiseCanExecuteChanged();
    }

    private void OpenModPage()
    {
        string? url = _catalogMatch?.DetailUrl;
        if (string.IsNullOrWhiteSpace(url)) return;
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            Debug.WriteLine($"Could not open mod page: {ex.Message}");
        }
    }
}
