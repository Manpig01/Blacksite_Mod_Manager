using System.Collections.ObjectModel;
using System.IO;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using Blacksite.Models;
using Blacksite.Services;
using Blacksite.Views;
using Microsoft.Win32;

namespace Blacksite.ViewModels;

/// <summary>Root view-model: catalog browsing, installed-mod management, search, SPT settings,
/// status bar, and the install/update pipelines — all backed by live API calls and real disk operations.</summary>
public sealed class MainViewModel : ViewModelBase
{
    private static readonly SolidColorBrush GreenBrush = Freeze(new SolidColorBrush(Color.FromRgb(0x16, 0xa3, 0x4a)));
    private static readonly SolidColorBrush RedBrush = Freeze(new SolidColorBrush(Color.FromRgb(0xdc, 0x26, 0x26)));
    private static readonly SolidColorBrush GrayBrush = Freeze(new SolidColorBrush(Color.FromRgb(0x6b, 0x74, 0x80)));

    private readonly Dispatcher _dispatcher;
    private readonly SettingsService _settings;
    private readonly SpModApiClient _api;
    private readonly ImageCache _imageCache;
    private readonly InstallService _installer;
    private readonly InstalledModsService _installedService;
    private readonly LocalModScanner _scanner = new();
    private readonly SemaphoreSlim _installGate = new(1, 1); // guards 1-click UPDATES (catalog installs use the queue)
    private readonly InstallQueueEngine _installQueue;
    private readonly InstallQueueViewModel _queueViewModel;
    private readonly SemaphoreSlim _updateCheckGate = new(1, 1);
    private readonly DispatcherTimer _searchDebounce;
    private readonly DispatcherTimer _installedSearchDebounce;
    private readonly DispatcherTimer _healthTimer;

    private CancellationTokenSource? _refreshCts;
    private List<ModCardViewModel> _allCards = new();
    private List<InstalledModViewModel> _installedAll = new();
    private Dictionary<string, Mod> _catalogByGuid = new(StringComparer.OrdinalIgnoreCase);
    private Dictionary<string, Mod> _catalogBySlug = new(StringComparer.OrdinalIgnoreCase);
    private Dictionary<int, Mod> _catalogById = new();
    private bool _isScanning;
    private bool _suppressFilterReload;                 // while programmatically restoring filter selections
    private CatalogFilter? _lastStartedFilter;         // dedupes debounce ticks vs. already-loaded filters
    private int _activeRefreshes;

    public ObservableCollection<ModCardViewModel> Items { get; } = new();
    public ObservableCollection<ToastViewModel> Toasts { get; } = new();
    public ObservableCollection<InstalledModViewModel> InstalledItems { get; } = new();

    // ------------------------------------------------------------------ commands

    public ICommand SetDirectoryCommand { get; }
    public ICommand RefreshCommand { get; }
    public ICommand RescanCommand { get; }
    public ICommand CheckUpdatesCommand { get; }
    public ICommand ClearCatalogFiltersCommand { get; }
    public ICommand ClearInstalledFiltersCommand { get; }
    public ICommand OpenQueueWindowCommand { get; }
    public ICommand InstallLocalCommand { get; }
    public ICommand SaveSettingsCommand { get; }
    public ICommand LaunchSptCommand { get; }
    public ICommand PrevPageCommand { get; }
    public ICommand NextPageCommand { get; }
    public ICommand EnableAllCommand { get; }
    public ICommand DisableAllCommand { get; }
    public ICommand UninstallAllCommand { get; }
    public ICommand OpenClientFolderCommand { get; }
    public ICommand OpenServerFolderCommand { get; }
    public ICommand ClearCacheCommand { get; }
    public ICommand ClearTempFilesCommand { get; }
    public ICommand ClearLogFilesCommand { get; }

    /// <summary>Raised when the user asks to see the Installation Queue window (handled by MainWindow).</summary>
    public event Action? OpenQueueWindowRequested;
    public event Action<VersionSelectionViewModel>? VersionSelectionRequested;

    // ------------------------------------------------- filter dropdown option types

    /// <summary>Selectable entry of the SPT-version constraint dropdown (populated live from GET /spt/versions).</summary>
    public sealed record SptVersionOption(string? Version, string Display)
    {
        public static SptVersionOption Any { get; } = new(null, "Any SPT version");
        public override string ToString() => Display;
    }

    /// <summary>Selectable entry of the category dropdown (populated live from GET /mod-categories).</summary>
    public sealed record CategoryOption(int? Id, string Display)
    {
        public static CategoryOption All { get; } = new(null, "All categories");
        public override string ToString() => Display;
    }

    /// <summary>Selectable entry of the sort dropdown (real API sort= keys).</summary>
    public sealed record SortOption(CatalogSort Sort, string Display)
    {
        public override string ToString() => Display;
    }

    // ------------------------------------------------------------ bound properties

    private int _selectedTabIndex;
    public int SelectedTabIndex
    {
        get => _selectedTabIndex;
        set
        {
            if (SetProperty(ref _selectedTabIndex, value) && value == 1)
                _ = RescanInstalledAsync();
        }
    }

    private string _searchText = string.Empty;
    public string SearchText
    {
        get => _searchText;
        set
        {
            if (SetProperty(ref _searchText, value))
            {
                _searchDebounce.Stop();
                _searchDebounce.Start();
            }
        }
    }

    private string _installedSearchText = string.Empty;
    public string InstalledSearchText
    {
        get => _installedSearchText;
        set
        {
            if (SetProperty(ref _installedSearchText, value))
            {
                _installedSearchDebounce.Stop();
                _installedSearchDebounce.Start();
            }
        }
    }

    // ------------------------------------------------- catalog filter panel state

    /// <summary>All selectable SPT version constraints (live from GET /spt/versions), newest first.</summary>
    public ObservableCollection<SptVersionOption> SptVersionOptions { get; } = new() { SptVersionOption.Any };

    private SptVersionOption _selectedSptVersionOption = SptVersionOption.Any;
    public SptVersionOption SelectedSptVersionOption
    {
        get => _selectedSptVersionOption;
        set
        {
            if (SetProperty(ref _selectedSptVersionOption, value))
            {
                // Saved filter: the last used SPT version constraint persists between app launches.
                _settings.Settings.SptVersionFilter = value.Version;
                _settings.Save();
                OnPropertyChanged(nameof(IsCatalogFilterActive));
                TriggerCatalogReload();
            }
        }
    }

    /// <summary>All selectable mod categories (live from GET /mod-categories).</summary>
    public ObservableCollection<CategoryOption> CategoryOptions { get; } = new() { CategoryOption.All };

    private CategoryOption _selectedCategoryOption = CategoryOption.All;
    public CategoryOption SelectedCategoryOption
    {
        get => _selectedCategoryOption;
        set
        {
            if (SetProperty(ref _selectedCategoryOption, value))
            {
                OnPropertyChanged(nameof(IsCatalogFilterActive));
                TriggerCatalogReload();
            }
        }
    }

    /// <summary>All sort orders (real API sort= keys).</summary>
    public List<SortOption> SortOptions { get; } = new()
    {
        new SortOption(CatalogSort.MostDownloaded, "Most Downloaded"),
        new SortOption(CatalogSort.MostRecent, "Most Recent"),
        new SortOption(CatalogSort.NameAz, "Alphabetical (A–Z)"),
        new SortOption(CatalogSort.NameZa, "Alphabetical (Z–A)"),
        new SortOption(CatalogSort.MostEndorsed, "Most Endorsed"),
        new SortOption(CatalogSort.MostFavourited, "Most Favourited")
    };

    private SortOption _selectedSortOption = null!;
    public SortOption SelectedSortOption
    {
        get => _selectedSortOption;
        set
        {
            if (SetProperty(ref _selectedSortOption, value))
                TriggerCatalogReload();
        }
    }

    private bool _fikaOnly;
    public bool FikaOnly
    {
        get => _fikaOnly;
        set
        {
            if (SetProperty(ref _fikaOnly, value))
            {
                OnPropertyChanged(nameof(IsCatalogFilterActive));
                TriggerCatalogReload();
            }
        }
    }

    public bool IsCatalogFilterActive =>
        SelectedSptVersionOption.Version is not null ||
        SelectedCategoryOption.Id is not null ||
        FikaOnly ||
        !string.IsNullOrWhiteSpace(SearchText);

    private string _catalogCountText = "Loading catalog…";
    public string CatalogCountText { get => _catalogCountText; set => SetProperty(ref _catalogCountText, value); }

    // ---- Browse view (v0.0.8 style overhaul): client-side hide toggles + pagination ----
    private bool _hideFeatured;
    public bool HideFeatured { get => _hideFeatured; set { if (SetProperty(ref _hideFeatured, value)) { CurrentPage = 1; ApplyFilter(); } } }

    private bool _hideContainsAds;
    public bool HideContainsAds { get => _hideContainsAds; set { if (SetProperty(ref _hideContainsAds, value)) { CurrentPage = 1; ApplyFilter(); } } }

    private bool _hideContainsAi;
    public bool HideContainsAi { get => _hideContainsAi; set { if (SetProperty(ref _hideContainsAi, value)) { CurrentPage = 1; ApplyFilter(); } } }

    private bool _hideInstalledMods;
    public bool HideInstalledMods { get => _hideInstalledMods; set { if (SetProperty(ref _hideInstalledMods, value)) { CurrentPage = 1; ApplyFilter(); } } }

    public IReadOnlyList<int> PerPageOptions { get; } = new[] { 10, 18, 25, 50 };

    private int _perPage = 18;
    public int PerPage
    {
        get => _perPage;
        set { if (SetProperty(ref _perPage, value)) { CurrentPage = 1; ApplyFilter(); } }
    }

    private List<ModCardViewModel> _visibleCards = new();
    private int _currentPage = 1;
    public int CurrentPage
    {
        get => _currentPage;
        private set { if (SetProperty(ref _currentPage, Math.Max(1, value))) { OnPropertyChanged(nameof(PageText)); OnPropertyChanged(nameof(ShowingText)); RaisePageCommands(); } }
    }

    private int _totalPages = 1;
    public int TotalPages
    {
        get => _totalPages;
        private set { if (SetProperty(ref _totalPages, Math.Max(1, value))) { OnPropertyChanged(nameof(PageText)); OnPropertyChanged(nameof(ShowingText)); RaisePageCommands(); } }
    }

    public string PageText => $"Page {CurrentPage}/{TotalPages}";

    public string ShowingText => _visibleCards.Count == 0
        ? "Showing 0 of 0"
        : $"Showing {Math.Min(PerPage, _visibleCards.Count - (CurrentPage - 1) * PerPage):N0} of {_visibleCards.Count:N0}";

    /// <summary>Responsive card width — the Browse grid lays cards out in 2 columns; the window
    /// resize handler keeps this at (viewport − gaps) / 2.</summary>
    private double _cardWidth = 470;
    public double CardWidth { get => _cardWidth; set => SetProperty(ref _cardWidth, value); }

    /// <summary>Card width for the installed grid (keeps 3 columns; resized live).</summary>
    public double InstalledCardWidth { get => _installedCardWidth; set => SetProperty(ref _installedCardWidth, value); }
    private double _installedCardWidth = 420;

    private void RaisePageCommands()
    {
        ((RelayCommand)PrevPageCommand).RaiseCanExecuteChanged();
        ((RelayCommand)NextPageCommand).RaiseCanExecuteChanged();
    }

    /// <summary>The server-side query built from the current filter panel state.</summary>
    private CatalogFilter CurrentCatalogFilter => new()
    {
        SearchText = SearchText,
        SptVersion = SelectedSptVersionOption.Version,
        CategoryId = SelectedCategoryOption.Id,
        FikaOnly = FikaOnly,
        Sort = _selectedSortOption?.Sort ?? CatalogSort.MostDownloaded
    };

    // ------------------------------------------------- installed-mods filter state

    private bool _hideDisabledMods;
    public bool HideDisabledMods
    {
        get => _hideDisabledMods;
        set { if (SetProperty(ref _hideDisabledMods, value)) ApplyInstalledFilter(); }
    }

    private bool _hideOutdatedMods;
    public bool HideOutdatedMods
    {
        get => _hideOutdatedMods;
        set { if (SetProperty(ref _hideOutdatedMods, value)) ApplyInstalledFilter(); }
    }

    // ---- Installed view (v0.0.8 style overhaul): sort dropdown + updates-first ----
    public IReadOnlyList<string> InstalledSortModeOptions { get; } =
        new[] { "Alphabetical (A→Z)", "Alphabetical (Z→A)", "Type", "Update status" };

    private string _installedSortMode = "Alphabetical (A→Z)";
    public string InstalledSortMode
    {
        get => _installedSortMode;
        set
        {
            if (!SetProperty(ref _installedSortMode, value)) return;
            (_installedSortColumn, _installedSortDirection) = value switch
            {
                "Alphabetical (Z→A)" => (InstalledSortColumn.Name, SortDirection.Descending),
                "Type" => (InstalledSortColumn.Type, SortDirection.Ascending),
                "Update status" => (InstalledSortColumn.Status, SortDirection.Descending),
                _ => (InstalledSortColumn.Name, SortDirection.Ascending)
            };
            OnPropertyChanged(nameof(NameSortGlyph));
            OnPropertyChanged(nameof(TypeSortGlyph));
            OnPropertyChanged(nameof(StatusSortGlyph));
            OnPropertyChanged(nameof(VersionSortGlyph));
            ApplyInstalledFilter();
        }
    }

    private bool _updatesFirst = true;
    public bool UpdatesFirst
    {
        get => _updatesFirst;
        set { if (SetProperty(ref _updatesFirst, value)) ApplyInstalledFilter(); }
    }

    private bool _onlyServerMods;
    public bool OnlyServerMods
    {
        get => _onlyServerMods;
        set
        {
            if (SetProperty(ref _onlyServerMods, value))
            {
                if (value && _onlyClientMods) OnlyClientMods = false; // mutually exclusive
                ApplyInstalledFilter();
            }
        }
    }

    private bool _onlyClientMods;
    public bool OnlyClientMods
    {
        get => _onlyClientMods;
        set
        {
            if (SetProperty(ref _onlyClientMods, value))
            {
                if (value && _onlyServerMods) OnlyServerMods = false; // mutually exclusive
                ApplyInstalledFilter();
            }
        }
    }

    private InstalledSortColumn _installedSortColumn = InstalledSortColumn.Name;
    private SortDirection _installedSortDirection = SortDirection.Ascending;

    /// <summary>Column glyphs ("▲"/"▼"/"") for the clickable Installed-Mods grid headers.</summary>
    public string NameSortGlyph => SortGlyph(InstalledSortColumn.Name);
    public string TypeSortGlyph => SortGlyph(InstalledSortColumn.Type);
    public string StatusSortGlyph => SortGlyph(InstalledSortColumn.Status);
    public string VersionSortGlyph => SortGlyph(InstalledSortColumn.Version);

    private string SortGlyph(InstalledSortColumn column) =>
        _installedSortColumn != column ? string.Empty
        : _installedSortDirection == SortDirection.Ascending ? "▲"
        : "▼";

    /// <summary>Invoked by the grid header click handler — cycles the clicked column asc → desc → asc.</summary>
    public void CycleInstalledSort(string columnKey)
    {
        if (!Enum.TryParse<InstalledSortColumn>(columnKey, ignoreCase: true, out InstalledSortColumn column)) return;

        if (_installedSortColumn == column)
            _installedSortDirection = _installedSortDirection == SortDirection.Ascending ? SortDirection.Descending : SortDirection.Ascending;
        else
        {
            _installedSortColumn = column;
            _installedSortDirection = SortDirection.Ascending;
        }

        OnPropertyChanged(nameof(NameSortGlyph));
        OnPropertyChanged(nameof(TypeSortGlyph));
        OnPropertyChanged(nameof(StatusSortGlyph));
        OnPropertyChanged(nameof(VersionSortGlyph));
        ApplyInstalledFilter();
    }

    private string _sptDirectory = string.Empty;
    public string SptDirectory
    {
        get => _sptDirectory;
        set
        {
            if (SetProperty(ref _sptDirectory, value))
            {
                OnPropertyChanged(nameof(SptDirectoryDisplay));
                _settings.Settings.SptDirectory = string.IsNullOrWhiteSpace(value) ? null : value;
                _settings.Save();
                RefreshSettingsDerivedState();
            }
        }
    }

    public string SptDirectoryDisplay => string.IsNullOrWhiteSpace(_sptDirectory) ? "No SPT directory selected" : _sptDirectory;

    private string _sptVersion = string.Empty;
    public string SptVersion
    {
        get => _sptVersion;
        set
        {
            if (SetProperty(ref _sptVersion, value))
            {
                _settings.Settings.SptVersion = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
                _settings.Save();
            }
        }
    }

    private string _statusText = "Starting up…";
    public string StatusText { get => _statusText; set => SetProperty(ref _statusText, value); }

    private string _queueBadgeText = "0";
    public string QueueBadgeText { get => _queueBadgeText; set => SetProperty(ref _queueBadgeText, value); }

    private bool _queueBadgeVisible;
    public bool QueueBadgeVisible { get => _queueBadgeVisible; set => SetProperty(ref _queueBadgeVisible, value); }

    /// <summary>The view-model behind the Installation Queue window.</summary>
    public InstallQueueViewModel QueueViewModel => _queueViewModel;

    private string _speedText = string.Empty;
    public string SpeedText { get => _speedText; set => SetProperty(ref _speedText, value); }

    private double _progressPercent; // -1 → indeterminate
    public double ProgressPercent
    {
        get => _progressPercent;
        set
        {
            if (SetProperty(ref _progressPercent, value))
                OnPropertyChanged(nameof(IsProgressIndeterminate));
        }
    }

    public bool IsProgressIndeterminate => _progressPercent < 0;

    private string _apiHealthText = "API: checking…";
    public string ApiHealthText { get => _apiHealthText; set => SetProperty(ref _apiHealthText, value); }

    private Brush _apiHealthBrush = GrayBrush;
    public Brush ApiHealthBrush { get => _apiHealthBrush; set => SetProperty(ref _apiHealthBrush, value); }

    private bool _isRefreshing;
    public bool IsRefreshing
    {
        get => _isRefreshing;
        set
        {
            if (SetProperty(ref _isRefreshing, value))
            {
                OnPropertyChanged(nameof(RefreshButtonText));
                ((RelayCommand)RefreshCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public string RefreshButtonText => IsRefreshing ? "Loading…" : "Refresh Catalog";

    private bool _isInstallBusy;
    public bool IsInstallBusy
    {
        get => _isInstallBusy;
        set
        {
            if (SetProperty(ref _isInstallBusy, value))
            {
                foreach (var card in _allCards) card.RaiseInstallCanExecute();
                foreach (var row in _installedAll) row.RaiseCommandStates();
            }
        }
    }

    private int _resultCount;
    public int ResultCount
    {
        get => _resultCount;
        set
        {
            if (SetProperty(ref _resultCount, value))
                OnPropertyChanged(nameof(HasResults));
        }
    }

    public bool HasResults => _resultCount > 0;

    private string _emptyStateText = "Loading catalog…";
    public string EmptyStateText { get => _emptyStateText; set => SetProperty(ref _emptyStateText, value); }

    private string _installedTabHeader = "Installed Mods";
    public string InstalledTabHeader { get => _installedTabHeader; set => SetProperty(ref _installedTabHeader, value); }

    private string _installedSummaryText = string.Empty;
    public string InstalledSummaryText { get => _installedSummaryText; set => SetProperty(ref _installedSummaryText, value); }

    private bool _hasInstalledResults;
    public bool HasInstalledResults { get => _hasInstalledResults; set => SetProperty(ref _hasInstalledResults, value); }

    private string _installedEmptyText = "Set your SPT directory to scan installed mods.";
    public string InstalledEmptyText { get => _installedEmptyText; set => SetProperty(ref _installedEmptyText, value); }

    // ------------------------------------------------------------------ lifecycle

    public MainViewModel()
    {
        _dispatcher = Dispatcher.CurrentDispatcher;
        _settings = new SettingsService();
        _api = new SpModApiClient();
        _api.Notice += notice => _dispatcher.BeginInvoke(() => StatusText = notice);
        // Task 6.1, Fix D: configurable download stall watchdog (downloadStallTimeoutSeconds, default 60).
        _api.DownloadStallTimeout = TimeSpan.FromSeconds(Math.Max(10, _settings.Settings.DownloadStallTimeoutSeconds));
        _imageCache = new ImageCache(_api);
        _installer = new InstallService(_api, _settings);
        _installedService = new InstalledModsService(_api, _settings);
        _installQueue = new InstallQueueEngine(_installer);
        _queueViewModel = new InstallQueueViewModel(_installQueue, _imageCache);

        // Footer + card state follow the queue engine in real time.
        _installQueue.ItemUpdated += item =>
        {
            UpdateQueueBadge();
            ModCardViewModel? card = _allCards.FirstOrDefault(c => c.Mod.Id == item.ModId);
            if (card is not null)
            {
                card.IsQueued = item.State is InstallTaskState.Queued;
                card.IsInstalling = item.State is InstallTaskState.Downloading or InstallTaskState.Extracting;
            }
        };
        _installQueue.Progress += (item, p) =>
        {
            StatusText = p.StatusText;
            ProgressPercent = p.Percent;
            SpeedText = p.SpeedText ?? string.Empty;
        };
        _installQueue.TaskFinished += (item, result) =>
        {
            UpdateQueueBadge();
            ModCardViewModel? card = _allCards.FirstOrDefault(c => c.Mod.Id == item.ModId);
            if (card is not null)
            {
                card.IsQueued = false;
                card.IsInstalling = false;
                if (result.Success) card.InstalledVersion = result.InstalledVersion;
            }
            if (result.Success)
            {
                ProgressPercent = 100;
                SpeedText = string.Empty;
                StatusText = $"Installation complete — {item.ModName} v{result.InstalledVersion}.";
                _ = RescanInstalledAsync(); // Installed Mods tab refreshes its scan index automatically
            }
            else
            {
                ProgressPercent = 0;
                SpeedText = string.Empty;
                StatusText = $"Install failed: {result.Message}";
                if (!result.Message.Contains("cancelled", StringComparison.OrdinalIgnoreCase))
                    MessageDialog.Show("Installation failed",
                        $"“{item.ModName}” could not be installed.\n\n{result.Message}", isError: true);
            }
        };

        SetDirectoryCommand = new RelayCommand(SetDirectory);
        RefreshCommand = new RelayCommand(async () => await RefreshCatalogAsync(), () => !IsRefreshing);
        RescanCommand = new RelayCommand(async () => await RescanInstalledAsync());
        CheckUpdatesCommand = new RelayCommand(async () => await CheckForUpdatesAsync(silent: false));
        ClearCatalogFiltersCommand = new RelayCommand(ClearCatalogFilters);
        ClearInstalledFiltersCommand = new RelayCommand(ClearInstalledFilters);
        OpenQueueWindowCommand = new RelayCommand(() => OpenQueueWindowRequested?.Invoke());
        InstallLocalCommand = new RelayCommand(InstallLocalArchives);
        SaveSettingsCommand = new RelayCommand(() => _ = SaveSettingsAsync());
        LaunchSptCommand = new RelayCommand(() => _ = LaunchSptAsync(), () => !_sptLaunchInProgress);
        PrevPageCommand = new RelayCommand(() => { if (CurrentPage > 1) { CurrentPage--; ApplyFilter(); } }, () => CurrentPage > 1);
        NextPageCommand = new RelayCommand(() => { if (CurrentPage < TotalPages) { CurrentPage++; ApplyFilter(); } }, () => CurrentPage < TotalPages);
        EnableAllCommand = new RelayCommand(() => _ = SetAllModsEnabledAsync(enable: true));
        DisableAllCommand = new RelayCommand(() => _ = SetAllModsEnabledAsync(enable: false));
        UninstallAllCommand = new RelayCommand(() => _ = UninstallAllModsAsync());
        OpenClientFolderCommand = new RelayCommand(() => OpenModFolder(_settings.ClientModPathEffective));
        OpenServerFolderCommand = new RelayCommand(() => OpenModFolder(_settings.ServerModPathEffective));
        ClearCacheCommand = new RelayCommand(() => _ = ClearCacheAsync());
        ClearTempFilesCommand = new RelayCommand(() => _ = ClearTempFilesAsync());
        ClearLogFilesCommand = new RelayCommand(() => _ = ClearLogFilesAsync());

        _selectedSortOption = SortOptions[0];

        _searchDebounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
        _searchDebounce.Tick += (_, _) =>
        {
            _searchDebounce.Stop();
            // Real-time text search → server-side query parameter (GET /mods?query=…).
            TriggerCatalogReload();
        };

        _installedSearchDebounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
        _installedSearchDebounce.Tick += (_, _) => { _installedSearchDebounce.Stop(); ApplyInstalledFilter(); };

        _healthTimer = new DispatcherTimer { Interval = TimeSpan.FromMinutes(5) };
        _healthTimer.Tick += async (_, _) => await CheckApiHealthAsync();
        _healthTimer.Start();

        _sptDirectory = _settings.Settings.SptDirectory ?? string.Empty;
        _settingsClientModPath = _settings.Settings.ClientModPath is null
            ? SettingsService.DefaultClientModPath : _settings.ClientModPathEffective;
        _settingsServerModPath = _settings.Settings.ServerModPath is null
            ? SettingsService.DefaultServerModPath : _settings.ServerModPathEffective;
        _sptVersion = _settings.Settings.SptVersion ?? string.Empty;
    }

    public async Task InitializeAsync()
    {
        await Task.Run(() => InstallService.SweepStaleTempFiles()); // clean up crashed runs' temp artifacts
        await CheckApiHealthAsync();
        await LoadFilterTaxonomiesAsync();
        await RefreshCatalogAsync();
        MigrateLegacyLayoutIfNeeded();
        await RescanInstalledAsync();
        await CheckForUpdatesAsync(silent: true);
    }

    // ------------------------------------------------------- filter taxonomies

    /// <summary>
    /// Populates the SPT-version and category dropdowns from the live API
    /// (GET /spt/versions and GET /mod-categories), then restores the persisted
    /// SPT version constraint from the local application settings.
    /// </summary>
    private async Task LoadFilterTaxonomiesAsync()
    {
        try
        {
            Task<List<SptVersionInfo>> versionsTask = _api.GetSptVersionsAsync(CancellationToken.None);
            Task<List<ModCategoryInfo>> categoriesTask = _api.GetCategoriesAsync(CancellationToken.None);
            List<SptVersionInfo> versions = await versionsTask.ConfigureAwait(true);
            List<ModCategoryInfo> categories = await categoriesTask.ConfigureAwait(true);

            _suppressFilterReload = true;
            try
            {
                SptVersionOptions.Clear();
                SptVersionOptions.Add(SptVersionOption.Any);
                foreach (SptVersionInfo v in versions
                             .Where(v => SemVersion.TryParse(v.Version, out _))
                             .OrderByDescending(v => SemVersion.TryParse(v.Version, out var sv) ? sv : null))
                    SptVersionOptions.Add(new SptVersionOption(v.Version, v.Display));

                CategoryOptions.Clear();
                CategoryOptions.Add(CategoryOption.All);
                foreach (ModCategoryInfo c in categories.OrderBy(c => c.Title, StringComparer.OrdinalIgnoreCase))
                    CategoryOptions.Add(new CategoryOption(c.Id, string.IsNullOrWhiteSpace(c.Description) ? c.Title : c.Title));

                // Restore the saved SPT version constraint (falls back to "Any" when it no longer exists).
                string? savedConstraint = _settings.Settings.SptVersionFilter;
                SelectedSptVersionOption = SptVersionOptions.FirstOrDefault(o => o.Version == savedConstraint) ?? SptVersionOption.Any;
                SelectedCategoryOption = CategoryOption.All;
            }
            finally
            {
                _suppressFilterReload = false;
            }

            StatusText = $"Filter lists loaded — {SptVersionOptions.Count - 1} SPT versions, {CategoryOptions.Count - 1} categories.";
        }
        catch (Exception ex)
        {
            StatusText = $"Could not load SPT versions / categories: {ex.Message}";
        }
    }

    /// <summary>Restarts the catalog query (deduped against the filter that is already being loaded).</summary>
    private void TriggerCatalogReload()
    {
        if (_suppressFilterReload) return;
        CatalogFilter filter = CurrentCatalogFilter;
        if (filter.Equals(_lastStartedFilter)) return;
        _ = RefreshCatalogAsync();
    }

    /// <summary>Resets every catalog filter and sort parameter back to its default state.</summary>
    private void ClearCatalogFilters()
    {
        _suppressFilterReload = true;
        try
        {
            SearchText = string.Empty;
            SelectedSptVersionOption = SptVersionOption.Any;
            SelectedCategoryOption = CategoryOption.All;
            FikaOnly = false;
            SelectedSortOption = SortOptions[0];
            OnPropertyChanged(nameof(IsCatalogFilterActive));
        }
        finally
        {
            _suppressFilterReload = false;
        }
        _lastStartedFilter = null; // force a reload even if the previous query was already the default
        _ = RefreshCatalogAsync();
    }

    /// <summary>Resets the installed-mods filter bar, toggles and column sorting to their defaults.</summary>
    private void ClearInstalledFilters()
    {
        _suppressFilterReload = true;
        try { InstalledSearchText = string.Empty; }
        finally { _suppressFilterReload = false; }
        HideDisabledMods = false;
        HideOutdatedMods = false;
        OnlyServerMods = false;
        OnlyClientMods = false;
        _installedSortColumn = InstalledSortColumn.Name;
        _installedSortDirection = SortDirection.Ascending;
        OnPropertyChanged(nameof(NameSortGlyph));
        OnPropertyChanged(nameof(TypeSortGlyph));
        OnPropertyChanged(nameof(StatusSortGlyph));
        OnPropertyChanged(nameof(VersionSortGlyph));
        ApplyInstalledFilter();
        StatusText = "Installed-mods filters cleared.";
    }

    public void Shutdown()
    {
        _settings.Save();
        _installQueue.Dispose();
    }

    // ------------------------------------------------------------------ health

    private async Task CheckApiHealthAsync()
    {
        ApiHealthBrush = GrayBrush;
        ApiHealthText = "API: checking…";
        var (online, detail) = await _api.PingAsync(CancellationToken.None);
        ApiHealthBrush = online ? GreenBrush : RedBrush;
        ApiHealthText = online ? $"API {detail}" : $"API {detail}";
    }

    // ------------------------------------------------------------------ catalog

    private async Task RefreshCatalogAsync()
    {
        CatalogFilter filter = CurrentCatalogFilter;
        _lastStartedFilter = filter;

        _refreshCts?.Cancel();
        _refreshCts = new CancellationTokenSource();
        CancellationToken ct = _refreshCts.Token;

        System.Threading.Interlocked.Increment(ref _activeRefreshes);
        IsRefreshing = true;
        ProgressPercent = -1;
        SpeedText = string.Empty;

        try
        {
            string scope = DescribeFilter(filter);
            StatusText = string.IsNullOrWhiteSpace(scope)
                ? "Loading full catalog from sp-mod.com…"
                : $"Loading catalog — {scope}…";
            var progress = new Progress<CatalogProgress>(p =>
                StatusText = $"Loading catalog{(string.IsNullOrWhiteSpace(scope) ? "" : $" — {scope}")} — page {p.Page}/{p.LastPage} ({p.ModsLoaded:N0} mods)…");

            // Every active filter becomes a real query parameter: query=…, filter[spt_version]=…,
            // filter[category_id]=…, filter[fika_compatibility]=1 and sort=…
            List<Mod> mods = await _api.GetCatalogAsync(filter, progress, ct);

            RebuildCards(mods);
            ApplyFilter();
            EnrichInstalledRows();

            ResultCount = mods.Count;
            CatalogCountText = mods.Count == 0
                ? "0 mods"
                : $"{mods.Count:N0} mod{(mods.Count == 1 ? "" : "s")}{(string.IsNullOrWhiteSpace(scope) ? "" : $" · {scope}")}";
            EmptyStateText = _allCards.Count == 0
                ? "Catalog is empty — click “Refresh Catalog” to load mods from sp-mod.com."
                : "No mods match the current filters.\nClear the filter panel or try a different search.";

            StatusText = string.IsNullOrWhiteSpace(scope)
                ? $"Catalog loaded — {mods.Count:N0} mods. Ready."
                : $"Catalog loaded — {mods.Count:N0} mods · {scope}.";
            ProgressPercent = 0;
            ApiHealthBrush = GreenBrush;
            ApiHealthText = $"API online · {mods.Count:N0} mods";
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer filter selection or app shutdown — the newer query reports status.
            ProgressPercent = 0;
        }
        catch (Exception ex)
        {
            StatusText = $"Catalog load failed: {ex.Message}";
            CatalogCountText = "catalog unavailable";
            ProgressPercent = 0;
            ApiHealthBrush = RedBrush;
            ApiHealthText = "API error";
            MessageDialog.Show("Catalog load failed",
                $"The mod catalog could not be loaded from https://sp-mod.com/api/v0/mods.\n\n{ex.Message}\n\nCheck your internet connection and try “Refresh Catalog” again.",
                isError: true);
        }
        finally
        {
            if (System.Threading.Interlocked.Decrement(ref _activeRefreshes) == 0)
                IsRefreshing = false;
        }
    }

    /// <summary>Short human summary of the active server-side constraints, e.g. "SPT 3.11.4 · Weapons · Fika".</summary>
    private string DescribeFilter(CatalogFilter filter)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(filter.SearchText)) parts.Add($"search “{filter.SearchText.Trim()}”");
        if (!string.IsNullOrWhiteSpace(filter.SptVersion)) parts.Add($"SPT {filter.SptVersion}");
        if (filter.CategoryId is int catId)
        {
            string? title = CategoryOptions.FirstOrDefault(o => o.Id == catId)?.Display;
            parts.Add(title ?? $"category {catId}");
        }
        if (filter.FikaOnly) parts.Add("Fika-compatible");
        return string.Join(" · ", parts);
    }

    private void RebuildCards(List<Mod> mods)
    {
        _catalogByGuid = new Dictionary<string, Mod>(StringComparer.OrdinalIgnoreCase);
        _catalogBySlug = new Dictionary<string, Mod>(StringComparer.OrdinalIgnoreCase);
        _catalogById = new Dictionary<int, Mod>();
        foreach (Mod mod in mods)
        {
            if (!string.IsNullOrWhiteSpace(mod.Guid)) _catalogByGuid.TryAdd(mod.Guid!, mod);
            if (!string.IsNullOrWhiteSpace(mod.Slug)) _catalogBySlug.TryAdd(mod.Slug!, mod);
            _catalogById[mod.Id] = mod;
        }

        var existing = _allCards.ToDictionary(c => c.Mod.Id);
        var cards = new List<ModCardViewModel>(mods.Count);

        // Preserve the server's ordering — it already applied the requested sort= parameter.
        foreach (Mod mod in mods)
        {
            if (existing.TryGetValue(mod.Id, out var card))
            {
                cards.Add(card); // keeps loaded thumbnails & install state
                continue;
            }
            var fresh = new ModCardViewModel(mod, _imageCache, RequestInstallAsync, () => true, OpenVersionSelection, _api);
            if (_settings.Settings.InstalledMods.TryGetValue(mod.Id, out InstalledModRecord? record))
                fresh.InstalledVersion = record.Version;
            cards.Add(fresh);
        }

        _allCards = cards;
    }

    /// <summary>Republishes the loaded catalog into the cards panel (the filtering itself is server-side).</summary>
    private void ApplyFilter()
    {
        // Client-side hide toggles over the server-filtered catalog page data.
        IEnumerable<ModCardViewModel> visible = _allCards;
        if (HideFeatured) visible = visible.Where(c => !c.Mod.Featured);
        if (HideContainsAds) visible = visible.Where(c => !c.Mod.ContainsAds);
        if (HideContainsAi) visible = visible.Where(c => !c.Mod.ContainsAiContent);
        if (HideInstalledMods) visible = visible.Where(c => !c.IsInstalled);
        _visibleCards = visible.ToList();

        // Client-side pagination over the visible cards.
        TotalPages = Math.Max(1, (int)Math.Ceiling(_visibleCards.Count / (double)PerPage));
        if (CurrentPage > TotalPages) CurrentPage = TotalPages;

        Items.Clear();
        foreach (ModCardViewModel card in _visibleCards.Skip((CurrentPage - 1) * PerPage).Take(PerPage))
            Items.Add(card);

        ResultCount = _visibleCards.Count;
        OnPropertyChanged(nameof(IsCatalogFilterActive));
        OnPropertyChanged(nameof(PageText));
        OnPropertyChanged(nameof(ShowingText));
        RaisePageCommands();
    }


    // ------------------------------------------------------------------ directory

    private void SetDirectory()
    {
        var dialog = new OpenFolderDialog
        {
            Title = "Select your Single Player Tarkov root folder",
            Multiselect = false
        };

        if (!string.IsNullOrWhiteSpace(SptDirectory) && Directory.Exists(SptDirectory))
            dialog.InitialDirectory = SptDirectory;

        if (dialog.ShowDialog() != true) return;

        string dir = dialog.FolderName;
        if (!InstallService.DirectoryLooksLikeSptRoot(dir))
        {
            bool useAnyway = MessageDialog.Confirm("Unrecognized folder",
                $"“{dir}” does not look like a Single Player Tarkov root folder — no BepInEx, user, SPT_Data folder or EscapeFromTarkov.exe was found.\n\nMods are extracted into this folder exactly as packaged (typically BepInEx\\plugins and user\\mods). Use it anyway?");
            if (!useAnyway) return;
        }

        SptDirectory = dir;

        string? detected = InstallService.TryDetectSptVersion(dir);
        if (detected is not null)
        {
            SptVersion = detected;
            StatusText = $"SPT directory set — detected SPT version {detected}. Scanning installed mods…";
        }
        else
        {
            StatusText = string.IsNullOrWhiteSpace(SptVersion)
                ? "SPT directory set — could not auto-detect the SPT version, please type it in the “SPT Version” box."
                : $"SPT directory set (SPT version {SptVersion}). Scanning installed mods…";
        }

        _ = OnSptDirectoryReadyAsync();
    }

    private async Task OnSptDirectoryReadyAsync()
    {
        MigrateLegacyLayoutIfNeeded();
        await RescanInstalledAsync();
        await CheckForUpdatesAsync(silent: true);
    }

    /// <summary>
    /// SPT 4.x layout fix: earlier builds installed into the classic root\user\mods and
    /// root\BepInEx\plugins; on SPT 4.1+ (SPT_Runtime) that content sits where the game never
    /// loads it, and game-data overlays can end up inside user\mods. Offers a one-time move
    /// into the correct locations, then lets the caller rescan.
    /// </summary>
    private void MigrateLegacyLayoutIfNeeded()
    {
        try
        {
            string root = SptDirectory;
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) return;
            string? runtime = SettingsService.FindRuntimeFolderName(root);
            if (runtime is null || !SptLayoutMigrator.HasLegacyContent(root)) return;

            string legacyMods = Path.Combine(root, "user", "mods");

            bool go = MessageDialog.Confirm("Move server mods into the SPT 4.x layout?",
                "SPT 4.1 keeps server mods inside the \u201CSPT_Runtime\u201D folder.\r\n\r\n" +
                "The manager found server mods installed in the old location:\r\n" +
                "  " + legacyMods + "\r\n\r\n" +
                $"Move them into {runtime}\\user\\mods now? (BepInEx\\plugins stays at the install root.)\r\n" +
                $"(A stray EscapeFromTarkov_Data overlay inside user\\mods is merged into {Path.Combine(root, "EscapeFromTarkov_Data")}.)");
            if (!go) return;

            SptLayoutMigrator.MigrationResult result = SptLayoutMigrator.Migrate(root, runtime);
            StatusText = $"SPT 4.x layout: moved {result.ItemsMoved} server mod(s) into {runtime}\\user\\mods, " +
                         $"merged {result.DataFilesMerged} game-data file(s) into EscapeFromTarkov_Data" +
                         (result.ItemsSkippedExisting > 0 ? $" ({result.ItemsSkippedExisting} already existed and were left alone)" : string.Empty) + ".";
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            StatusText = $"Layout migration failed: {ex.Message}";
        }
    }

    // ------------------------------------------------------------------ install (catalog)

    public string? EffectiveSptVersion =>
        !string.IsNullOrWhiteSpace(SptVersion) && SemVersion.TryParse(SptVersion, out _) ? SptVersion.Trim() : null;

    /// <summary>
    /// Catalog installs flow into the multi-task Installation Queue: clicking Install on several
    /// mods back-to-back pushes them into a Channel-based queue processed by a semaphore-gated
    /// consumer — the UI never blocks and every task streams live progress into the queue window.
    /// </summary>
    private void RequestInstallAsync(ModCardViewModel card)
    {
        if (string.IsNullOrWhiteSpace(SptDirectory) || !Directory.Exists(SptDirectory))
        {
            MessageDialog.Show("SPT directory not set",
                "Select your Single Player Tarkov root folder first (button “Set SPT Directory”, top left).\n\nThat is the folder containing BepInEx, user and EscapeFromTarkov.exe.",
                isError: true);
            return;
        }

        if (_installQueue.ContainsMod(card.Mod.Id))
        {
            StatusText = $"“{card.Name}” is already queued or installing — watch it in the Installation Queue.";
            return;
        }

        _ = InstallLatestFlowAsync(card.Mod, () => card.IsQueued = true);
    }

    /// <summary>
    /// Main "Install" path: resolves the best release live, runs the real dependency resolution
    /// BEFORE queueing (resolver dialog on the UI thread), queues dependencies first when chosen,
    /// then the mod itself — with a toast for every item added to the queue.
    /// </summary>
    private async Task InstallLatestFlowAsync(Mod mod, Action? onQueued)
    {
        try
        {
            StatusText = $"Resolving the latest release for “{mod.DisplayName}”…";
            List<ModVersion> versions = await _api.GetVersionsAsync(mod.Id, CancellationToken.None);
            VersionSelector.Selection? selection = VersionSelector.PickBest(versions, EffectiveSptVersion);
            if (selection is null)
            {
                StatusText = $"“{mod.DisplayName}” has no downloadable release.";
                return;
            }

            await InstallVersionFlowAsync(mod, selection.Version, onQueued);
        }
        catch (Exception ex)
        {
            StatusText = $"Could not queue “{mod.DisplayName}”: {ex.Message}";
        }
    }

    /// <summary>
    /// Shared install flow for both entry points (main card = latest; version modal = picked release):
    /// real dependency resolution → resolver dialog if anything is missing → dependencies queued
    /// FIRST, then the requested mod. Toasts fire for every enqueued item.
    /// </summary>
    private async Task InstallVersionFlowAsync(Mod mod, ModVersion target, Action? onQueued)
    {
        if (_installQueue.ContainsMod(mod.Id))
        {
            StatusText = $"“{mod.DisplayName}” is already queued or installing.";
            return;
        }

        StatusText = $"Checking dependencies for {mod.DisplayName} {target.Version}…";
        DependencyResolution resolution = await _installer.ResolveDependenciesAsync(
            mod, target, SptDirectory, EffectiveSptVersion, CancellationToken.None);

        if (resolution.NeedsPrompt)
        {
            DependencyPromptResult decision = await ShowDependencyPromptAsync(resolution.Prompt);
            if (decision == DependencyPromptResult.Cancel)
            {
                StatusText = $"Cancelled — “{mod.DisplayName}” {target.Version} was not queued.";
                return;
            }

            if (decision == DependencyPromptResult.InstallWithDeps)
            {
                // Task 6.3: each dependency enters the queue as its OWN item (own card, progress,
                // cancel and retry). EnqueueResolvedIfAbsent is atomic — a shared dependency
                // (CommonLib, BigBrain, …) already queued or installing is never enqueued twice.
                foreach (InstallService.ResolvedDependency dep in resolution.InstallQueue)
                {
                    if (_installQueue.EnqueueResolvedIfAbsent(dep, SptDirectory) is { } depCard)
                        ShowQueuedToast(dep.Name);
                }
            }
        }

        _installQueue.EnqueueVersion(mod, target, SptDirectory, EffectiveSptVersion);
        ShowQueuedToast(mod.DisplayName);
        onQueued?.Invoke();
        UpdateQueueBadge();
        StatusText = $"Queued {mod.DisplayName} {target.Version} — {DescribeQueueCounters()}.";
    }

    /// <summary>Opens the version selection modal (live GET /mod/&#123;id&#125;/versions) for a catalog card.</summary>
    private void OpenVersionSelection(ModCardViewModel card)
    {
        var vm = new VersionSelectionViewModel(
            card.Mod, _api, versionCard => _ = InstallVersionFlowAsync(card.Mod, versionCard.Version, () => versionCard.IsQueued = true));
        VersionSelectionRequested?.Invoke(vm);
    }

    // -------------------------------------------------- conflict detection & config editor

    /// <summary>
    /// Background conflict &amp; duplicate scan that runs right after the installed-mods scan:
    /// duplicate client .dll filenames across subfolders + duplicate server package IDs.
    /// Results land as yellow warning badges on the affected Installed Mods cards.
    /// </summary>
    private async Task RunConflictDetectionAsync()
    {
        string root = SptDirectory;
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) return;

        List<Services.ModConflict> conflicts;
        try
        {
            conflicts = await Task.Run(() => Services.ConflictDetector.Detect(root));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return; // best-effort — never break the scan flow
        }

        _ = _dispatcher.BeginInvoke(() =>
        {
            if (!string.Equals(SptDirectory, root, StringComparison.OrdinalIgnoreCase)) return; // folder changed mid-scan

            int affected = 0;
            foreach (InstalledModViewModel row in _installedAll)
            {
                IReadOnlyList<Services.ModConflict> mine = Services.ConflictDetector.ForPath(conflicts, row.Info.InstallPath);
                row.Conflicts = mine;
                if (mine.Count > 0) affected++;
            }

            if (conflicts.Count > 0)
                StatusText = $"Scan complete — ⚠ {conflicts.Count} conflict{(conflicts.Count == 1 ? "" : "s")} detected on {affected} mod{(affected == 1 ? "" : "s")} (yellow badge on each card).";
        });
    }

    /// <summary>"Edit Configs" on an installed mod: opens the in-app config editor modal.</summary>
    private void EditModConfigs(InstalledModViewModel row)
    {
        string modPath = row.Info.IsDirectory ? row.Info.InstallPath
            : Path.GetDirectoryName(row.Info.InstallPath)!;
        var vm = new ConfigEditorViewModel(row.DisplayName, modPath);
        var window = new Views.ConfigEditorWindow(vm) { Owner = Application.Current.MainWindow };
        window.ShowDialog();
    }

    /// <summary>Clicking a conflict badge: MessageBox-style dialog with the exact conflicting files.</summary>
    private void ShowConflictDetails(InstalledModViewModel row)
    {
        var lines = new List<string>();
        foreach (Services.ModConflict conflict in row.Conflicts)
        {
            lines.Add($"{conflict.KindText} conflict — {conflict.Summary}");
            lines.AddRange(conflict.Files.Select(f => $"    • {f}"));
            lines.Add(string.Empty);
        }
        MessageDialog.Show("Conflicts detected",
            $"“{row.DisplayName}” is involved in {row.Conflicts.Count} conflict{(row.Conflicts.Count == 1 ? "" : "s")}:{Environment.NewLine}{Environment.NewLine}" +
            string.Join(Environment.NewLine, lines).TrimEnd(),
            isError: true);
    }

    // -------------------------------------------------- integrated SPT launcher

    private bool _sptLaunchInProgress;

    /// <summary>
    /// "Launch SPT": starts the real server process (SPT.Server.exe / Aki.Server.exe) with
    /// redirected console output, watches for the ready phrase, then automatically starts the
    /// game launcher (SPT.Launcher.exe / Aki.Launcher.exe).
    /// </summary>
    private async Task LaunchSptAsync()
    {
        if (string.IsNullOrWhiteSpace(SptDirectory) || !Directory.Exists(SptDirectory))
        {
            MessageDialog.Show("SPT directory not set",
                "Select your Single Player Tarkov root folder first (button “Set SPT Directory”, top left).",
                isError: true);
            return;
        }

        string? serverExe = Services.SptLauncher.FindServerExe(SptDirectory);
        if (serverExe is null)
        {
            MessageDialog.Show("Server executable not found",
                $"Neither SPT.Server.exe nor Aki.Server.exe was found in:{Environment.NewLine}{SptDirectory}{Environment.NewLine}{Environment.NewLine}Check that this is your SPT root folder.",
                isError: true);
            return;
        }

        string? launcherExe = Services.SptLauncher.FindLauncherExe(SptDirectory);
        if (launcherExe is null)
        {
            MessageDialog.Show("Launcher executable not found",
                $"Neither SPT.Launcher.exe nor Aki.Launcher.exe was found in:{Environment.NewLine}{SptDirectory}{Environment.NewLine}{Environment.NewLine}The server was NOT started.",
                isError: true);
            return;
        }

        if (_sptLaunchInProgress) return;
        _sptLaunchInProgress = true;
        ((RelayCommand)LaunchSptCommand).RaiseCanExecuteChanged();

        try
        {
            var progress = new Progress<string>(line =>
            {
                // Live console stream into the footer (truncated to keep the status bar readable).
                StatusText = line.Length > 160 ? line[..157] + "…" : line;
            });

            StatusText = $"Starting {Path.GetFileName(serverExe)}…";
            ShowQueuedToast("Launching SPT", $"Starting {Path.GetFileName(serverExe)} — watching the server console…");

            Services.SptLaunchResult result = await Task.Run(() =>
                Services.SptLauncher.LaunchAsync(serverExe!, launcherExe!, progress, cancellationToken: CancellationToken.None));

            if (result.Success)
            {
                StatusText = "SPT server ready — game launcher started. Have fun!";
                ShowQueuedToast("SPT is ready", "The game launcher has been started — pick your profile and raid.");
            }
            else
            {
                StatusText = "SPT launch failed — see the dialog for details.";
                MessageDialog.Show("SPT launch failed", result.Message, isError: true);
            }
        }
        finally
        {
            _sptLaunchInProgress = false;
            ((RelayCommand)LaunchSptCommand).RaiseCanExecuteChanged();
        }
    }

    // ------------------------------------------------------------------ settings tab

    private string _settingsClientModPath = SettingsService.DefaultClientModPath;
    public string SettingsClientModPath
    {
        get => _settingsClientModPath;
        set { if (SetProperty(ref _settingsClientModPath, value)) OnPropertyChanged(nameof(SettingsPreviewClientPath)); }
    }

    private string _settingsServerModPath = SettingsService.DefaultServerModPath;
    public string SettingsServerModPath
    {
        get => _settingsServerModPath;
        set { if (SetProperty(ref _settingsServerModPath, value)) OnPropertyChanged(nameof(SettingsPreviewServerPath)); }
    }

    /// <summary>Read-only detection badge: "Detected SPT 4.1.5" (parsed from package.json /
    /// SPT.Server.exe / Aki.Server.exe / SPT DLL version resources in the selected folder).</summary>
    public string SettingsSptVersionBadge
    {
        get
        {
            if (string.IsNullOrWhiteSpace(SptDirectory) || !Directory.Exists(SptDirectory))
                return "No SPT folder selected";
            string? detected = InstallService.TryDetectSptVersion(SptDirectory);
            return detected is null ? "SPT version not detected" : $"Detected SPT {detected}";
        }
    }

    public string SettingsPreviewClientPath => PreviewPath(SettingsClientModPath, SettingsService.DefaultClientModPath);
    public string SettingsPreviewServerPath => PreviewPath(SettingsServerModPath, SettingsService.DefaultServerModPath);

    private string PreviewPath(string configured, string fallback)
    {
        string root = string.IsNullOrWhiteSpace(SptDirectory) ? "[SPT_Root]" : SptDirectory.TrimEnd('\\', '/');
        // Effective subpath — includes the SPT 4.x runtime prefix when that layout is detected.
        string sub = fallback == SettingsService.DefaultServerModPath
            ? _settings.EffectiveServerSubpath(configured)
            : _settings.EffectiveClientSubpath(configured);
        return root + "\\" + sub.Replace('/', '\\');
    }

    private void RefreshSettingsDerivedState()
    {
        OnPropertyChanged(nameof(SettingsSptVersionBadge));
        OnPropertyChanged(nameof(SettingsPreviewClientPath));
        OnPropertyChanged(nameof(SettingsPreviewServerPath));
    }

    /// <summary>Saves the configured mod paths persistently (settings.json) and applies them to the
    /// extraction engine + installed-mods scanner immediately.</summary>
    private async Task SaveSettingsAsync()
    {
        _settings.Settings.ClientModPath = string.IsNullOrWhiteSpace(SettingsClientModPath) ? null : SettingsClientModPath.Trim();
        _settings.Settings.ServerModPath = string.IsNullOrWhiteSpace(SettingsServerModPath) ? null : SettingsServerModPath.Trim();
        _settings.Save();

        // Reflect normalization + re-scan with the (possibly new) paths.
        SettingsClientModPath = _settings.ClientModPathEffective;
        SettingsServerModPath = _settings.ServerModPathEffective;
        RefreshSettingsDerivedState();

        string server = _settings.ServerModPathEffective;
        string client = _settings.ClientModPathEffective;
        bool customized = !string.Equals(server, SettingsService.DefaultServerModPath, StringComparison.OrdinalIgnoreCase)
                       || !string.Equals(client, SettingsService.DefaultClientModPath, StringComparison.OrdinalIgnoreCase);

        await RescanInstalledAsync().ConfigureAwait(false);
        _dispatcher.Invoke(() =>
        {
            StatusText = customized
                ? $"Settings saved — mods install to {client} and {server}."
                : "Settings saved.";
            ShowQueuedToast("Settings saved", customized
                ? $"Mods will install into {client} and {server}."
                : "Using default mod folder paths.");
        });
    }

    /// <summary>Clear Cache: purges in-memory + on-disk cached API data (thumbnails).</summary>
    private async Task ClearCacheAsync()
    {
        var (files, bytes) = await Task.Run(() => _imageCache.ClearAll()).ConfigureAwait(false);
        _dispatcher.Invoke(() =>
        {
            StatusText = $"Cache cleared — {files} file{(files == 1 ? "" : "s")}, {bytes / 1024.0 / 1024.0:F1} MB freed.";
            ShowQueuedToast("Cache cleared", $"{files} cached file{(files == 1 ? "" : "s")} purged ({bytes / 1024.0 / 1024.0:F1} MB).");
        });
    }

    /// <summary>Clear Temp Files: deletes leftover .zip/.rar/.7z archives and extraction artifacts
    /// from Path.GetTempPath().</summary>
    private async Task ClearTempFilesAsync()
    {
        var (files, bytes) = await Task.Run(() => InstallService.ClearLeftoverTempArchives()).ConfigureAwait(false);
        _dispatcher.Invoke(() =>
        {
            StatusText = $"Temp files cleared — {files} item{(files == 1 ? "" : "s")}, {bytes / 1024.0 / 1024.0:F1} MB freed.";
            ShowQueuedToast("Temp files cleared", $"{files} leftover artifact{(files == 1 ? "" : "s")} deleted ({bytes / 1024.0 / 1024.0:F1} MB).");
        });
    }

    /// <summary>Clear Log Files: erases local app log files (crash.log) to free disk space.</summary>
    private async Task ClearLogFilesAsync()
    {
        var (files, bytes) = await Task.Run(() => _settings.ClearLogFiles()).ConfigureAwait(false);
        _dispatcher.Invoke(() =>
        {
            StatusText = $"Log files cleared — {files} file{(files == 1 ? "" : "s")}, {bytes / 1024.0:F0} KB freed.";
            ShowQueuedToast("Log files cleared", $"{files} log file{(files == 1 ? "" : "s")} erased.");
        });
    }

    // ------------------------------------------------------------------ toast notifications

    /// <summary>Shows a bottom-right toast ("Queued") that fades in and auto-dismisss after 3.5 s.</summary>
    private void ShowQueuedToast(string modTitle)
    {
        ShowQueuedToast("Queued", $"{modTitle} added to download queue.");
    }

    /// <summary>Shows a bottom-right toast with a custom header that fades in and auto-dismisses after 3.5 s.</summary>
    private void ShowQueuedToast(string title, string message)
    {
        var toast = new ToastViewModel(title, message);
        _dispatcher.Invoke(() =>
        {
            Toasts.Add(toast);
            if (Toasts.Count > 5) Toasts.RemoveAt(0); // never flood the corner

            var timer = new DispatcherTimer(DispatcherPriority.Background) { Interval = TimeSpan.FromSeconds(3.5) };
            timer.Tick += (_, _) =>
            {
                timer.Stop();
                Toasts.Remove(toast);
            };
            timer.Start();
        });
    }

    private void UpdateQueueBadge()
    {
        (int current, int queued, int completed) = _installQueue.Counters;
        int pending = current + queued;
        QueueBadgeText = pending > 0 ? pending.ToString("N0") : (completed > 0 ? "✓" : "0");
        QueueBadgeVisible = pending > 0 || completed > 0;
    }

    private string DescribeQueueCounters()
    {
        (int current, int queued, int completed) = _installQueue.Counters;
        return $"Current: {current} | Queue: {queued} | Completed: {completed}";
    }

    /// <summary>
    /// "Install from file…": pick real .zip/.rar/.7z archives from disk (multi-select) and push each
    /// into the Installation Queue — they are extracted into the SPT root with the same layout-aware,
    /// byte-accurate engine as catalog installs. No download, no temp copy.
    /// </summary>
    private void InstallLocalArchives()
    {
        if (string.IsNullOrWhiteSpace(SptDirectory) || !Directory.Exists(SptDirectory))
        {
            MessageDialog.Show("SPT directory not set",
                "Select your Single Player Tarkov root folder first (button “Set SPT Directory”, top left).",
                isError: true);
            return;
        }

        var dialog = new OpenFileDialog
        {
            Title = "Install mods from archive files",
            Filter = "Mod archives (*.zip;*.rar;*.7z)|*.zip;*.rar;*.7z|All files (*.*)|*.*",
            Multiselect = true,
            CheckFileExists = true
        };
        if (dialog.ShowDialog() != true || dialog.FileNames is not { Length: > 0 }) return;

        foreach (string file in dialog.FileNames)
        {
            _installQueue.EnqueueLocal(file, SptDirectory);
            ShowQueuedToast(Path.GetFileNameWithoutExtension(file));
        }

        StatusText = $"Queued {dialog.FileNames.Length} local archive{(dialog.FileNames.Length == 1 ? "" : "s")} — {DescribeQueueCounters()}.";
        OpenQueueWindowRequested?.Invoke(); // show the live progress immediately
    }

    private Task<DependencyPromptResult> ShowDependencyPromptAsync(DependencyPrompt prompt)
    {
        var tcs = new TaskCompletionSource<DependencyPromptResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        _dispatcher.Invoke(() =>
        {
            // Task 6.1, Fix C — un-missable prompt: owned by the main window, activated on show,
            // taskbar flash when the app is in the background, and a hard timeout so the flow can
            // never block forever (defaults to Cancel, same as the engine's prompt watchdog).
            var dialog = new DependencyDialog(prompt) { Owner = Application.Current.MainWindow, ShowActivated = true };
            dialog.Loaded += (_, _) =>
            {
                dialog.Activate();
                NativeMethods.FlashTaskbar(dialog);
                NativeMethods.FlashTaskbar(Application.Current.MainWindow);
            };

            var timeout = new DispatcherTimer { Interval = Services.InstallQueueEngine.DefaultPromptTimeout };
            timeout.Tick += (_, _) =>
            {
                timeout.Stop();
                if (dialog.IsLoaded)
                {
                    dialog.Close(); // Result stays Cancel — the default
                    StatusText = "Timed out waiting for dependency choice — nothing was queued.";
                }
            };
            dialog.Loaded += (_, _) => timeout.Start();
            dialog.Closed += (_, _) => timeout.Stop();

            Services.InstallTrace.Prompt(prompt.ModName,
                $"pre-queue dialog shown ({prompt.MissingCount} missing, {prompt.Conflicts.Count} conflicts)");
            dialog.ShowDialog();
            Services.InstallTrace.Prompt(prompt.ModName, $"pre-queue dialog answered: {dialog.Result}");
            tcs.TrySetResult(dialog.Result);
        });
        return tcs.Task;
    }

    // ------------------------------------------------------------------ installed mods: scan

    public async Task RescanInstalledAsync()
    {
        if (_isScanning) return;

        if (string.IsNullOrWhiteSpace(SptDirectory) || !Directory.Exists(SptDirectory))
        {
            _installedAll = new List<InstalledModViewModel>();
            InstalledItems.Clear();
            HasInstalledResults = false;
            InstalledSummaryText = string.Empty;
            InstalledTabHeader = "Installed Mods";
            InstalledEmptyText = "Set your SPT directory (top left) to scan for installed mods.";
            return;
        }

        _isScanning = true;
        StatusText = "Scanning user\\mods and BepInEx\\plugins…";
        try
        {
            foreach (InstalledModViewModel row in _installedAll) row.Conflicts = Array.Empty<Services.ModConflict>();

            List<InstalledModInfo> found = await Task.Run(() => _scanner.Scan(SptDirectory));

            // One card per MOD, not per component: the client and server halves of a dual mod
            // (BepInEx\plugins\X + user\mods\X.Server) consolidate here — grouped by the
            // catalog's mod id when known, otherwise a fuzzy author/name match.
            found = InstalledModsService.ConsolidateComponents(found, info => MatchCatalog(info)?.Id);

            // Self-heal: the disk is the source of truth — reconcile the persisted install
            // records with what the scanner just read (stale versions from older builds correct
            // themselves here) and refresh any Browse cards that pointed at a stale version.
            List<(int ModId, string Version)> healedRecords = await Task.Run(()
                => _installedService.ReconcileInstallRecordsWithDisk(
                    found, id => _catalogById.TryGetValue(id, out Mod? m) ? m : null));
            foreach ((int healedId, string healedVersion) in healedRecords)
            {
                ModCardViewModel? card = _allCards.FirstOrDefault(c => c.Mod.Id == healedId);
                if (card is not null) card.InstalledVersion = healedVersion;
            }

            var existing = _installedAll.ToDictionary(v => v.IdentityKey);
            var rows = new List<InstalledModViewModel>(found.Count);
            foreach (InstalledModInfo info in found)
            {
                if (existing.TryGetValue(info.IdentityKey, out InstalledModViewModel? row))
                {
                    row.Update(info);
                }
                else
                {
                    row = new InstalledModViewModel(info, UpdateModAsync, ToggleModAsync, UninstallModAsync,
                        EditModConfigs, ShowConflictDetails, _imageCache, _api);
                }
                rows.Add(row);
            }

            _installedAll = rows;
            EnrichInstalledRows();
            ApplyInstalledFilter();
            UpdateInstalledSummary();

            int server = rows.Count(r => r.Info.HasServerMod);   // dual cards count on both sides
            int client = rows.Count(r => r.Info.HasClientPlugin);
            StatusText = $"Scan complete — {rows.Count} installed mods ({server} server, {client} client).";

            _ = RunConflictDetectionAsync(); // background conflict/duplicate scan (never blocks the UI)
        }
        catch (Exception ex)
        {
            StatusText = $"Scan failed: {ex.Message}";
        }
        finally
        {
            _isScanning = false;
        }
    }

    /// <summary>Links installed rows to catalog entries (by GUID, then slug/folder name) for
    /// numeric IDs, detail URLs and author info.</summary>
    private void EnrichInstalledRows()
    {
        foreach (InstalledModViewModel row in _installedAll)
        {
            if (row.CatalogMatch is not null) continue;
            row.CatalogMatch = MatchCatalog(row.Info);
            // a consolidated card may match the catalog through ANY of its components
            // (e.g. the catalog guid belongs to the client half)
            if (row.CatalogMatch is null && row.Info.Components is not null)
            {
                foreach (InstalledModInfo component in row.Info.Components)
                {
                    row.CatalogMatch = MatchCatalog(component);
                    if (row.CatalogMatch is not null) break;
                }
            }
        }
    }

    private Mod? MatchCatalog(InstalledModInfo info)
    {
        if (!string.IsNullOrWhiteSpace(info.PackageId))
        {
            if (_catalogByGuid.TryGetValue(info.PackageId!, out Mod? byGuid)) return byGuid;
            if (_catalogBySlug.TryGetValue(info.PackageId!, out Mod? bySlugId)) return bySlugId;
        }
        if (_catalogBySlug.TryGetValue(info.DisplayName, out Mod? byFolder)) return byFolder;
        return null;
    }

    private void ApplyInstalledFilter()
    {
        // Client-side, instant local filtering: text + status toggles, then column sorting.
        var filter = new InstalledFilter
        {
            SearchText = InstalledSearchText,
            HideDisabled = HideDisabledMods,
            HideOutdated = HideOutdatedMods,
            OnlyServer = OnlyServerMods,
            OnlyClient = OnlyClientMods
        };

        List<InstalledRowData> rows = _installedAll
            .Select(r => new InstalledRowData(r.Info, r.Outcome))
            .ToList();

        List<InstalledRowData> matched = ModFilterEngine.Apply(rows, filter);
        ModFilterEngine.Sort(matched, _installedSortColumn, _installedSortDirection);

        // "Updates first": mods with an available update float to the top (stable — the column
        // sort order is preserved within each group).
        if (UpdatesFirst)
            matched = matched
                .OrderByDescending(r => r.Outcome?.Status == UpdateStatus.UpdateAvailable)
                .ToList();

        var byKey = _installedAll.ToDictionary(r => r.IdentityKey);
        InstalledItems.Clear();
        foreach (InstalledRowData row in matched)
            if (byKey.TryGetValue(row.Info.IdentityKey, out InstalledModViewModel? vm))
                InstalledItems.Add(vm);

        HasInstalledResults = InstalledItems.Count > 0;
        InstalledEmptyText = _installedAll.Count == 0
            ? (string.IsNullOrWhiteSpace(SptDirectory)
                ? "Set your SPT directory (top left) to scan for installed mods."
                : "No mods found in user\\mods or BepInEx\\plugins.\nInstall something from the Browse tab — it will show up here.")
            : (filter.HasConstraints
                ? "No installed mods match the current filters.\nClear the filter bar to see everything."
                : "No installed mods match the current search.");

        UpdateInstalledSummary();
    }

    private void UpdateInstalledSummary()
    {
        int total = _installedAll.Count;
        int updatable = _installedAll.Count(r => r.HasUpdate);
        int disabled = _installedAll.Count(r => r.Info.IsDisabled);
        int shown = InstalledItems.Count;

        InstalledTabHeader = total > 0 ? $"Installed Mods ({total})" : "Installed Mods";

        var parts = new List<string>();
        if (total > 0) parts.Add($"{total} installed");
        if (updatable > 0) parts.Add($"{updatable} update{(updatable == 1 ? "" : "s")} available");
        if (disabled > 0) parts.Add($"{disabled} disabled");
        if (shown < total) parts.Add($"showing {shown}");
        InstalledSummaryText = string.Join("  ·  ", parts);
    }

    // ------------------------------------------------------------------ installed mods: update check

    private async Task CheckForUpdatesAsync(bool silent)
    {
        if (_installedAll.Count == 0)
        {
            if (!silent) StatusText = "Nothing to check — no installed mods were found. Set your SPT directory and rescan first.";
            return;
        }

        string? sptVersion = EffectiveSptVersion;
        if (sptVersion is null)
        {
            // Fall back to a version declared by an installed mod itself (package.json sptVersion).
            sptVersion = _installedAll
                .Select(r => r.Info.SptVersionHint)
                .FirstOrDefault(h => !string.IsNullOrWhiteSpace(h) && SemVersion.TryParse(h, out _));
        }
        if (sptVersion is null)
        {
            string msg = "Set your SPT version (top bar) to check for updates — the sp-mod.com update API resolves releases against it.";
            StatusText = msg;
            if (!silent) MessageDialog.Show("SPT version needed", msg);
            return;
        }

        if (!await _updateCheckGate.WaitAsync(0)) return;
        try
        {
            var payload = new List<(InstalledModInfo Mod, string Identifier)>();
            foreach (InstalledModViewModel row in _installedAll)
            {
                if (string.IsNullOrWhiteSpace(row.Info.Version) || !SemVersion.TryParse(row.Info.Version, out _)) continue;
                string? identifier = row.CatalogMatch?.Id.ToString() ?? row.Info.PackageId;
                if (string.IsNullOrWhiteSpace(identifier)) continue;
                payload.Add((row.Info, identifier!));
            }

            if (payload.Count == 0)
            {
                StatusText = "None of your installed mods expose a package ID + version the update API can match.";
                return;
            }

            StatusText = $"Checking {payload.Count} installed mods for updates (SPT {sptVersion})…";
            ProgressPercent = -1;

            Dictionary<string, UpdateCheckOutcome> outcomes =
                await _installedService.CheckUpdatesAsync(payload, sptVersion, CancellationToken.None);

            int available = 0, upToDate = 0, incompatible = 0, blocked = 0;
            foreach (InstalledModViewModel row in _installedAll)
            {
                if (outcomes.TryGetValue(row.IdentityKey, out UpdateCheckOutcome? outcome))
                {
                    row.Outcome = outcome;
                    switch (outcome.Status)
                    {
                        case UpdateStatus.UpdateAvailable: available++; break;
                        case UpdateStatus.UpToDate: upToDate++; break;
                        case UpdateStatus.Incompatible: incompatible++; break;
                        case UpdateStatus.Blocked: blocked++; break;
                    }
                }
                else
                {
                    row.Outcome = null;
                }
            }

            UpdateInstalledSummary();
            ProgressPercent = 0;
            StatusText = $"Update check complete — {available} update{(available == 1 ? "" : "s")} available · {upToDate} up to date" +
                         (incompatible > 0 ? $" · {incompatible} incompatible with SPT {sptVersion}" : "") +
                         (blocked > 0 ? $" · {blocked} blocked" : "") + ".";
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            ProgressPercent = 0;
            StatusText = $"Update check failed: {ex.Message}";
            if (!silent)
                MessageDialog.Show("Update check failed",
                    $"The update check against https://sp-mod.com/api/v0/mods/updates failed.\n\n{ex.Message}",
                    isError: true);
        }
        finally
        {
            _updateCheckGate.Release();
        }
    }

    // ------------------------------------------------------------------ installed mods: actions

    private async Task UpdateModAsync(InstalledModViewModel row)
    {
        if (!await _installGate.WaitAsync(0))
        {
            StatusText = "Another install/update is already in progress — please wait for it to finish.";
            return;
        }

        try
        {
            UpdateCheckOutcome? outcome = row.Outcome;
            if (outcome?.Link is null)
            {
                StatusText = $"No downloadable update known for “{row.DisplayName}” — run “Check for Updates” first.";
                return;
            }
            if (string.IsNullOrWhiteSpace(SptDirectory) || !Directory.Exists(SptDirectory))
            {
                MessageDialog.Show("SPT directory not set", "Set your SPT directory before updating mods.", isError: true);
                return;
            }

            row.IsBusy = true;
            IsInstallBusy = true;
            SpeedText = string.Empty;

            var progress = new Progress<InstallProgress>(p =>
            {
                StatusText = p.StatusText;
                ProgressPercent = p.Percent;
                SpeedText = p.SpeedText ?? string.Empty;
            });

            UpdateActionResult result = await _installedService.UpdateAsync(
                row.Info, outcome.Link, outcome.ContentLength, SptDirectory, progress,
                CancellationToken.None, outcome.NewVersion,
                catalogModId: row.CatalogMatch?.Id ?? outcome.CatalogModId,
                releaseId: outcome.ReleaseId);

            row.Outcome = null; // stale either way — a rescan picks up the new on-disk version
            await RescanInstalledAsync();

            if (result.Success)
            {
                // Disk-verified version (falls back to the catalog's version string) — patches
                // the in-memory card so the "Update Available" badge clears immediately; the
                // persisted record was already committed inside UpdateAsync.
                string? installedNow = result.VerifiedVersion ?? outcome.NewVersion;
                ProgressPercent = 100;
                SpeedText = string.Empty;
                StatusText = $"Update complete — {row.DisplayName} → v{installedNow}.";

                int? cardId = row.CatalogMatch?.Id ?? outcome.CatalogModId;
                if (cardId is not null)
                {
                    ModCardViewModel? card = _allCards.FirstOrDefault(c => c.Mod.Id == cardId.Value);
                    if (card is not null) card.InstalledVersion = installedNow;
                }
            }
            else
            {
                ProgressPercent = 0;
                SpeedText = string.Empty;
                StatusText = $"Update failed: {result.Message}";
                MessageDialog.Show("Update failed", $"“{row.DisplayName}” could not be updated.\n\n{result.Message}", isError: true);
            }
        }
        catch (Exception ex)
        {
            ProgressPercent = 0;
            SpeedText = string.Empty;
            StatusText = $"Update failed: {ex.Message}";
            MessageDialog.Show("Update failed", $"Unexpected error while updating “{row.DisplayName}”:\n\n{ex}", isError: true);
        }
        finally
        {
            row.IsBusy = false;
            IsInstallBusy = false;
            _installGate.Release();
        }
    }

    private async Task ToggleModAsync(InstalledModViewModel row)
    {
        bool enable = row.Info.IsDisabled;
        try
        {
            row.IsBusy = true;
            await Task.Run(() => _installedService.SetEnabled(row.Info, enable));
            await RescanInstalledAsync();
            StatusText = enable
                ? $"Enabled {row.DisplayName} — SPT will load it on next launch."
                : $"Disabled {row.DisplayName} (renamed with “.disabled”) — SPT will skip it.";
        }
        catch (Exception ex)
        {
            StatusText = $"Enable/Disable failed: {ex.Message}";
            MessageDialog.Show("Enable/Disable failed", $"“{row.DisplayName}” could not be {(enable ? "enabled" : "disabled")}.\n\n{ex.Message}", isError: true);
        }
        finally
        {
            row.IsBusy = false;
        }
    }

    /// <summary>Enable/Disable All: toggles every matching mod with the real .disabled folder-suffix
    /// convention, then rescans once.</summary>
    private async Task SetAllModsEnabledAsync(bool enable)
    {
        List<InstalledModViewModel> targets = _installedAll.Where(r => r.Info.IsDisabled == enable).ToList();
        if (targets.Count == 0)
        {
            StatusText = enable ? "No disabled mods to enable." : "All mods are already disabled.";
            return;
        }

        StatusText = $"{(enable ? "Enabling" : "Disabling")} {targets.Count} mods…";
        try
        {
            await Task.Run(() =>
            {
                foreach (InstalledModViewModel row in targets)
                    _installedService.SetEnabled(row.Info, enable);
            });
            await RescanInstalledAsync();
            ShowQueuedToast(enable ? "Mods enabled" : "Mods disabled",
                $"{targets.Count} mod{(targets.Count == 1 ? "" : "s")} {(enable ? "enabled" : "disabled")}.");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            StatusText = $"Bulk {(enable ? "enable" : "disable")} failed: {ex.Message}";
            MessageDialog.Show("Bulk toggle failed", ex.Message, isError: true);
        }
    }

    /// <summary>Uninstall All: confirmation dialog, then removes every installed mod from disk.</summary>
    private async Task UninstallAllModsAsync()
    {
        List<InstalledModViewModel> targets = _installedAll.ToList();
        if (targets.Count == 0)
        {
            StatusText = "No installed mods to uninstall.";
            return;
        }

        bool confirmed = MessageDialog.Confirm("Uninstall all mods",
            $"This permanently deletes ALL {targets.Count} installed mods from your SPT folder:{Environment.NewLine}{SptDirectory}{Environment.NewLine}{Environment.NewLine}There is no undo. Continue?");
        if (!confirmed) return;

        StatusText = $"Uninstalling {targets.Count} mods…";
        foreach (InstalledModViewModel row in targets)
            await UninstallModAsync(row);
        await RescanInstalledAsync();
        ShowQueuedToast("Mods uninstalled", $"{targets.Count} mod{(targets.Count == 1 ? "" : "s")} removed.");
    }

    /// <summary>Opens a mod folder in Windows Explorer (real Process.Start on the configured path).</summary>
    private void OpenModFolder(string relativeSubpath)
    {
        if (string.IsNullOrWhiteSpace(SptDirectory) || !Directory.Exists(SptDirectory))
        {
            MessageDialog.Show("SPT directory not set",
                "Select your Single Player Tarkov root folder first (button “Set SPT Directory”, top left).",
                isError: true);
            return;
        }

        string fullPath = Path.Combine(SptDirectory, relativeSubpath);
        if (!Directory.Exists(fullPath))
        {
            MessageDialog.Show("Folder not found",
                $"This folder does not exist yet:{Environment.NewLine}{fullPath}{Environment.NewLine}{Environment.NewLine}It is created automatically when the first mod is installed.",
                isError: true);
            return;
        }

        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = fullPath,
                UseShellExecute = true
            });
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or IOException)
        {
            StatusText = $"Could not open folder: {ex.Message}";
        }
    }

    private async Task UninstallModAsync(InstalledModViewModel row)
    {
        string uninstallPaths = string.Join("\n", row.Info.Components?.Select(c => c.InstallPath) ?? new[] { row.Info.InstallPath });
        MessageBoxResult confirm = MessageBox.Show(
            Application.Current.MainWindow,
            $"Are you sure you want to uninstall “{row.DisplayName}”?\n\nThis will permanently delete:\n{uninstallPaths}\n\nThis cannot be undone.",
            "Uninstall mod",
            MessageBoxButton.YesNo,
            MessageBoxImage.Warning,
            MessageBoxResult.No);

        if (confirm != MessageBoxResult.Yes) return;

        try
        {
            row.IsBusy = true;
            await Task.Run(() => _installedService.Uninstall(row.Info));

            _installedAll.Remove(row);
            InstalledItems.Remove(row);

            if (row.CatalogMatch is not null)
            {
                ModCardViewModel? card = _allCards.FirstOrDefault(c => c.Mod.Id == row.CatalogMatch.Id);
                if (card is not null) card.InstalledVersion = null;
            }

            UpdateInstalledSummary();
            StatusText = $"Uninstalled {row.DisplayName} — removed from {row.Info.ParentDirectory}.";
        }
        catch (Exception ex)
        {
            StatusText = $"Uninstall failed: {ex.Message}";
            MessageDialog.Show("Uninstall failed", $"“{row.DisplayName}” could not be removed.\n\n{ex.Message}", isError: true);
            await RescanInstalledAsync();
        }
        finally
        {
            row.IsBusy = false;
        }
    }

    private static SolidColorBrush Freeze(SolidColorBrush brush)
    {
        brush.Freeze();
        return brush;
    }
}
