using System.Windows;

namespace Blacksite.Views;

/// <summary>Theme-consistent replacement for MessageBox (info / error / yes-no confirm).</summary>
public partial class MessageDialog : Window
{
    public bool Confirmed { get; private set; }

    private MessageDialog(string title, string message, bool yesNo, bool isError)
    {
        InitializeComponent();
        Title = title;
        TitleText.Text = title;
        MessageText.Text = message;
        IconText.Text = isError ? "⛔" : yesNo ? "❓" : "ℹ️";

        if (yesNo)
        {
            OkButton.Visibility = Visibility.Collapsed;
            YesButton.Visibility = Visibility.Visible;
            NoButton.Visibility = Visibility.Visible;
        }
    }

    public static void Show(string title, string message, bool isError = false)
    {
        var dialog = new MessageDialog(title, message, yesNo: false, isError);
        AttachOwner(dialog);
        dialog.ShowDialog();
    }

    public static bool Confirm(string title, string message)
    {
        var dialog = new MessageDialog(title, message, yesNo: true, isError: false);
        AttachOwner(dialog);
        dialog.ShowDialog();
        return dialog.Confirmed;
    }

    private static void AttachOwner(Window dialog)
    {
        try
        {
            Window? owner = Application.Current?.MainWindow;
            if (owner is not null && owner.IsLoaded && !ReferenceEquals(owner, dialog))
                dialog.Owner = owner;
            else
                dialog.WindowStartupLocation = WindowStartupLocation.CenterScreen;
        }
        catch (InvalidOperationException)
        {
            dialog.WindowStartupLocation = WindowStartupLocation.CenterScreen;
        }
    }

    private void Ok_Click(object sender, RoutedEventArgs e) => Close();

    private void Yes_Click(object sender, RoutedEventArgs e)
    {
        Confirmed = true;
        Close();
    }

    private void No_Click(object sender, RoutedEventArgs e)
    {
        Confirmed = false;
        Close();
    }
}
