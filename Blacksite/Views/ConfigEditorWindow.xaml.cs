using System.ComponentModel;
using System.Windows;
using Blacksite.ViewModels;

namespace Blacksite.Views;

/// <summary>
/// In-app mod config editor modal: sidebar of the mod's real config files (recursive scan for
/// .json/.jsonc/.cfg/.yaml), a large scrollable text editor, and direct save-back to disk.
/// </summary>
public partial class ConfigEditorWindow : Window
{
    private readonly ConfigEditorViewModel _viewModel;

    public ConfigEditorWindow(ConfigEditorViewModel viewModel)
    {
        _viewModel = viewModel;
        DataContext = viewModel;
        InitializeComponent();

        Loaded += async (_, _) => await viewModel.LoadAsync();
        viewModel.CloseRequested += OnCloseRequested;
        Closing += OnClosing;
    }

    private void OnCloseRequested() => Close();

    private void OnClosing(object? sender, CancelEventArgs e)
    {
        if (_viewModel.IsDirty)
        {
            // Unsaved changes — confirm before discarding (the file on disk is untouched otherwise).
            bool discard = MessageDialog.Confirm("Unsaved changes",
                $"“{System.IO.Path.GetFileName(_viewModel.ActivePathText)}” has unsaved changes.\n\nClose anyway and discard your edits?");
            if (!discard)
            {
                e.Cancel = true;
                return;
            }
        }

        _viewModel.CloseRequested -= OnCloseRequested;
        Closing -= OnClosing;
    }
}
