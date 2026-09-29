using System.ComponentModel;

namespace Blacksite.Models;

/// <summary>Lifecycle of one queued installation task.</summary>
public enum InstallTaskState
{
    Queued,
    Downloading,
    Extracting,
    /// <summary>The pipeline is blocked on the dependency-prompt dialog (task 6.1, Fix C).
    /// Occupies a processing slot; auto-cancels after the engine's prompt timeout.</summary>
    WaitingForUser,
    Completed,
    Failed
}

/// <summary>
/// One card in the Installation Queue window. Pure INotifyPropertyChanged (no WPF dependencies),
/// so the queue engine can be exercised end-to-end in console smoke tests against the live API.
/// </summary>
public sealed class InstallQueueItem : INotifyPropertyChanged
{
    public int ModId { get; init; }
    public required string ModName { get; init; }
    public required string PackageId { get; init; }
    public string? Teaser { get; init; }

    /// <summary>Catalog thumbnail URL (null for local archives / pre-resolved dependencies
    /// without one) — the queue window loads it through the shared ImageCache.</summary>
    public string? ThumbnailUrl { get; init; }

    private InstallTaskState _state = InstallTaskState.Queued;
    private double _percent;              // -1 → indeterminate
    private string _speedText = string.Empty;
    private string _bytesText = string.Empty;
    private string? _subTask;             // pipeline label override ("Dependency 2/3: CommonLib")
    private string? _statusDetail;        // live notice line ("Rate limited by sp-mod.com — waiting 45s (attempt 2 of 6)")
    private string? _error;
    private DateTime? _completedAt;
    private string? _installedVersion;

    public event PropertyChangedEventHandler? PropertyChanged;

    private void Raise(string? name) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

    public InstallTaskState State
    {
        get => _state;
        set { if (_state != value) { _state = value; Raise(nameof(State)); Raise(nameof(IsBusy)); Raise(nameof(StatusText)); } }
    }

    /// <summary>True while the task occupies a processing slot (downloading, extracting or waiting for the user).</summary>
    public bool IsBusy => _state is InstallTaskState.Downloading or InstallTaskState.Extracting or InstallTaskState.WaitingForUser;

    public double Percent
    {
        get => _percent;
        set { if (Math.Abs(_percent - value) > 0.01) { _percent = value; Raise(nameof(Percent)); Raise(nameof(IsIndeterminate)); } }
    }

    public bool IsIndeterminate => _percent < 0;

    public string SpeedText { get => _speedText; set { if (_speedText != value) { _speedText = value; Raise(nameof(SpeedText)); } } }

    /// <summary>“117.2 / 117.2 MB” while downloading; “43%” style detail while extracting.</summary>
    public string BytesText { get => _bytesText; set { if (_bytesText != value) { _bytesText = value; Raise(nameof(BytesText)); } } }

    public string StatusText => SubTask is { Length: > 0 } subTask
        ? subTask
        : State switch
        {
            InstallTaskState.Queued => "Pending…",
            InstallTaskState.Downloading => "Downloading…",
            InstallTaskState.Extracting => "Extracting…",
            InstallTaskState.WaitingForUser => "Waiting for your answer — choose how to handle dependencies",
            InstallTaskState.Completed => $"✓ Completed {(_completedAt?.ToString("HH:mm:ss") ?? "")}".Trim(),
            InstallTaskState.Failed => "✗ Failed",
            _ => "Queued"
        };

    /// <summary>Pipeline label override while a card moves through sub-operations —
    /// "Resolving dependencies (2 found)…", "Dependency 2/3: CommonLib". Null → plain state label.</summary>
    public string? SubTask
    {
        get => _subTask;
        set { if (_subTask != value) { _subTask = value; Raise(nameof(SubTask)); Raise(nameof(StatusText)); } }
    }

    /// <summary>Live secondary line from the HTTP pipeline — e.g. the rate-limit countdown
    /// "Rate limited by sp-mod.com — waiting 45s (attempt 2 of 6)". Cleared on completion.</summary>
    public string? StatusDetail
    {
        get => _statusDetail;
        set { if (_statusDetail != value) { _statusDetail = value; Raise(nameof(StatusDetail)); } }
    }

    /// <summary>Set when the dependency prompt timed out and the default Cancel was applied
    /// (task 6.1, Fix C) — the engine turns it into the card's failure note.</summary>
    public bool PromptTimedOut { get; set; }

    /// <summary>Exact exception/result message for failed tasks.</summary>
    public string? Error
    {
        get => _error;
        set { if (_error != value) { _error = value; Raise(nameof(Error)); } }
    }

    public DateTime? CompletedAt
    {
        get => _completedAt;
        set { if (_completedAt != value) { _completedAt = value; Raise(nameof(CompletedAt)); Raise(nameof(StatusText)); } }
    }

    public string? InstalledVersion
    {
        get => _installedVersion;
        set { if (_installedVersion != value) { _installedVersion = value; Raise(nameof(InstalledVersion)); } }
    }

    /// <summary>Resets a finished card for a retry re-enqueue (task 6.1, Fix D).</summary>
    public void Reset()
    {
        PromptTimedOut = false;
        State = InstallTaskState.Queued;
        Percent = -1;
        SpeedText = string.Empty;
        BytesText = string.Empty;
        SubTask = null;
        StatusDetail = null;
        Error = null;
        CompletedAt = null;
        InstalledVersion = null;
    }

    public override string ToString() => $"[{State}] {ModName} ({PackageId})";
}
