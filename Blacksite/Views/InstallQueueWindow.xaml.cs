using System.Windows;
using Blacksite.ViewModels;

namespace Blacksite.Views;

/// <summary>The Installation Queue window: live cards for every queued/running/finished install.</summary>
public partial class InstallQueueWindow : Window
{
    public InstallQueueWindow(InstallQueueViewModel viewModel)
    {
        InitializeComponent();
        DataContext = viewModel;
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();
}
