import React, { useState, useMemo } from 'react';
import {
  X,
  Upload,
  FileCode,
  CheckCircle2,
  AlertTriangle,
  Download,
  Package,
  Layers,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { ModProfile, InstalledMod, BsiteBundleManifest, BsiteImportPreflight, BsiteBundleModEntry } from '../types';
import { profileService } from '../services/profileService';

interface BsiteImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  installedMods: InstalledMod[];
  currentSptVersion: string;
  onImportComplete: (
    newProfile: ModProfile,
    missingModsToDownload: BsiteBundleModEntry[]
  ) => void;
  onShowToast: (title: string, message: string, type: 'success' | 'warning' | 'info') => void;
}

export const BsiteImportModal: React.FC<BsiteImportModalProps> = ({
  isOpen,
  onClose,
  installedMods,
  currentSptVersion,
  onImportComplete,
  onShowToast,
}) => {
  const [inputText, setInputText] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // File input change
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readFile(file);
  };

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setInputText(content);
        setParseError(null);
      }
    };
    reader.onerror = () => {
      setParseError('Failed to read file from disk.');
    };
    reader.readAsText(file);
  };

  // Drag and drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      readFile(e.dataTransfer.files[0]);
    }
  };

  // Attempt to parse manifest
  const parsedManifest = useMemo<BsiteBundleManifest | null>(() => {
    if (!inputText.trim()) {
      setParseError(null);
      return null;
    }
    try {
      const result = profileService.parseBsiteManifest(inputText);
      setParseError(null);
      return result;
    } catch (err: any) {
      setParseError(err.message || 'Failed to parse manifest');
      return null;
    }
  }, [inputText]);

  // Pre-flight check
  const preflight = useMemo<BsiteImportPreflight | null>(() => {
    if (!parsedManifest) return null;
    return profileService.preflightBsiteImport(parsedManifest, currentSptVersion, installedMods);
  }, [parsedManifest, currentSptVersion, installedMods]);

  if (!isOpen) return null;

  const handleExecuteImport = () => {
    if (!parsedManifest || !preflight) return;

    const newProfile = profileService.createProfile(
      parsedManifest.metadata.name,
      parsedManifest.metadata.description,
      {
        enabledModIds: parsedManifest.mods.map((m) => m.id),
        tags: parsedManifest.metadata.tags || ['Imported'],
        bannerColor: '#3B82F6',
        linkedSptProfileName: parsedManifest.metadata.linkedAccountName,
      },
      installedMods
    );

    onImportComplete(newProfile, preflight.missingMods);
    onShowToast(
      'Profile Imported',
      `Imported loadout "${newProfile.name}" with ${parsedManifest.mods.length} mods.`,
      'success'
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
      <div className="bg-[#181B20] border border-[#2B303C] rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#23272E] bg-[#14161B] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-blue-500/15 border border-blue-500/40 flex items-center justify-center">
              <Upload className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#E8EAEE] flex items-center gap-2">
                <span>Import Loadout Bundle or Share Code</span>
                <span className="text-xs px-2 py-0.5 rounded bg-[#20252D] text-[#9AA3AF] font-mono">
                  .bsite / JSON / BS- Code
                </span>
              </h2>
              <p className="text-xs text-[#9AA3AF]">
                Drag and drop a .bsite/.json file or paste a BS- share code or JSON manifest
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#9AA3AF] hover:text-white p-1 rounded hover:bg-[#20252D] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Viewport */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Dropzone */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              dragActive
                ? 'border-[#EA580C] bg-[#EA580C]/10'
                : 'border-[#2B303C] bg-[#121418] hover:border-[#3A4150]'
            }`}
          >
            <input
              type="file"
              id="bsite-file-upload"
              accept=".bsite,.json"
              onChange={handleFileChange}
              className="hidden"
            />
            <Package className="w-8 h-8 text-[#9AA3AF] mx-auto mb-2" />
            <p className="text-xs font-medium text-[#E8EAEE]">
              Drop your <code className="text-[#EA580C]">.bsite</code> or <code className="text-[#EA580C]">.json</code> loadout file here, or{' '}
              <label
                htmlFor="bsite-file-upload"
                className="text-[#EA580C] hover:underline cursor-pointer font-semibold"
              >
                browse files
              </label>
            </p>
            <p className="text-[11px] text-[#6B7480] mt-1">
              Supports Blacksite .bsite bundles, JSON manifests, and compact BS- share codes
            </p>
          </div>

          {/* Paste Area Alternative */}
          <div>
            <label className="block text-xs font-semibold text-[#9AA3AF] mb-1">
              Or Paste Share Code (`BS-...`) or Manifest JSON Directly:
            </label>
            <textarea
              rows={3}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder='Paste BS-... share code or {"formatVersion": "1.0", "manifestType": "blacksite_loadout_bundle", ...}'
              className="w-full bg-[#121418] border border-[#2B303C] rounded px-3 py-2 text-xs font-mono text-[#E8EAEE] focus:outline-none focus:border-[#EA580C] resize-none"
            />
          </div>

          {parseError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded p-3 flex items-center gap-2 text-xs text-red-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Preflight Inspection Card */}
          {preflight && parsedManifest && (
            <div className="bg-[#14161B] border border-[#2B303C] rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-[#23272E] pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>{parsedManifest.metadata.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#20252D] text-[#9AA3AF]">
                      by {parsedManifest.metadata.author}
                    </span>
                  </h3>
                  <p className="text-xs text-[#9AA3AF] mt-0.5">
                    {parsedManifest.metadata.description || 'No description provided.'}
                  </p>
                </div>

                <div className="text-right">
                  <div
                    className={`text-xs font-mono font-semibold px-2 py-0.5 rounded inline-block ${
                      preflight.isVersionMatch
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    }`}
                  >
                    Target SPT {parsedManifest.metadata.targetSptVersion}
                  </div>
                  {!preflight.isVersionMatch && (
                    <div className="text-[10px] text-amber-400 mt-0.5">
                      Current SPT: {currentSptVersion}
                    </div>
                  )}
                </div>
              </div>

              {/* Stats overview */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-[#121418] p-2.5 rounded border border-[#23272E]">
                  <div className="text-[11px] text-[#9AA3AF]">Total Mods</div>
                  <div className="text-base font-bold text-white font-mono">
                    {parsedManifest.mods.length}
                  </div>
                </div>
                <div className="bg-[#121418] p-2.5 rounded border border-[#23272E]">
                  <div className="text-[11px] text-emerald-400">Installed in Library</div>
                  <div className="text-base font-bold text-emerald-400 font-mono">
                    {preflight.installedCount}
                  </div>
                </div>
                <div className="bg-[#121418] p-2.5 rounded border border-[#23272E]">
                  <div className="text-[11px] text-[#EA580C]">Missing to Download</div>
                  <div className="text-base font-bold text-[#EA580C] font-mono">
                    {preflight.missingCount}
                  </div>
                </div>
              </div>

              {/* Missing Mods List if any */}
              {preflight.missingCount > 0 && (
                <div>
                  <div className="text-xs font-semibold text-[#EA580C] mb-1.5 flex items-center justify-between">
                    <span>Missing Mods Required by Loadout</span>
                    <span className="text-[11px] font-normal text-[#9AA3AF]">
                      Will be queued for download from Forge
                    </span>
                  </div>
                  <div className="bg-[#121418] border border-[#23272E] rounded max-h-36 overflow-y-auto divide-y divide-[#1D2128]">
                    {preflight.missingMods.map((m) => (
                      <div key={m.id} className="px-3 py-1.5 flex items-center justify-between text-xs">
                        <span className="text-[#E8EAEE] truncate">{m.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-[#9AA3AF]">v{m.version}</span>
                          <span className="text-[10px] text-[#6B7480] uppercase">{m.kind || 'Mod'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#23272E] bg-[#14161B] flex items-center justify-between shrink-0">
          <div className="text-xs text-[#6B7480]">
            Profile will be added to your local Blacksite loadouts deck.
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="bg-[#20252D] hover:bg-[#282F3A] text-[#9AA3AF] text-xs font-medium px-3 py-1.5 rounded transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleExecuteImport}
              disabled={!parsedManifest || !preflight}
              className="bg-[#EA580C] hover:bg-[#F97316] disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-semibold px-4 py-1.5 rounded flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>
                {preflight && preflight.missingCount > 0
                  ? `Import & Queue ${preflight.missingCount} Missing Downloads`
                  : 'Import & Activate Profile'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
