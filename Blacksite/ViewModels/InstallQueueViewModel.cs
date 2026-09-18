using System.Collections.ObjectModel;
using System.Windows.Input;
using Blacksite.Models;
using Blacksite.Services;

namespace Blacksite.ViewModels;

/// <summary>Backing state of the Installation Queue window: two lists, live counters, Clear Completed.</summary>
public sealed class InstallQueueViewModel : ViewModelBase
{
    private readonly InstallQueueEngine _engine;

    /// <summary>Active tasks (Queued / Downloading / Extracting) — the "Install Queue" tab.</summary>
    public ObservableCollection<InstallQueueItem> ActiveItems { get; } = new();

    /// <summary>Finished tasks (Completed / Failed) — the "Completed" tab.</summary>
    public ObservableCollection<InstallQueueItem> FinishedItems { get; } = new();

    public ICommand ClearCompletedCommand { get; }

    private int _selectedTabIndex;
    public int SelectedTabIndex { get => _selectedTabIndex; set => SetProperty(ref _selectedTabIndex, value); }

    private string _countersText = "Current: 0  |  Queue: 0  |  Completed: 0";
    public string CountersText { get => _countersText; private set => SetProperty(ref _countersText, value); }

    public InstallQueueViewModel(InstallQueueEngine engine)
    {
        _engine = engine;
        ClearCompletedCommand = new RelayCommand(ClearCompleted);

        _engine.ItemUpdated += OnItemUpdated;
        _engine.TaskFinished += OnTaskFinished;
    }

    private void OnItemUpdated(InstallQueueItem item)
    {
        switch (item.State)
        {
            case InstallTaskState.Queued:
                if (!ActiveItems.Contains(item))
                {
                    // New task entered the queue — keep arrival order.
                    lock (ActiveItems) ActiveItems.Add(item);
                }
                break;

            case InstallTaskState.Downloading:
            case InstallTaskState.Extracting:
                if (!ActiveItems.Contains(item))
                    ActiveItems.Add(item);
                break;

            case InstallTaskState.Completed:
            case InstallTaskState.Failed:
                // Moved to the Completed tab by OnTaskFinished; nothing to do here.
                break;
        }

        RefreshCounters();
    }

    private void OnTaskFinished(InstallQueueItem item, InstallResult result)
    {
        if (ActiveItems.Contains(item))
            ActiveItems.Remove(item);
        if (!FinishedItems.Contains(item))
            FinishedItems.Insert(0, item); // newest finished first
        RefreshCounters();
    }

    private void ClearCompleted()
    {
        InstallQueueItem[] finished = FinishedItems.ToArray();
        FinishedItems.Clear();
        _engine.RemoveFinished(finished);
        RefreshCounters();
    }

    private void RefreshCounters()
    {
        (int current, int queued, int completed) = _engine.Counters;
        CountersText = $"Current: {current}  |  Queue: {queued}  |  Completed: {completed}";
    }
}
