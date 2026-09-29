using System.Windows;
using System.Windows.Controls;
using Blacksite.Services;

namespace Blacksite.Views;

/// <summary>
/// Shown when the API reports unresolved dependencies for the selected mod.
/// Lets the user choose: install dependencies first, install the mod anyway, or cancel.
/// </summary>
public partial class DependencyDialog : Window
{
    public DependencyPromptResult Result { get; private set; } = DependencyPromptResult.Cancel;

    public DependencyDialog(DependencyPrompt prompt)
    {
        InitializeComponent();
        DataContext = prompt;
        Title = $"Dependencies — {prompt.ModName}";
        Loaded += (_, _) =>
        {
            // Nothing auto-installable (only conflicts/unresolved) → the green button has nothing to queue.
            if (!prompt.HasAutoInstallable && FindName("InstallAllButton") is Button b) b.IsEnabled = false;
        };
    }

    private void InstallAll_Click(object sender, RoutedEventArgs e)
    {
        Result = DependencyPromptResult.InstallWithDeps;
        Close();
    }

    private void InstallModOnly_Click(object sender, RoutedEventArgs e)
    {
        Result = DependencyPromptResult.InstallModOnly;
        Close();
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        Result = DependencyPromptResult.Cancel;
        Close();
    }
}
