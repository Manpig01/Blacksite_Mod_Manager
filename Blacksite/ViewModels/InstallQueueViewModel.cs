using System.Collections.ObjectModel;
using System.Windows.Input;
using System.Windows.Threading;
using Blacksite.Models;
using Blacksite.Services;

namespace Blacksite.ViewModels;

/// <summary>
/// Backing state of the Installation Queue window (task 6.3): three live sections —
/// Active downloads, Queued, Completed/Failed — plus Clear Completed. Cards are
/// <see cref="QueueCardViewModel"/> wrappers (thumbnail + per-card Cancel/Retry commands)
/// around the engine's <see cref="InstallQueueItem"/> models.
/// </summary>
public sealed class InstallQueueViewModel : ViewModelBase
{
    private readonly InstallQueueEngine _engine;
    private readonly ImageCache? _imageCache;
    private readonly Dispatcher _dispatcher;
    private readonly Dictionary<InstallQueueItem, QueueCardViewModel> _cards = new();

    /// <summary>Running tasks (Downloading / Extracting / WaitingForUser).</summary>
    public ObservableCollection<QueueCardViewModel> ActiveCards { get; } = new();

    /// <summary>Waiting tasks, in queue order.</summary>
    public ObservableCollection<QueueCardViewModel> QueuedCards { get; } = new();

    /// <summary>Finished tasks (Completed / Failed), newest first.</summary>
    public ObservableCollection<QueueCardViewModel> FinishedCards { get; } = new();

    public ICommand ClearCompletedCommand { get; }

    private string _countersText = "Current: 0  |  Queue: 0  |  Completed: 0";
    public string CountersText { get => _countersText; private set => SetProperty(ref _countersText, value); }

    public bool HasActive => ActiveCards.Count > 0;
    public bool HasQueued => QueuedCards.Count > 0;
    public bool HasFinished => FinishedCards.Count > 0;

    public string QueuedHeaderText => QueuedCards.Count > 0 ? $"Queued ({QueuedCards.Count})" : "Queued";

    public InstallQueueViewModel(InstallQueueEngine engine, ImageCache? imageCache = null)
    {
        _engine = engine;
        _imageCache = imageCache;
        _dispatcher = Dispatcher.CurrentDispatcher;
        ClearCompletedCommand = new RelayCommand(ClearCompleted);

        _engine.ItemUpdated += OnItemUpdated;
        _engine.TaskFinished += OnTaskFinished;
    }

    private void OnItemUpdated(InstallQueueItem item) => Partition(item);

    private void OnTaskFinished(InstallQueueItem item, InstallResult result) => Partition(item);

    /// <summary>Moves the card to the collection matching its current state (idempotent).</summary>
    private void Partition(InstallQueueItem item)
    {
        QueueCardViewModel card = EnsureCard(item);

        switch (item.State)
        {
            case InstallTaskState.Downloading:
            case InstallTaskState.Extracting:
            case InstallTaskState.WaitingForUser:
                Move(card, ActiveCards, QueuedCards, FinishedCards, append: true);
                break;

            case InstallTaskState.Queued:
                Move(card, QueuedCards, ActiveCards, FinishedCards, append: true);
                break;

            case InstallTaskState.Completed:
            case InstallTaskState.Failed:
                // Newest finished first.
                if (FinishedCards.Contains(card)) return;
                ActiveCards.Remove(card);
                QueuedCards.Remove(card);
                FinishedCards.Insert(0, card);
                break;
        }

        RefreshCounters();
    }

    private static void Move(QueueCardViewModel card,
        ObservableCollection<QueueCardViewModel> target,
        ObservableCollection<QueueCardViewModel> otherA,
        ObservableCollection<QueueCardViewModel> otherB,
        bool append)
    {
        if (target.Contains(card)) return;
        otherA.Remove(card);
        otherB.Remove(card);
        if (append) target.Add(card);
    }

    private QueueCardViewModel EnsureCard(InstallQueueItem item)
    {
        if (_cards.TryGetValue(item, out QueueCardViewModel? existing)) return existing;

        var card = new QueueCardViewModel(item, _engine);
        _cards[item] = card;
        if (_imageCache is not null && !string.IsNullOrWhiteSpace(item.ThumbnailUrl))
            _ = LoadThumbAsync(card);
        return card;
    }

    private async Task LoadThumbAsync(QueueCardViewModel card)
    {
        try
        {
            System.Windows.Media.Imaging.BitmapImage? image =
                await _imageCache!.GetAsync(card.Item.ThumbnailUrl).ConfigureAwait(true);
            if (image is not null)
                card.Thumb = image; // ConfigureAwait(true) keeps us on the captured dispatcher
        }
        catch
        {
            // A missing thumbnail must never break the queue window.
        }
    }

    private void ClearCompleted()
    {
        InstallQueueItem[] finished = FinishedCards.Select(c => c.Item).ToArray();
        foreach (QueueCardViewModel card in FinishedCards)
            _cards.Remove(card.Item);
        FinishedCards.Clear();
        _engine.RemoveFinished(finished);
        RefreshCounters();
    }

    private void RefreshCounters()
    {
        (int current, int queued, int completed) = _engine.Counters;
        CountersText = $"Current: {current}  |  Queue: {queued}  |  Completed: {completed}";
        OnPropertyChanged(nameof(HasActive));
        OnPropertyChanged(nameof(HasQueued));
        OnPropertyChanged(nameof(HasFinished));
        OnPropertyChanged(nameof(QueuedHeaderText));
    }
}
