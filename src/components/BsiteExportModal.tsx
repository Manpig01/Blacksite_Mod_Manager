import React, { useState, useMemo } from 'react';
import {
  X,
  Download,
  Copy,
  Check,
  Package,
  Layers,
  FileCode,
  ShieldCheck,
  Tag,
  Settings,
} from 'lucide-react';
import { ModProfile, InstalledMod, BsiteBundleManifest } from '../types';
import { profileService } from '../services/profileService';

interface BsiteExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: ModProfile;
  installedMods: InstalledMod[];
  currentSptVersion: string;
  onShowToast: (title: string, message: string, type: 'success' | 'warning' | 'info') => void;
}

export const BsiteExportModal: React.FC<BsiteExportModalProps> = ({
  isOpen,
  onClose,
  profile,
  installedMods,
  currentSptVersion,
  onShowToast,
}) => {
  const [authorName, setAuthorName] = useState('Operator');
  const [description, setDescription] = useState(profile.description || '');
  const [targetSptVersion, setTargetSptVersion] = useState(currentSptVersion || '4.1.6');
  const [includeConfigs, setIncludeConfigs] = useState(true);
  const [tagsInput, setTagsInput] = useState((profile.tags || ['Tactical']).join(', '));
  const [copied, setCopied] = useState(false);

  // Active mods in this profile
  const activeMods = useMemo(() => {
    const set = new Set(profile.enabledModIds.map((id) => id.toLowerCase()));
    return installedMods.filter((m) => set.has(m.id.toLowerCase()));
  }, [profile, installedMods]);

  // Compiled manifest
  const manifest = useMemo<BsiteBundleManifest>(() => {
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const generated = profileService.generateBsiteManifest(
      {
        ...profile,
        description,
        tags,
      },
      installedMods,
      targetSptVersion,
      authorName,
      includeConfigs
    );

    return generated;
  }, [profile, installedMods, targetSptVersion, authorName, description, tagsInput, includeConfigs]);

  if (!isOpen) return null;

  const handleDownloadFile = () => {
    profileService.exportBsiteFile(manifest, `${profile.name}-loadout`);
    onShowToast('Bundle Exported', `Saved "${profile.name}.bsite" manifest bundle.`, 'success');
    onClose();
  };

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(manifest, null, 2));
      setCopied(true);
      onShowToast('Copied to Clipboard', 'Raw .bsite JSON manifest copied.', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onShowToast('Clipboard Error', 'Failed to copy to clipboard.', 'warning');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
      <div className="bg-[#181B20] border border-[#2B303C] rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#23272E] bg-[#14161B] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#EA580C]/15 border border-[#EA580C]/40 flex items-center justify-center">
              <Package className="w-4 h-4 text-[#EA580C]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#E8EAEE] flex items-center gap-2">
                <span>Export .bsite Loadout Bundle</span>
                <span className="text-xs px-2 py-0.5 rounded bg-[#EA580C]/20 text-[#EA580C] font-mono">
                  {profile.name}
                </span>
              </h2>
              <p className="text-xs text-[#9AA3AF]">
                Create a portable, lightweight manifest file for sharing or archiving
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

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#9AA3AF] mb-1">
                Author Handle / Callsign
              </label>
              <input
                type="text"
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                placeholder="e.g. Ghost_PMC"
                className="w-full bg-[#121418] border border-[#2B303C] rounded px-3 py-1.5 text-xs text-[#E8EAEE] focus:outline-none focus:border-[#EA580C]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#9AA3AF] mb-1">
                Target SPT Version
              </label>
              <input
                type="text"
                value={targetSptVersion}
                onChange={(e) => setTargetSptVersion(e.target.value)}
                placeholder="e.g. 4.1.6"
                className="w-full bg-[#121418] border border-[#2B303C] rounded px-3 py-1.5 text-xs text-[#E8EAEE] focus:outline-none focus:border-[#EA580C]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#9AA3AF] mb-1">
              Tactical Description & Loadout Notes
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Explain gameplay focus, recommended SPT settings, or required configs..."
              className="w-full bg-[#121418] border border-[#2B303C] rounded px-3 py-1.5 text-xs text-[#E8EAEE] focus:outline-none focus:border-[#EA580C] resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#9AA3AF] mb-1">
              Search Tags (comma-separated)
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. Hardcore, Combat AI, Performance"
              className="w-full bg-[#121418] border border-[#2B303C] rounded px-3 py-1.5 text-xs text-[#E8EAEE] focus:outline-none focus:border-[#EA580C]"
            />
          </div>

          {/* Config Inclusion Checkbox */}
          <div className="bg-[#121418] border border-[#23272E] rounded p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-[#EA580C]" />
              <div>
                <div className="text-xs font-semibold text-[#E8EAEE]">
                  Include User Configuration Diffs
                </div>
                <div className="text-[11px] text-[#6B7480]">
                  Deep-merges customized JSON/INI settings so recipient gets your exact bot & server tuning
                </div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={includeConfigs}
              onChange={(e) => setIncludeConfigs(e.target.checked)}
              className="w-4 h-4 accent-[#EA580C] cursor-pointer"
            />
          </div>

          {/* Included Mods Roster Preview */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[#9AA3AF] uppercase tracking-wider">
                Bundled Mod Roster ({activeMods.length} Mods)
              </span>
              <span className="text-[11px] text-[#6B7480]">
                Zero binary bloat · Verified via Forge GUIDs
              </span>
            </div>

            <div className="bg-[#121418] border border-[#23272E] rounded max-h-48 overflow-y-auto divide-y divide-[#1D2128]">
              {activeMods.map((m) => (
                <div key={m.id} className="px-3 py-2 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 truncate">
                    <span className="font-medium text-[#E8EAEE] truncate">{m.name}</span>
                    <span className="text-[10px] font-mono px-1 rounded bg-[#20252D] text-[#9AA3AF]">
                      v{m.version}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] text-[#6B7480] uppercase">{m.kind}</span>
                    <span className="text-[10px] font-mono text-[#9AA3AF]">
                      #{profile.customLoadOrder?.[m.id] ?? m.loadOrder ?? 100}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#23272E] bg-[#14161B] flex items-center justify-between shrink-0">
          <button
            onClick={handleCopyJson}
            className="bg-[#20252D] hover:bg-[#282F3A] text-[#E8EAEE] text-xs font-medium px-3 py-1.5 rounded border border-[#2B303C] flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied Manifest' : 'Copy Manifest JSON'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="bg-[#20252D] hover:bg-[#282F3A] text-[#9AA3AF] text-xs font-medium px-3 py-1.5 rounded transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleDownloadFile}
              className="bg-[#EA580C] hover:bg-[#F97316] text-white text-xs font-semibold px-4 py-1.5 rounded flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download .bsite Bundle</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
