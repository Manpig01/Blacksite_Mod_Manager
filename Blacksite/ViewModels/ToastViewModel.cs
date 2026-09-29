namespace Blacksite.ViewModels;

/// <summary>One bottom-right toast notification. Auto-dismissal (3.5 s) is owned by MainViewModel.</summary>
public sealed class ToastViewModel : ViewModelBase
{
    public ToastViewModel(string title, string message)
    {
        Title = title;
        Message = message;
    }

    public string Title { get; }
    public string Message { get; }
}
