using System.Windows.Input;
using System.Windows.Media;
using Blacksite.Models;
using Blacksite.Services;

namespace Blacksite.ViewModels;

/// <summary>
/// App-side wrapper around one <see cref="InstallQueueItem"/> for the Installation Queue window
/// (task 6.3). The item model stays WPF-free (it is compiled into the console harnesses); this
/// wrapper adds what only the UI needs: the loaded thumbnail and per-card commands.
/// </summary>
public sealed class QueueCardViewModel : ViewModelBase
{
    private ImageSource? _thumb;

    public InstallQueueItem Item { get; }

    /// <summary>Cancels this item (queued → removed; busy → aborts the pipeline cleanly).</summary>
    public ICommand CancelCommand { get; }

    /// <summary>Re-enqueues this item after a failure (or a cancellation).</summary>
    public ICommand RetryCommand { get; }

    public QueueCardViewModel(InstallQueueItem item, InstallQueueEngine engine)
    {
        Item = item;
        CancelCommand = new RelayCommand(() => engine.Cancel(item));
        RetryCommand = new RelayCommand(() => engine.Retry(item));
    }

    /// <summary>Thumbnail loaded asynchronously by the queue view model (null → placeholder).</summary>
    public ImageSource? Thumb
    {
        get => _thumb;
        set => SetProperty(ref _thumb, value);
    }
}
