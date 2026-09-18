using System.Windows;
using Blacksite.ViewModels;

namespace Blacksite.Views;

/// <summary>
/// Version selection modal: lists every published release of a mod (live API data) with metadata
/// badges, interactive changelogs and a per-version Install button.
/// </summary>
public partial class VersionSelectionWindow : Window
{
    private readonly VersionSelectionViewModel _viewModel;

    public VersionSelectionWindow(VersionSelectionViewModel viewModel)
    {
        _viewModel = viewModel;
        DataContext = viewModel;
        InitializeComponent();
        Loaded += async (_, _) => await viewModel.LoadAsync(CancellationToken.None);
    }

    private void OnCloseClick(object sender, RoutedEventArgs e) => Close();
}
