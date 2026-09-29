using System.Windows;
using System.Windows.Controls;
using Blacksite.ViewModels;
using Blacksite.Views;

namespace Blacksite;

public partial class MainWindow : Window
{
    private readonly MainViewModel _viewModel;
    private InstallQueueWindow? _queueWindow;
    private bool _initialized;

    public MainWindow()
    {
        InitializeComponent();
        _viewModel = new MainViewModel();
        DataContext = _viewModel;

        Loaded += OnMainWindowLoaded;
        Closing += (_, _) =>
        {
            _queueWindow?.Close();
            _viewModel.Shutdown();
        };

        // "Open installation queue" → show (or reactivate) the queue window.
        _viewModel.OpenQueueWindowRequested += OpenQueueWindow;
        _viewModel.VersionSelectionRequested += vm =>
        {
            var window = new Views.VersionSelectionWindow(vm) { Owner = this };
            window.ShowDialog(); // modal — the version picker blocks the main window while open
        };
    }

    /// <summary>Single-instance Installation Queue window — a modeless owned child so the
    /// catalog stays interactive while installs stream their live progress.</summary>
    private void OpenQueueWindow()
    {
        // Task 6.3 — the footer button TOGGLES the queue window from any tab:
        // closed → open; open but not focused → bring to front; focused → close.
        if (_queueWindow is null || !_queueWindow.IsLoaded)
        {
            _queueWindow = new InstallQueueWindow(_viewModel.QueueViewModel) { Owner = this };
            _queueWindow.Show();
        }
        else if (_queueWindow.IsActive)
        {
            _queueWindow.Close();
        }
        else
        {
            _queueWindow.Activate();
        }
    }

    private async void OnMainWindowLoaded(object sender, RoutedEventArgs e)
    {
        if (_initialized) return;
        _initialized = true;
        try
        {
            await _viewModel.InitializeAsync();
        }
        catch (Exception ex)
        {
            App.LogCrash(ex);
        }
    }

    /// <summary>Fired when a card container is materialized by the virtualizing panel — kicks off lazy thumbnail loading.</summary>
    private void Card_Loaded(object sender, RoutedEventArgs e)
    {
        if ((sender as FrameworkElement)?.DataContext is ModCardViewModel card)
        {
            card.EnsureThumbnailRequested();
            card.EnsureVersionInfoRequested(); // latest version + SPT badge (real versions API)
        }
    }

    /// <summary>Keeps the Browse grid at 3 columns: cards stretch to one third of the viewport width
    /// (compact fixed-height cards — the grid grows downward, never sideways).</summary>
    private void OnCardsListSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (sender is not ListBox list) return;
        double cardWidth = (list.ActualWidth - 8 /*list padding*/ - 2 * 12 /*two inter-card gaps*/) / 3 - 12 /*card margin+padding slack*/;
        _viewModel.CardWidth = Math.Max(360, Math.Min(560, cardWidth));
    }

    // ------------------------------------------------------------ custom window chrome (WindowStyle=None)

    private void OnTitleBarMouseLeftButtonDown(object sender, System.Windows.Input.MouseButtonEventArgs e)
    {
        if (e.ClickCount == 2)
        {
            ToggleMaximizeRestore();
            return;
        }
        if (e.ButtonState == System.Windows.Input.MouseButtonState.Pressed)
            DragMove();
    }

    private void OnMinimizeClick(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

    private void OnMaximizeRestoreClick(object sender, RoutedEventArgs e) => ToggleMaximizeRestore();

    private void OnCloseClick(object sender, RoutedEventArgs e) => Close();

    private void ToggleMaximizeRestore() =>
        WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

    /// <summary>Sort headers: a click on an Installed-Mods column header cycles that column ascending/descending.</summary>
    /// <summary>
    /// Responsive installed-mods list: the Mod column absorbs the remaining viewport width so the
    /// row (incl. the Actions buttons) always fits — no horizontal overflow at any window size.
    /// </summary>
    /// <summary>Keeps the installed grid at 3 columns: cards stretch to one third of the viewport
    /// width — identical geometry to the Browse grid (unified card design).</summary>
    private void OnInstalledListSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (sender is not ListBox list) return;
        double cardWidth = (list.ActualWidth - 8 /*list padding*/ - 2 * 12 /*two inter-card gaps*/) / 3 - 12 /*card margin+padding slack*/;
        _viewModel.InstalledCardWidth = Math.Max(360, Math.Min(560, cardWidth));
    }

    /// <summary>Installed card materialized — request its web thumbnail + version badges (once).</summary>
    private void InstalledCard_Loaded(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: InstalledModViewModel row })
            row.EnsureCardArtRequested();
    }
}
