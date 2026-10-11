import React from 'react';
import {
  Puzzle,
  AlertTriangle,
  CheckCircle2,
  Download,
  X,
  ExternalLink,
  Layers,
  ArrowRight
} from 'lucide-react';
import { Addon, AddonVersion, Mod } from '../types';

interface AddonDependencyPromptModalProps {
  isOpen: boolean;
  addon: Addon | null;
  addonVersion: AddonVersion | null;
  parentMod: Mod | null;
  onInstallBoth: () => void;
  onInstallAddonOnly: () => void;
  onClose: () => void;
}

export const AddonDependencyPromptModal: React.FC<AddonDependencyPromptModalProps> = ({
  isOpen,
  addon,
  addonVersion,
  parentMod,
  onInstallBoth,
  onInstallAddonOnly,
  onClose,
}) => {
  if (!isOpen || !addon) return null;

  const parentName = addon.mod?.name || parentMod?.name || 'Base Mod';
  const parentAuthor = addon.mod?.authors?.[0]?.name || parentMod?.owner?.name || 'Community Author';
  const versionConstraint = addonVersion?.mod_version_constraint;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
      <div className="bg-[#181B20] border border-[#23272E] rounded-xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#23272E] flex items-center justify-between bg-[#1C2026]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#F59E0B]/15 border border-[#F59E0B]/30 flex items-center justify-center text-[#F59E0B]">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#E8EAEE]">Parent Mod Dependency Detected</h2>
              <p className="text-[11px] text-[#9AA3AF]">
                This addon requires or extends an uninstalled base mod
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#9AA3AF] hover:text-[#E8EAEE] hover:bg-[#282E38] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 text-xs">
          {/* Target Addon Info */}
          <div className="bg-[#121418] border border-[#2A303C] rounded-lg p-3 flex items-start gap-3">
            <div className="w-10 h-10 rounded bg-[#EA580C]/10 border border-[#EA580C]/20 flex items-center justify-center text-[#EA580C] shrink-0">
              <Puzzle className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[#E8EAEE] truncate">{addon.name}</span>
                {addonVersion && (
                  <span className="font-mono text-[10px] text-[#9AA3AF] bg-[#1E232B] px-1.5 py-0.5 rounded">
                    v{addonVersion.version}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#9AA3AF] mt-0.5 line-clamp-1">
                {addon.teaser || 'Addon package'}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-center text-[#6B7280]">
            <ArrowRight className="w-4 h-4 rotate-90 sm:rotate-0" />
            <span className="mx-2 font-mono text-[10px] uppercase tracking-wider text-[#9AA3AF]">
              Requires Base Mod
            </span>
            <ArrowRight className="w-4 h-4 rotate-90 sm:rotate-0" />
          </div>

          {/* Missing Parent Mod Alert Box */}
          <div className="bg-[#F59E0B]/10 border border-[#F59E0B]/25 rounded-lg p-3.5 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#F59E0B] shrink-0" />
                <span className="font-bold text-sm text-[#E8EAEE]">{parentName}</span>
              </div>
              <span className="text-[10px] uppercase font-mono font-bold bg-[#F59E0B]/20 text-[#F59E0B] px-2 py-0.5 rounded border border-[#F59E0B]/30">
                Not Installed
              </span>
            </div>

            <p className="text-[#D1D5DB] text-[11px] leading-relaxed">
              <strong>{addon.name}</strong> was created specifically for <strong>{parentName}</strong> by {parentAuthor}.
              Without the parent mod installed in your SPT loadout, this addon may not take effect or could throw errors in the SPT server console.
            </p>

            {versionConstraint && (
              <div className="text-[10px] font-mono text-[#F59E0B]/90 pt-1 border-t border-[#F59E0B]/15">
                Version requirement: <span className="underline">{versionConstraint}</span>
              </div>
            )}
          </div>

          <div className="bg-[#121418] rounded-lg p-3 border border-[#23272E] text-[11px] text-[#9AA3AF]">
            Would you like Blacksite to automatically download and install <strong>{parentName}</strong> alongside this addon?
          </div>
        </div>

        {/* Modal Footer / Actions */}
        <div className="px-5 py-3.5 border-t border-[#23272E] bg-[#1C2026] flex flex-col sm:flex-row items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-3.5 py-1.5 text-xs text-[#9AA3AF] hover:text-[#E8EAEE] transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            onClick={onInstallAddonOnly}
            className="w-full sm:w-auto px-3.5 py-1.5 text-xs font-medium rounded bg-[#20252D] hover:bg-[#282E38] text-[#E8EAEE] border border-[#2A303C] transition-colors cursor-pointer"
          >
            Install Addon Only
          </button>

          <button
            onClick={onInstallBoth}
            className="w-full sm:w-auto px-4 py-1.5 text-xs font-semibold rounded bg-[#EA580C] hover:bg-[#EA580C]/90 text-white shadow-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Install Parent Mod + Addon</span>
          </button>
        </div>
      </div>
    </div>
  );
};
