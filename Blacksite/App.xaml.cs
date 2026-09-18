using System.IO;
using System.Windows;
using System.Windows.Threading;
using Blacksite.Views;

namespace Blacksite;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // Never crash out silently — surface unexpected errors and log them next to the settings.
        DispatcherUnhandledException += (_, args) =>
        {
            LogCrash(args.Exception);
            TryShowError("Unexpected error", args.Exception);
            args.Handled = true;
        };

        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
        {
            if (args.ExceptionObject is Exception ex) LogCrash(ex);
        };

        TaskScheduler.UnobservedTaskException += (_, args) =>
        {
            LogCrash(args.Exception);
            args.SetObserved();
        };
    }

    private static void TryShowError(string title, Exception ex)
    {
        try
        {
            MessageDialog.Show(title, $"An unexpected error occurred:\n\n{DescribeDeep(ex)}", isError: true);
        }
        catch (Exception)
        {
            MessageBox.Show(ex.ToString(), title, MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    /// <summary>
    /// Unwraps the whole exception chain — the outermost message (e.g. a XAML wrapper like
    /// "Provide value on … threw an exception") rarely names the real cause; the innermost
    /// exception does. Details are also appended to crash.log next to the settings file.
    /// </summary>
    private static string DescribeDeep(Exception ex)
    {
        var text = new System.Text.StringBuilder();
        Exception? current = ex;
        for (int depth = 0; current is not null && depth < 6; depth++)
        {
            if (depth > 0) text.Append("\n → inner: ");
            text.Append(depth == 0 ? current.Message : $"{current.GetType().Name}: {current.Message}");
            current = current.InnerException;
        }
        text.Append("\n\nFull details were written to %AppData%\\BlacksiteModManager\\crash.log");
        return text.ToString();
    }

    internal static void LogCrash(Exception ex)
    {
        try
        {
            string dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "BlacksiteModManager");
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, "crash.log"),
                $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} | {ex}{Environment.NewLine}{Environment.NewLine}");
        }
        catch (Exception)
        {
            // Logging is best-effort.
        }
    }
}
