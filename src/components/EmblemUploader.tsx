import React, { useState, useRef, useEffect } from 'react';
import { Upload, Check, RefreshCw, Image as ImageIcon, Shield } from 'lucide-react';

interface EmblemUploaderProps {
  onShowToast?: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
  compact?: boolean;
}

export const EmblemUploader: React.FC<EmblemUploaderProps> = ({ onShowToast, compact = false }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [previewTimestamp, setPreviewTimestamp] = useState(Date.now());
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleUpdate = () => setPreviewTimestamp(Date.now());
    window.addEventListener('emblem-updated', handleUpdate);
    return () => window.removeEventListener('emblem-updated', handleUpdate);
  }, []);

  const handleFileProcess = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      onShowToast?.('Invalid File', 'Please select a PNG or JPG image.', 'warning');
      return;
    }

    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        try {
          const res = await fetch('/api/upload-emblem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl }),
          });

          if (res.ok) {
            setPreviewTimestamp(Date.now());
            window.dispatchEvent(new CustomEvent('emblem-updated'));
            onShowToast?.(
              'Emblem Updated Successfully',
              `Applied "${file.name}" as the new titlebar and taskbar icon!`,
              'success'
            );
          } else {
            const errData = await res.json().catch(() => ({}));
            onShowToast?.('Upload Failed', errData.error || 'Server error saving emblem', 'error');
          }
        } catch (netErr: any) {
          onShowToast?.('Upload Error', netErr.message || 'Network error', 'error');
        } finally {
          setIsUploading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setIsUploading(false);
      onShowToast?.('Error Reading File', err.message, 'error');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileProcess(e.dataTransfer.files[0]);
    }
  };

  const handleCheckDisk = async () => {
    setIsUploading(true);
    try {
      const res = await fetch('/api/check-uploaded-emblem');
      const data = await res.json();
      if (data.found) {
        setPreviewTimestamp(Date.now());
        window.dispatchEvent(new CustomEvent('emblem-updated'));
        onShowToast?.('Emblem Synced', 'Found Blacksite Mod Manager Emblem.png and updated icons!', 'success');
      } else {
        onShowToast?.(
          'File Not Found on Disk',
          'Drag and drop your "Blacksite Mod Manager Emblem.png" directly into the box below to apply it.',
          'info'
        );
      }
    } catch (e: any) {
      onShowToast?.('Check Error', e.message, 'error');
    } finally {
      setIsUploading(false);
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) handleFileProcess(e.target.files[0]);
          }}
        />
        <img
          src={`/emblem.png?t=${previewTimestamp}`}
          alt="Emblem Preview"
          className="w-10 h-10 object-contain drop-shadow rounded bg-[#101215] p-1 border border-[#2B303C]"
        />
        <button
          type="button"
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
          className="px-3 py-1.5 text-xs font-semibold bg-[#20252D] hover:bg-[#2A313C] text-[#E8EAEE] border border-[#2B303C] rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          {isUploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#EA580C]" /> : <Upload className="w-3.5 h-3.5 text-[#EA580C]" />}
          Change Icon (.png)
        </button>
      </div>
    );
  }

  return (
    <div className="bg-[#181B20] border border-[#23272E] rounded-xl p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#121418] border border-[#2A2F38] flex items-center justify-center text-[#EA580C]">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#E8EAEE]">Application Emblem & Taskbar Icon</h3>
            <p className="text-xs text-[#9AA3AF]">
              Custom icon for the titlebar, browser favicon, and Windows taskbar executable (.ico).
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleCheckDisk}
          disabled={isUploading}
          className="text-xs text-[#9AA3AF] hover:text-[#EA580C] flex items-center gap-1 py-1 px-2.5 rounded bg-[#20252D] border border-[#2A303A] cursor-pointer transition-colors"
          title="Scan workspace for Blacksite Mod Manager Emblem.png"
        >
          <RefreshCw className={`w-3 h-3 ${isUploading ? 'animate-spin text-[#EA580C]' : ''}`} />
          Scan Workspace
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-4 items-center">
        {/* Preview Container */}
        <div className="flex flex-col items-center justify-center bg-[#121418] border border-[#2A2F38] rounded-xl p-3.5 text-center">
          <div className="relative group mb-2">
            <img
              src={`/emblem.png?t=${previewTimestamp}`}
              alt="Active Blacksite Emblem"
              className="w-20 h-20 object-contain drop-shadow transition-transform group-hover:scale-105"
            />
          </div>
          <span className="text-[10px] font-mono text-[#9AA3AF] uppercase tracking-wider">Active Icon</span>
          <span className="text-[9px] text-[#EA580C] font-semibold">512x512 / .ICO</span>
        </div>

        {/* Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-5 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
            isDragOver
              ? 'border-[#EA580C] bg-[#EA580C]/10 scale-[1.01]'
              : 'border-[#2A303C] hover:border-[#EA580C]/60 bg-[#14161B] hover:bg-[#1A1D23]'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) handleFileProcess(e.target.files[0]);
            }}
          />

          <div className="w-10 h-10 rounded-full bg-[#20252D] border border-[#2B303C] flex items-center justify-center text-[#EA580C] mb-2.5">
            {isUploading ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <Upload className="w-5 h-5" />
            )}
          </div>

          <div className="text-xs font-semibold text-[#E8EAEE] mb-1">
            {isUploading ? 'Processing & Generating Windows .ICO...' : 'Drag & drop "Blacksite Mod Manager Emblem.png" here'}
          </div>
          <p className="text-[11px] text-[#9AA3AF]">
            or click to browse from your computer. PNG or JPG (high-res recommended).
          </p>
        </div>
      </div>
    </div>
  );
};
