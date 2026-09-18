using System.ComponentModel;

namespace Blacksite.Models;

/// <summary>Lifecycle of one queued installation task.</summary>
public enum InstallTaskState
{
    Queued,
    Downloading,
    Extracting,
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

    private InstallTaskState _state = InstallTaskState.Queued;
    private double _percent;              // -1 → indeterminate
    private string _speedText = string.Empty;
    private string _bytesText = string.Empty;
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

    /// <summary>True while the task occupies a processing slot (downloading or extracting).</summary>
    public bool IsBusy => _state is InstallTaskState.Downloading or InstallTaskState.Extracting;

    public double Percent
    {
        get => _percent;
        set { if (Math.Abs(_percent - value) > 0.01) { _percent = value; Raise(nameof(Percent)); Raise(nameof(IsIndeterminate)); } }
    }

    public bool IsIndeterminate => _percent < 0;

    public string SpeedText { get => _speedText; set { if (_speedText != value) { _speedText = value; Raise(nameof(SpeedText)); } } }

    /// <summary>“117.2 / 117.2 MB” while downloading; “43%” style detail while extracting.</summary>
    public string BytesText { get => _bytesText; set { if (_bytesText != value) { _bytesText = value; Raise(nameof(BytesText)); } } }

    public string StatusText => State switch
    {
        InstallTaskState.Queued => "Pending…",
        InstallTaskState.Downloading => "Downloading…",
        InstallTaskState.Extracting => "Extracting…",
        InstallTaskState.Completed => $"✓ Completed {(_completedAt?.ToString("HH:mm:ss") ?? "")}".Trim(),
        InstallTaskState.Failed => "✗ Failed",
        _ => "Queued"
    };

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

    public override string ToString() => $"[{State}] {ModName} ({PackageId})";
}
