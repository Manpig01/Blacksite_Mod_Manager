import React, { useState, useEffect } from 'react';
import { X, Save, History, RotateCcw, AlertTriangle, FileCode, Check } from 'lucide-react';
import { InstalledMod, ConfigFile } from '../types';

interface ConfigEditorModalProps {
  mod: InstalledMod | null;
  isOpen: boolean;
  onClose: () => void;
  onSaveConfigFile: (modId: string, fileId: string, newContent: string) => void;
  onShowToast: (title: string, message: string, type: 'success' | 'info' | 'warning' | 'error') => void;
}

export const ConfigEditorModal: React.FC<ConfigEditorModalProps> = ({
  mod,
  isOpen,
  onClose,
  onSaveConfigFile,
  onShowToast,
}) => {
  const [selectedFileId, setSelectedFileId] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [hasDirtyState, setHasDirtyState] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showBackups, setShowBackups] = useState<boolean>(false);

  useEffect(() => {
    if (mod && mod.configFiles.length > 0) {
      const first = mod.configFiles[0];
      setSelectedFileId(first.id);
      setContent(first.content);
      setHasDirtyState(false);
      setValidationError(null);
    }
  }, [mod]);

  if (!isOpen || !mod) return null;

  const activeFile = mod.configFiles.find((f) => f.id === selectedFileId) || mod.configFiles[0];

  const handleSelectFile = (file: ConfigFile) => {
    if (hasDirtyState) {
      if (!confirm('You have unsaved changes in the current file. Discard and switch?')) {
        return;
      }
    }
    setSelectedFileId(file.id);
    setContent(file.content);
    setHasDirtyState(false);
    setValidationError(null);
    setShowBackups(false);
  };

  const handleContentChange = (newText: string) => {
    setContent(newText);
    setHasDirtyState(newText !== (activeFile?.content || ''));

    // Validate JSON if relevant
    if (activeFile?.fileType === 'json') {
      try {
        JSON.parse(newText);
        setValidationError(null);
      } catch (err: any) {
        setValidationError(err.message);
      }
    } else {
      setValidationError(null);
    }
  };

  const handleSave = () => {
    if (!activeFile) return;

    if (validationError) {
      if (!confirm(`JSON syntax warning:\n${validationError}\n\nForce save anyway?`)) {
        return;
      }
    }

    onSaveConfigFile(mod.id, activeFile.id, content);
    setHasDirtyState(false);
    onShowToast('Config Saved', `Successfully updated ${activeFile.fileName} with automatic backup created.`, 'success');
  };

  const handleRestoreBackup = (backupContent: string) => {
    setContent(backupContent);
    setHasDirtyState(true);
    setShowBackups(false);
    onShowToast('Backup Restored', 'Restored configuration from previous backup snapshot. Click Save to commit.', 'info');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-[#181B20] border border-[#2A2F38] rounded-xl w-full max-w-4xl h-[85vh] flex flex-col shadow-2xl animate-fade-in overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#23272E] flex items-center justify-between select-none">
          <div className="flex items-center gap-2.5">
            <FileCode className="w-5 h-5 text-[#EA580C]" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[#E8EAEE]">Config Editor: {mod.name}</h2>
                {hasDirtyState && (
                  <span className="text-[10px] bg-[#F59E0B] text-black font-bold px-1.5 py-0.5 rounded">
                    UNSAVED CHANGES
                  </span>
                )}
              </div>
              <p className="text-xs text-[#9AA3AF] font-mono">{activeFile?.relativePath}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowBackups(!showBackups)}
              className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] text-xs px-3 py-1.5 rounded-md border border-[#2A2F38] flex items-center gap-1.5 transition-colors cursor-pointer"
              title="View and restore timestamped backups"
              type="button"
            >
              <History className="w-3.5 h-3.5 text-[#9AA3AF]" />
              <span>Backups ({activeFile?.backups?.length || 0})</span>
            </button>

            <button
              onClick={handleSave}
              disabled={!hasDirtyState}
              className="bg-[#16A34A] hover:bg-[#22C55E] disabled:opacity-40 text-white text-xs font-semibold px-4 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer disabled:cursor-not-allowed shadow-sm"
              type="button"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save</span>
            </button>

            <button
              onClick={onClose}
              className="text-[#9AA3AF] hover:text-white p-1 hover:bg-[#20252D] rounded transition-colors cursor-pointer ml-1"
              type="button"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* File tabs row */}
        <div className="bg-[#121418] border-b border-[#23272E] px-4 py-1 flex items-center gap-2 overflow-x-auto">
          {mod.configFiles.map((file) => (
            <button
              key={file.id}
              onClick={() => handleSelectFile(file)}
              className={`px-3 py-1.5 rounded text-xs font-mono transition-colors flex items-center gap-1.5 cursor-pointer ${
                file.id === activeFile?.id
                  ? 'bg-[#20252D] text-[#EA580C] font-semibold border-b-2 border-[#EA580C]'
                  : 'text-[#9AA3AF] hover:text-[#E8EAEE] hover:bg-[#181B20]'
              }`}
              type="button"
            >
              <span>{file.fileName}</span>
            </button>
          ))}
        </div>

        {/* Validation warning banner */}
        {validationError && (
          <div className="bg-[#3A2A10] border-b border-[#F59E0B]/40 px-4 py-2 flex items-center gap-2 text-xs text-[#F59E0B]">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="font-mono truncate">{validationError}</span>
          </div>
        )}

        {/* Backups drawer */}
        {showBackups && (
          <div className="bg-[#0E1013] border-b border-[#23272E] p-3 max-h-48 overflow-y-auto space-y-2">
            <span className="text-xs font-bold text-[#E8EAEE] block">
              Historical Backups for {activeFile?.fileName}:
            </span>
            {activeFile?.backups && activeFile.backups.length > 0 ? (
              activeFile.backups.map((b, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between bg-[#181B20] p-2 rounded border border-[#23272E] text-xs"
                >
                  <span className="font-mono text-[#9AA3AF]">
                    {new Date(b.timestamp).toLocaleString()} ({b.content.length} bytes)
                  </span>
                  <button
                    onClick={() => handleRestoreBackup(b.content)}
                    className="bg-[#20252D] hover:bg-[#16A34A] text-[#E8EAEE] px-2 py-1 rounded text-xs flex items-center gap-1 cursor-pointer"
                    type="button"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Restore</span>
                  </button>
                </div>
              ))
            ) : (
              <p className="text-xs text-[#6B7480]">No previous backups recorded for this file.</p>
            )}
          </div>
        )}

        {/* Editor Body */}
        <div className="flex-1 bg-[#0E1013] p-4 font-mono text-[13px] overflow-hidden flex flex-col">
          <textarea
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            spellCheck={false}
            className="w-full flex-1 bg-transparent text-[#E8EAEE] font-mono leading-relaxed resize-none focus:outline-none focus:ring-0 select-text"
          />
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-[#121418] border-t border-[#23272E] flex items-center justify-between text-xs text-[#9AA3AF]">
          <span>Format: {activeFile?.fileType.toUpperCase()}</span>
          <span>{content.split('\n').length} lines · {content.length} characters</span>
        </div>
      </div>
    </div>
  );
};
