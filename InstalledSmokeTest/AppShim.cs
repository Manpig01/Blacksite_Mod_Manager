using System;

// Compile-time shim for the WPF app shell: the REAL Mvvm.cs routes unhandled async command
// exceptions to App.LogCrash (App.xaml.cs — a WPF Application class that cannot be compiled
// into a console harness). The harness logs them to stderr instead; no behavior under test
// is stubbed (commands still execute for real).
namespace Blacksite;

internal static class App
{
    internal static void LogCrash(Exception ex) =>
        Console.Error.WriteLine($"[harness] unhandled command exception: {ex.GetType().Name}: {ex.Message}");
}
