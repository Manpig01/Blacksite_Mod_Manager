using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Input;

namespace Blacksite.ViewModels;

/// <summary>Minimal INotifyPropertyChanged base — no external MVVM dependency.</summary>
public abstract class ViewModelBase : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

    protected void OnPropertyChanged([CallerMemberName] string? propertyName = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));

    protected bool SetProperty<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return false;
        field = value;
        OnPropertyChanged(propertyName);
        return true;
    }
}

/// <summary>Simple async-aware relay command.</summary>
public sealed class RelayCommand : ICommand
{
    private readonly Func<Task>? _executeAsync;
    private readonly Action? _execute;
    private readonly Func<bool>? _canExecute;
    private bool _isRunning;

    public RelayCommand(Action execute, Func<bool>? canExecute = null)
    {
        _execute = execute;
        _canExecute = canExecute;
    }

    public RelayCommand(Func<Task> executeAsync, Func<bool>? canExecute = null)
    {
        _executeAsync = executeAsync;
        _canExecute = canExecute;
    }

    public event EventHandler? CanExecuteChanged;

    public bool CanExecute(object? parameter) => !_isRunning && (_canExecute?.Invoke() ?? true);

    public void Execute(object? parameter)
    {
        if (_executeAsync is not null)
        {
            if (_isRunning) return;
            _isRunning = true;
            RaiseCanExecuteChanged();
            // Started on the calling (UI) thread: awaits inside the handler resume on the
            // WPF synchronization context, so dialogs/collections stay thread-safe.
            _ = InvokeAsync();
        }
        else
        {
            _execute?.Invoke();
        }
    }

    private async Task InvokeAsync()
    {
        try
        {
            if (_executeAsync is not null) await _executeAsync();
        }
        catch (Exception ex)
        {
            App.LogCrash(ex);
        }
        finally
        {
            _isRunning = false;
            RaiseCanExecuteChanged();
        }
    }

    public void RaiseCanExecuteChanged()
        => CanExecuteChanged?.Invoke(this, EventArgs.Empty);
}
