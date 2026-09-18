using System.Collections.ObjectModel;
using System.IO;
using System.Windows.Input;
using Blacksite.Services;

namespace Blacksite.ViewModels;

/// <summary>
/// View model of the in-app "Edit Configs" modal: lists the mod's real config files
/// (.json/.jsonc/.cfg/.yaml discovered on disk) and edits the selected one with direct
/// save-back to the file.
/// </summary>
public sealed class ConfigEditorViewModel : ViewModelBase
{
    private readonly string _modPath;
    private ModConfigFile? _selectedFile;
    private string _fileText = string.Empty;
    private string _loadedText = string.Empty;
    private bool _isLoading;

    public ConfigEditorViewModel(string modName, string modPath)
    {
        ModName = modName;
        _modPath = modPath;
        SaveCommand = new RelayCommand(() => _ = SaveAsync(), () => IsDirty && !IsLoading);
        CloseCommand = new RelayCommand(() => CloseRequested?.Invoke());
    }

    public string ModName { get; }

    /// <summary>Fired when the user clicks Close (after dirty confirmation, if needed).</summary>
    public event Action? CloseRequested;

    public ObservableCollection<ModConfigFile> Files { get; } = new();

    public ICommand SaveCommand { get; }
    public ICommand CloseCommand { get; }

    public ModConfigFile? SelectedFile
    {
        get => _selectedFile;
        set
        {
            if (SetProperty(ref _selectedFile, value))
                _ = LoadSelectedAsync();
        }
    }

    public bool IsLoading
    {
        get => _isLoading;
        private set => SetProperty(ref _isLoading, value);
    }

    public string FileText
    {
        get => _fileText;
        set
        {
            if (SetProperty(ref _fileText, value))
            {
                OnPropertyChanged(nameof(IsDirty));
                OnPropertyChanged(nameof(DirtyText));
                ((RelayCommand)SaveCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool IsDirty => !IsLoading && !string.Equals(FileText, _loadedText, StringComparison.Ordinal);

    public string DirtyText => IsDirty ? "● unsaved changes" : string.Empty;

    public string ActivePathText => _selectedFile?.FullPath ?? "No file selected";

    public bool HasNoFiles => Files.Count == 0 && !IsLoading;

    public string EmptyText => Files.Count == 0
        ? $"No config files (.json / .jsonc / .cfg / .yaml) were found in “{ModName}”."
        : "Select a file on the left to edit it.";

    /// <summary>Live discovery of the mod's config files (called once when the window opens).</summary>
    public async Task LoadAsync()
    {
        IsLoading = true;
        List<ModConfigFile> files = await Task.Run(() => ModConfigService.FindConfigFiles(_modPath));
        Files.Clear();
        foreach (ModConfigFile file in files) Files.Add(file);
        OnPropertyChanged(nameof(EmptyText));
        OnPropertyChanged(nameof(HasNoFiles));
        SelectedFile = Files.Count > 0 ? Files[0] : null;
        IsLoading = false;
        OnPropertyChanged(nameof(HasNoFiles));
        OnPropertyChanged(nameof(IsDirty));
    }

    private async Task LoadSelectedAsync()
    {
        if (_selectedFile is null)
        {
            _fileText = _loadedText = string.Empty;
            OnPropertyChanged(nameof(FileText));
            OnPropertyChanged(nameof(IsDirty));
            OnPropertyChanged(nameof(ActivePathText));
            OnPropertyChanged(nameof(DirtyText));
            return;
        }

        IsLoading = true;
        try
        {
            string text = await Task.Run(() => ModConfigService.ReadText(_selectedFile.FullPath));
            _loadedText = text;
            FileText = text; // raises IsDirty/DirtyText
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _loadedText = FileText = $"[could not read {_selectedFile.RelativePath}: {ex.Message}]";
        }
        finally
        {
            IsLoading = false;
            OnPropertyChanged(nameof(ActivePathText));
            OnPropertyChanged(nameof(IsDirty));
            OnPropertyChanged(nameof(DirtyText));
            ((RelayCommand)SaveCommand).RaiseCanExecuteChanged();
        }
    }

    /// <summary>Writes the edited text directly back to the active file on disk.</summary>
    public async Task<bool> SaveAsync()
    {
        if (_selectedFile is null || IsLoading) return false;
        try
        {
            string text = FileText;
            await Task.Run(() => ModConfigService.WriteText(_selectedFile.FullPath, text));
            _loadedText = text;
            OnPropertyChanged(nameof(IsDirty));
            OnPropertyChanged(nameof(DirtyText));
            ((RelayCommand)SaveCommand).RaiseCanExecuteChanged();
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }
}
