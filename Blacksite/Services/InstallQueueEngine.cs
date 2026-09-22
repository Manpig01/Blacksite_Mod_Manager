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

    /// <summary>How long the dependency prompt may wait for an answer before the default
    /// Cancel is applied (task 6.1, Fix C). Shared by the pre-queue dialog in the UI.</summary>
    public static readonly TimeSpan DefaultPromptTimeout = TimeSpan.FromSeconds(120);

    private readonly InstallService _installer;
    private readonly SynchronizationContext? _syncContext;
    private readonly Channel<WorkItem> _channel =
        Channel.CreateUnbounded<WorkItem>(new UnboundedChannelOptions { SingleReader = false });
    private readonly SemaphoreSlim _slots = new(MaxParallelDownloads, MaxParallelDownloads);
    private readonly CancellationTokenSource _shutdown = new();
    private readonly object _itemsLock = new();
    private readonly List<InstallQueueItem> _items = new();
    private readonly Dictionary<InstallQueueItem, Func<IProgress<InstallProgress>, CancellationToken, Task<InstallResult>>> _runs = new();
    private readonly Dictionary<InstallQueueItem, CancellationTokenSource> _itemCts = new();
    private Task? _consumer;

    /// <summary>Dependency-prompt watchdog (task 6.1, Fix C): the queue never blocks on a
    /// dialog longer than this. Override in tests to keep the suite fast.</summary>
    public TimeSpan PromptTimeout { get; set; } = DefaultPromptTimeout;

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
                        case InstallTaskState.WaitingForUser:
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
            {
                _items.Remove(item);
                _runs.Remove(item);
            }
    }

    /// <summary>
    /// Task 6.1, Fix D — re-enqueues a FAILED item with its original pipeline (same mod, same
    /// version resolution). Returns false when the item is not in the Failed state.
    /// </summary>
    public bool Retry(InstallQueueItem item)
    {
        Func<IProgress<InstallProgress>, CancellationToken, Task<InstallResult>>? run;
        lock (_itemsLock)
        {
            if (item.State != InstallTaskState.Failed) return false;
            run = _runs.TryGetValue(item, out var r) ? r : null;
            if (run is null) return false;
        }

        item.Reset();
        _consumer ??= Task.Run(() => ConsumeLoopAsync(_shutdown.Token));
        _channel.Writer.TryWrite(new WorkItem(item, run));
        Post(() => ItemUpdated?.Invoke(item));
        return true;
    }

    /// <summary>
    /// Task 6.3 — per-item cancellation. Cancelling a QUEUED item fails it immediately (it never
    /// runs); cancelling a busy item cancels its pipeline token, which aborts the download /
    /// extraction / prompt wait cleanly (the item fails with "Installation cancelled." and keeps
    /// its slot accounting intact). Returns false for already-finished items.
    /// </summary>
    public bool Cancel(InstallQueueItem item)
    {
        lock (_itemsLock)
        {
            switch (item.State)
            {
                case InstallTaskState.Queued:
                {
                    // Never started — fail it right here (synchronously, under the lock, so the
                    // consumer's claim check below can never race us back to Queued).
                    _runs.Remove(item);
                    if (_itemCts.TryGetValue(item, out CancellationTokenSource? stale)) { stale.Cancel(); _itemCts.Remove(item); }
                    const string message = "Cancelled — removed from the queue before it started.";
                    item.State = InstallTaskState.Failed;
                    item.Error = message;
                    item.Percent = 0;
                    item.SpeedText = string.Empty;
                    InstallTrace.Stage(item.ModName, "cancelled before start");
                    Post(() => TaskFinished?.Invoke(item, new InstallResult(false, message)));
                    Post(() => ItemUpdated?.Invoke(item));
                    return true;
                }
                case InstallTaskState.Downloading:
                case InstallTaskState.Extracting:
                case InstallTaskState.WaitingForUser:
                    if (_itemCts.TryGetValue(item, out CancellationTokenSource? cts))
                    {
                        InstallTrace.Stage(item.ModName, "cancel requested by user");
                        cts.Cancel();
                        return true;
                    }
                    return false;
                default:
                    return false;
            }
        }
    }

    /// <summary>
    /// Task 6.3 — atomic check-and-enqueue for dependencies: returns null when a card for the
    /// same mod id is already queued/active (shared dependencies like CommonLib are never
    /// downloaded twice), otherwise enqueues and returns the live card. The check and the add
    /// happen under one lock, so two concurrent resolutions can never both enqueue the same dep.
    /// </summary>
    public InstallQueueItem? EnqueueResolvedIfAbsent(InstallService.ResolvedDependency dep, string sptDirectory)
    {
        lock (_itemsLock)
        {
            if (_items.Any(i => i.ModId == dep.Id && i.State is InstallTaskState.Queued
                                                     or InstallTaskState.Downloading
                                                     or InstallTaskState.Extracting
                                                     or InstallTaskState.WaitingForUser))
                return null;
            return EnqueueResolved(dep, sptDirectory); // reentrant lock — check+add stay atomic
        }
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
            ThumbnailUrl = mod.Thumbnail,
            State = InstallTaskState.Queued,
            Percent = -1
        };
        return EnqueueItem(item, (progress, ct) =>
            _installer.InstallAsync(mod, sptDirectory, sptVersion, progress, PromptWithWatchdog(item, promptUser, ct), ct));
    }

    /// <summary>
    /// Task 6.1, Fix C — the queue never blocks invisibly on the dependency dialog:
    /// the card enters <see cref="InstallTaskState.WaitingForUser"/>, the dialog is the UI's
    /// to activate/flash, and an unanswered prompt defaults to Cancel after
    /// <see cref="PromptTimeout"/> with the "Timed out waiting for dependency choice" note.
    /// </summary>
    private Func<DependencyPrompt, Task<DependencyPromptResult>> PromptWithWatchdog(
        InstallQueueItem item, Func<DependencyPrompt, Task<DependencyPromptResult>> promptUser, CancellationToken cancellationToken)
        => async prompt =>
        {
            Post(() =>
            {
                item.SubTask = null;
                item.StatusDetail = null;
                item.State = InstallTaskState.WaitingForUser;
                item.Percent = -1;
            });
            InstallTrace.Prompt(item.ModName, $"shown ({prompt.MissingCount} missing, {prompt.Conflicts.Count} conflicts, {prompt.Unresolved.Count} unresolved)");

            Task<DependencyPromptResult> answer = promptUser(prompt);
            // The wait observes the item's cancellation token: Cancel() aborts it immediately
            // (without the timeout note); an unanswered prompt still defaults to Cancel.
            Task timeout = Task.Delay(PromptTimeout, cancellationToken);
            Task done = await Task.WhenAny(answer, timeout).ConfigureAwait(false);

            if (done != answer && cancellationToken.IsCancellationRequested)
            {
                InstallTrace.Prompt(item.ModName, "cancelled while waiting");
                return DependencyPromptResult.Cancel;
            }

            if (done != answer)
            {
                item.PromptTimedOut = true;
                InstallTrace.Prompt(item.ModName, "TIMEOUT → defaulting to Cancel");
                Post(() => item.StatusDetail = "Timed out waiting for dependency choice");
                return DependencyPromptResult.Cancel;
            }

            DependencyPromptResult result = await answer.ConfigureAwait(false);
            InstallTrace.Prompt(item.ModName, $"answered: {result}");
            Post(() =>
            {
                item.StatusDetail = null;
                item.State = InstallTaskState.Downloading; // indeterminate until the next real progress report
                item.Percent = -1;
            });
            return result;
        };

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
            ThumbnailUrl = mod.Thumbnail,
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
        lock (_itemsLock)
        {
            _items.Add(item);
            _runs[item] = run;
        }

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

        // Task 6.3 — claim the item under the lock: a card cancelled while queued (Cancel marks
        // it Failed synchronously under the same lock) is never started. The claim also registers
        // this item's own cancellation source so Cancel() can abort a running pipeline.
        CancellationTokenSource itemCts;
        lock (_itemsLock)
        {
            if (item.State is InstallTaskState.Completed or InstallTaskState.Failed)
            {
                _slots.Release();
                return;
            }
            itemCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            _itemCts[item] = itemCts;
        }
        cancellationToken = itemCts.Token;

        // Task 6.1, Fix B — route the HTTP pipeline's notices (rate-limit countdowns, retries,
        // resume events) onto the ACTIVE card as its live StatusDetail line.
        void OnNotice(string message) => Post(() =>
        {
            if (item.State is InstallTaskState.Completed or InstallTaskState.Failed) return;
            item.StatusDetail = message;
        });
        _installer.Client.Notice += OnNotice;
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

                    // A sub-task label ("Resolving dependencies (2 found)…", "Dependency 2/3: CommonLib")
                    // rides along every report — null clears it back to the plain state label.
                    item.SubTask = p.SubTask;

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

            // A card cancelled mid-flight (Cancel → token → "Installation cancelled.") already
            // reached its terminal state through SetFailed below — never resurrect it.
            if (item.State is InstallTaskState.Completed or InstallTaskState.Failed)
            {
                Post(() => TaskFinished?.Invoke(item, result));
                return;
            }

            if (result.Success)
            {
                Post(() =>
                {
                    item.SubTask = null;
                    item.StatusDetail = null;
                });
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
                // Fix C: make the auto-cancelled prompt unmistakable on the card.
                if (item.PromptTimedOut && !string.IsNullOrEmpty(item.Error))
                    Post(() => item.Error = "Timed out waiting for dependency choice — nothing was installed. " + item.Error);
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
            _installer.Client.Notice -= OnNotice;
            lock (_itemsLock)
            {
                if (_itemCts.TryGetValue(item, out CancellationTokenSource? registered) && ReferenceEquals(registered, itemCts))
                    _itemCts.Remove(item);
            }
            itemCts.Dispose();
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
