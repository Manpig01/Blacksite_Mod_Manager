using System.Diagnostics;
using System.Net.Http;
using System.Windows.Input;
using System.Windows.Media;
using Blacksite.Models;
using Blacksite.Services;

namespace Blacksite.ViewModels;

/// <summary>View-model behind one mod card in the catalog grid.</summary>
public sealed class ModCardViewModel : ViewModelBase
{
    private readonly ImageCache _images;
    private readonly Action<ModCardViewModel> _installHandler;
    private readonly Action<ModCardViewModel> _versionsHandler;
    private readonly Func<bool> _canInstall;
    private readonly SpModApiClient? _api;
    private bool _thumbnailRequested;
    private ImageSource? _thumbnail;
    private bool _isInstalling;
    private bool _isQueued;
    private string? _installedVersion;
    private bool _versionInfoRequested;
    private string? _latestVersionLabel;
    private string? _sptBadgeText;

    /// <summary>Session cache: mod id → (latest version, SPT badge) from the live versions API —
    /// avoids re-fetching when paging back and forth through the catalog.</summary>
    // Session-wide cache shared by the browse grid AND installed cards (keyed by catalog mod id).
    internal static readonly System.Collections.Concurrent.ConcurrentDictionary<int, (string Version, string Spt)> LatestVersionCache = new();
    internal static readonly SemaphoreSlim VersionFetchGate = new(4, 4);

    public Mod Mod { get; }

    public ModCardViewModel(Mod mod, ImageCache images, Action<ModCardViewModel> installHandler,
        Func<bool> canInstall, Action<ModCardViewModel> versionsHandler, SpModApiClient? api = null)
    {
        Mod = mod;
        _images = images;
        _installHandler = installHandler;
        _canInstall = canInstall;
        _versionsHandler = versionsHandler;
        _api = api;
        InstallCommand = new RelayCommand(() => _installHandler(this), () => !IsInstalling && !IsQueued && _canInstall());
        OpenPageCommand = new RelayCommand(OpenModPage);
        VersionsCommand = new RelayCommand(() => _versionsHandler(this));
    }

    public ICommand InstallCommand { get; }
    public ICommand OpenPageCommand { get; }
    public ICommand VersionsCommand { get; }

    public string Name => Mod.DisplayName;
    public string Author => Mod.AllAuthors;
    public string PackageId => Mod.PackageId;
    public string Teaser => string.IsNullOrWhiteSpace(Mod.Teaser) ? "No description provided." : Mod.Teaser!;
    public string DownloadsText => $"{FormatCount(Mod.Downloads)} downloads";
    public string FavouritesText => $"{FormatCount(Mod.FavouritesCount)} ♥";
    public string CategoryText => Mod.Category?.Title ?? string.Empty;
    public bool HasCategory => !string.IsNullOrWhiteSpace(CategoryText);
    /// <summary>Live fika_compatibility flag from the catalog API.</summary>
    public bool IsFikaCompatible => Mod.FikaCompatibility == true;
    public string Initial => string.IsNullOrEmpty(Name) ? "?" : Name[..1].ToUpperInvariant();
    public bool HasDetailUrl => !string.IsNullOrWhiteSpace(Mod.DetailUrl);

    /// <summary>Primary author for the orange pill badge (e.g. "GhostFenixx").</summary>
    public string AuthorPillText => Mod.AuthorName;

    /// <summary>Category tag pill (e.g. "Overhauls").</summary>
    public string PrimaryTagText => CategoryText;

    /// <summary>Secondary tag pill ("Featured" for featured mods).</summary>
    public string SecondaryTagText => Mod.Featured ? "Featured" : string.Empty;
    public bool HasSecondaryTag => Mod.Featured;

    /// <summary>Stats row: "Latest v1.2.3  •  Downloads 1,234,567" (live versions API).</summary>
    public string StatsText => $"Latest {_latestVersionLabel ?? "v—"}  •  Downloads {Mod.Downloads:N0}";

    /// <summary>Green thumbnail badge: "★ SPT 4.1.x" (the latest release's own SPT constraint).</summary>
    public string SptBadgeText => _sptBadgeText ?? string.Empty;
    public bool HasSptBadge => !string.IsNullOrEmpty(_sptBadgeText);

    /// <summary>Fika overlay badge on the thumbnail (bottom-left) — from the catalog API flag.</summary>
    public bool ShowFikaOverlay => IsFikaCompatible;

    /// <summary>Fetches the mod's real version list once per session and fills the card badges
    /// (latest version + the SPT constraint of that release). Called when the card materializes.</summary>
    public async void EnsureVersionInfoRequested()
    {
        if (_versionInfoRequested || _api is null) return;
        _versionInfoRequested = true;

        if (LatestVersionCache.TryGetValue(Mod.Id, out var cached))
        {
            ApplyVersionInfo(cached);
            return;
        }

        (string Version, string Spt)? info = await GetOrCreateVersionInfoAsync(_api!, Mod.Id).ConfigureAwait(false);
        if (info is not null)
        {
            ApplyVersionInfo(info.Value); // scalar PropertyChanged is marshaled to the UI thread by WPF
        }
    }

    private void ApplyVersionInfo((string Version, string Spt) info)
    {
        _latestVersionLabel = $"v{info.Version}";
        _sptBadgeText = info.Spt;
        OnPropertyChanged(nameof(StatsText));
        OnPropertyChanged(nameof(SptBadgeText));
        OnPropertyChanged(nameof(HasSptBadge));
    }

    /// <summary>Shared (browse + installed cards): fetches the mod's newest release once per
    /// session and returns ("1.2.3", "★ SPT 4.1.x") — or null when the API yields nothing.</summary>
    internal static async Task<(string Version, string Spt)?> GetOrCreateVersionInfoAsync(SpModApiClient api, int modId)
    {
        if (LatestVersionCache.TryGetValue(modId, out var cached)) return cached;

        await VersionFetchGate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (LatestVersionCache.TryGetValue(modId, out cached)) return cached;

            List<ModVersion> versions = await api.GetVersionsAsync(modId, CancellationToken.None).ConfigureAwait(false);
            ModVersion? newest = versions
                .Where(v => !string.IsNullOrWhiteSpace(v.Link))
                .OrderByDescending(v => SemVersion.TryParse(v.Version) ?? SemVersion.Zero)
                .ThenByDescending(v => v.PublishedAt ?? DateTimeOffset.MinValue)
                .FirstOrDefault();
            if (newest is null) return null;

            string spt = (newest.SptVersionConstraint ?? string.Empty).Trim().TrimStart('~', '^', '=', '>', '<').Trim();
            var info = (newest.Version, spt.Length > 0 ? $"★ SPT {spt}" : string.Empty);
            LatestVersionCache[modId] = info;
            return info;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or ApiException)
        {
            return null; // best-effort badge — callers keep their placeholder
        }
        finally
        {
            VersionFetchGate.Release();
        }
    }

    public ImageSource? Thumbnail
    {
        get => _thumbnail;
        set => SetProperty(ref _thumbnail, value);
    }

    public bool IsInstalling
    {
        get => _isInstalling;
        set
        {
            if (SetProperty(ref _isInstalling, value))
            {
                OnPropertyChanged(nameof(InstallButtonText));
                ((RelayCommand)InstallCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>True while this mod sits in the Installation Queue waiting for its turn.</summary>
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

    /// <summary>Version installed through this manager (persisted across sessions).</summary>
    public string? InstalledVersion
    {
        get => _installedVersion;
        set
        {
            if (SetProperty(ref _installedVersion, value))
            {
                OnPropertyChanged(nameof(IsInstalled));
                OnPropertyChanged(nameof(InstallButtonText));
                OnPropertyChanged(nameof(InstalledBadgeText));
            }
        }
    }

    public bool IsInstalled => !string.IsNullOrEmpty(_installedVersion);

    public string InstallButtonText => IsInstalling ? "Installing…" : IsQueued ? "Queued…" : IsInstalled ? "Reinstall" : "Install";

    public string InstalledBadgeText => IsInstalled ? $"✓ installed · v{InstalledVersion}" : string.Empty;

    /// <summary>Called by the view when a card container is materialized — loads the thumbnail lazily.</summary>
    public void EnsureThumbnailRequested()
    {
        if (_thumbnailRequested || string.IsNullOrWhiteSpace(Mod.Thumbnail)) return;
        _thumbnailRequested = true;
        _ = LoadThumbnailAsync();
    }

    private async Task LoadThumbnailAsync()
    {
        var image = await _images.GetAsync(Mod.Thumbnail);
        if (image is not null) Thumbnail = image;
    }

    private void OpenModPage()
    {
        if (!HasDetailUrl) return;
        try
        {
            Process.Start(new ProcessStartInfo(Mod.DetailUrl!) { UseShellExecute = true });
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            Debug.WriteLine($"Could not open mod page: {ex.Message}");
        }
    }

    internal void RaiseInstallCanExecute() => ((RelayCommand)InstallCommand).RaiseCanExecuteChanged();

    private static string FormatCount(int count) => count switch
    {
        >= 1_000_000 => $"{count / 1_000_000.0:F1}M",
        >= 1_000 => $"{count / 1_000.0:F1}k",
        _ => count.ToString("N0")
    };
}
