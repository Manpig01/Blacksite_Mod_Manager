using System.IO;
using System.Threading.Channels;
using Blacksite.Models;

namespace Blacksite.Services;

/// <summary>
/// Multi-task installation queue: an unbounded Channel&lt;T&gt; fed by the catalog "Install" buttons,
/// drained by a background consumer gated by a SemaphoreSlim (MaxParallelDownloads slots).
/// Slots = 1 → strictly sequential processing, exactly as allowed by the spec; raising the
/// constant enables up to N parallel downloads without any other change.
///
/// All item mutations are marshalled back to the context captured when the engine was created
/// (the WPF UI thread in the app; the thread pool in console tests), so subscribers can touch
/// UI collections directly.
/// </summary>
public sealed class InstallQueueEngine : IDisposable
{
    /// <summary>Maximum installations processed concurrently.</summary>
    public const int MaxParallelDownloads = 1;

    private readonly InstallService _installer;
    private readonly SynchronizationContext? _syncContext;
    private readonly Channel<WorkItem> _channel =
        Channel.CreateUnbounded<WorkItem>(new UnboundedChannelOptions { SingleReader = false });
    private readonly SemaphoreSlim _slots = new(MaxParallelDownloads, MaxParallelDownloads);
    private readonly CancellationTokenSource _shutdown = new();
    private readonly object _itemsLock = new();
    private readonly List<InstallQueueItem> _items = new();
    private Task? _consumer;

    /// <summary>Raised (on the captured context) whenever an item's state/progress changes.</summary>
    public event Action<InstallQueueItem>? ItemUpdated;

    /// <summary>Raised (on the captured context) when a task finishes — success or failure.</summary>
    public event Action<InstallQueueItem, InstallResult>? TaskFinished;

    /// <summary>Live progress of the currently processing task (drives the main-window footer).</summary>
    public event Action<InstallQueueItem, InstallProgress>? Progress;

    /// <summary>The unit of queued work: a live card plus the async pipeline that fulfils it
    /// (a catalog install via the API, or a local .zip/.rar/.7z archive install).</summary>
    private sealed record WorkItem(
        InstallQueueItem Item,
        Func<IProgress<InstallProgress>, CancellationToken, Task<InstallResult>> Run);

    public InstallQueueEngine(InstallService installer)
    {
        _installer = installer;
        _syncContext = SynchronizationContext.Current;
    }

    // ------------------------------------------------------------------- counters

    /// <summary>Snapshot of the live counters: Current (processing), Queue (waiting), Completed (finished).</summary>
    public (int Current, int Queued, int Completed) Counters
    {
        get
        {
            lock (_itemsLock)
            {
                int current = 0, queued = 0, completed = 0;
                foreach (InstallQueueItem item in _items)
                {
                    switch (item.State)
                    {
                        case InstallTaskState.Downloading:
                        case InstallTaskState.Extracting:
                            current++;
                            break;
                        case InstallTaskState.Queued:
                            queued++;
                            break;
                        case InstallTaskState.Completed:
                        case InstallTaskState.Failed:
                            completed++;
                            break;
                    }
                }
                return (current, queued, completed);
            }
        }
    }

    /// <summary>Items whose processing has finished (Completed or Failed).</summary>
    public IReadOnlyList<InstallQueueItem> FinishedItems
    {
        get
        {
            lock (_itemsLock)
                return _items.Where(i => i.State is InstallTaskState.Completed or InstallTaskState.Failed).ToList();
        }
    }

    /// <summary>Drops the given finished items from the engine's bookkeeping (Clear Completed).</summary>
    public void RemoveFinished(IEnumerable<InstallQueueItem> items)
    {
        lock (_itemsLock)
            foreach (InstallQueueItem item in items)
                _items.Remove(item);
    }

    public bool ContainsMod(int modId)
    {
        lock (_itemsLock)
            return _items.Any(i => i.ModId == modId && i.State is InstallTaskState.Queued
                                                 or InstallTaskState.Downloading or InstallTaskState.Extracting);
    }

    // ------------------------------------------------------------------- enqueue

    /// <summary>Pushes a catalog mod installation into the queue; returns the live task card.</summary>
    public InstallQueueItem Enqueue(
        Mod mod, string sptDirectory, string? sptVersion,
        Func<DependencyPrompt, Task<DependencyPromptResult>> promptUser)
    {
        var item = new InstallQueueItem
        {
            ModId = mod.Id,
            ModName = mod.DisplayName,
            PackageId = mod.PackageId,
            Teaser = mod.Teaser,
            State = InstallTaskState.Queued,
            Percent = -1
        };
        return EnqueueItem(item, (progress, ct) =>
            _installer.InstallAsync(mod, sptDirectory, sptVersion, progress, promptUser, ct));
    }

    /// <summary>
    /// Pushes a LOCAL archive install (.zip/.rar/.7z picked from disk) into the queue.
    /// The file is read directly — no download, no temp copy — with the same live progress.
    /// </summary>
    public InstallQueueItem EnqueueLocal(string archivePath, string sptDirectory)
    {
        var item = new InstallQueueItem
        {
            ModId = 0, // local archives have no catalog id
            ModName = Path.GetFileNameWithoutExtension(archivePath),
            PackageId = archivePath,
            Teaser = "Local archive",
            State = InstallTaskState.Queued,
            Percent = -1
        };
        return EnqueueItem(item, (progress, ct) =>
            _installer.InstallLocalArchiveAsync(archivePath, sptDirectory, progress, ct));
    }

    /// <summary>Queues a SPECIFIC release (chosen in the version selection modal).</summary>
    public InstallQueueItem EnqueueVersion(Mod mod, ModVersion version, string sptDirectory, string? sptVersion)
    {
        var item = new InstallQueueItem
        {
            ModId = mod.Id,
            ModName = mod.DisplayName,
            PackageId = mod.PackageId,
            Teaser = $"Version {version.Version}",
            State = InstallTaskState.Queued,
            Percent = -1
        };
        return EnqueueItem(item, (progress, ct) =>
            _installer.InstallVersionAsync(mod, version, sptDirectory, progress, ct));
    }

    /// <summary>Queues a pre-resolved dependency (known download URL) ahead of the mod that needs it.</summary>
    public InstallQueueItem EnqueueResolved(InstallService.ResolvedDependency dep, string sptDirectory)
    {
        var item = new InstallQueueItem
        {
            ModId = dep.Id,
            ModName = dep.Name,
            PackageId = dep.PackageId,
            Teaser = $"Dependency · v{dep.Version}",
            State = InstallTaskState.Queued,
            Percent = -1
        };
        return EnqueueItem(item, (progress, ct) =>
            _installer.InstallResolvedAsync(dep, sptDirectory, progress, ct));
    }

    private InstallQueueItem EnqueueItem(
        InstallQueueItem item, Func<IProgress<InstallProgress>, CancellationToken, Task<InstallResult>> run)
    {
        lock (_itemsLock) _items.Add(item);

        _consumer ??= Task.Run(() => ConsumeLoopAsync(_shutdown.Token));
        _channel.Writer.TryWrite(new WorkItem(item, run));

        Post(() => ItemUpdated?.Invoke(item));
        return item;
    }

    // ------------------------------------------------------------------- consumer

    private async Task ConsumeLoopAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                WorkItem work = await _channel.Reader.ReadAsync(cancellationToken).ConfigureAwait(false);

                // A semaphore-gated slot — this is what caps concurrency at MaxParallelDownloads.
                await _slots.WaitAsync(cancellationToken).ConfigureAwait(false);
                _ = ProcessAsync(work, cancellationToken);
            }
        }
        catch (OperationCanceledException) { }
    }

    private async Task ProcessAsync(WorkItem work, CancellationToken cancellationToken)
    {
        InstallQueueItem item = work.Item;
        try
        {
            if (cancellationToken.IsCancellationRequested)
            {
                SetFailed(item, "Installation cancelled — the application is closing.");
                return;
            }

            var progress = new CallbackProgress(p =>
            {
                // Live mapping: stage → card state + percent/speed/bytes text.
                Post(() =>
                {
                    // Terminal states are final — a late progress report (e.g. a trailing
                    // 100% from the extraction stream) must never resurrect a finished card.
                    if (item.State is InstallTaskState.Completed or InstallTaskState.Failed) return;

                    switch (p.Stage)
                    {
                        case InstallStage.Downloading:
                            item.State = InstallTaskState.Downloading;
                            item.Percent = p.Percent;
                            item.SpeedText = p.SpeedText ?? string.Empty;
                            item.BytesText = p.BytesText ?? string.Empty;   // downloaded MB / total MB
                            break;
                        case InstallStage.Extracting:
                            item.State = InstallTaskState.Extracting;
                            item.Percent = p.Percent;
                            item.SpeedText = string.Empty;
                            item.BytesText = p.BytesText ?? $"{p.Percent:F0}%";
                            break;
                        default:
                            item.Percent = p.Percent;
                            break;
                    }
                    Progress?.Invoke(item, p);
                    ItemUpdated?.Invoke(item);
                });
            });

            InstallResult result = await work.Run(progress, cancellationToken).ConfigureAwait(false);

            if (result.Success)
            {
                item.State = InstallTaskState.Completed;
                item.Percent = 100;
                item.SpeedText = string.Empty;
                item.InstalledVersion = result.InstalledVersion;
                item.CompletedAt = DateTime.Now;
                item.BytesText = string.IsNullOrWhiteSpace(result.InstalledVersion)
                    ? string.Empty
                    : $"v{result.InstalledVersion} installed";
            }
            else
            {
                SetFailed(item, result.Message);
            }

            Post(() => TaskFinished?.Invoke(item, result));
        }
        catch (Exception ex)
        {
            SetFailed(item, $"{ex.GetType().Name}: {ex.Message}");
            Post(() => TaskFinished?.Invoke(item, new InstallResult(false, $"{ex.GetType().Name}: {ex.Message}")));
        }
        finally
        {
            _slots.Release();
        }
    }

    private void SetFailed(InstallQueueItem item, string message)
    {
        Post(() =>
        {
            item.State = InstallTaskState.Failed;
            item.Error = message;
            item.SpeedText = string.Empty;
            item.Percent = 0;
        });
    }

    /// <summary>Marshals an action to the captured context (UI thread in the app; inline otherwise).</summary>
    private void Post(Action action)
    {
        if (_syncContext is not null)
            _syncContext.Post(_ => action(), null);
        else
            action();
    }

    public void Dispose()
    {
        _shutdown.Cancel();
        _channel.Writer.TryComplete();
        _slots.Dispose();
        _shutdown.Dispose();
    }

    /// <summary>IProgress&lt;T&gt; that invokes the callback directly (no captured-context hop of its own).</summary>
    private sealed class CallbackProgress : IProgress<InstallProgress>
    {
        private readonly Action<InstallProgress> _report;
        public CallbackProgress(Action<InstallProgress> report) => _report = report;
        public void Report(InstallProgress value) => _report(value);
    }
}
