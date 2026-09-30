import React from 'react';
import { X, AlertTriangle, EyeOff, Trash2, CheckCircle2 } from 'lucide-react';
import { ConflictInfo, InstalledMod } from '../types';

interface ConflictResolverModalProps {
  conflict: ConflictInfo | null;
  installedMods: InstalledMod[];
  isOpen: boolean;
  onClose: () => void;
  onDisableMod: (modId: string) => void;
  onIgnoreConflict: (conflictId: string) => void;
}

export const ConflictResolverModal: React.FC<ConflictResolverModalProps> = ({
  conflict,
  installedMods,
  isOpen,
  onClose,
  onDisableMod,
  onIgnoreConflict,
}) => {
  if (!isOpen || !conflict) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-[#181B20] border border-[#F59E0B]/50 rounded-xl w-full max-w-xl flex flex-col shadow-2xl animate-fade-in overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#23272E] bg-[#221B10] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-[#F59E0B]" />
            <div>
              <h2 className="text-base font-bold text-[#F59E0B]">Mod Conflict Detected</h2>
              <p className="text-xs text-[#9AA3AF]">
                {conflict.itemType === 'dll' ? 'Duplicate Client DLL' : 'Duplicate Server Package ID'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#9AA3AF] hover:text-white p-1 hover:bg-[#20252D] rounded transition-colors cursor-pointer"
            type="button"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Details */}
        <div className="p-5 space-y-4 text-xs">
          <div className="bg-[#0E1013] p-3 rounded-lg border border-[#23272E] space-y-1.5 font-mono">
            <span className="text-[#9AA3AF] block font-sans font-semibold">Conflicting Asset:</span>
            <span className="text-[#F59E0B] text-sm font-bold block">{conflict.duplicateItem}</span>
            <p className="text-[#9AA3AF] font-sans text-xs pt-1">{conflict.details}</p>
          </div>

          <div>
            <span className="font-bold text-[#E8EAEE] block mb-2">Affected Active Mods:</span>
            <div className="space-y-2">
              {conflict.conflictingModIds.map((id, index) => {
                const mod = installedMods.find((m) => m.id === id);
                const name = mod?.name || conflict.conflictingModNames[index] || id;

                return (
                  <div
                    key={id}
                    className="flex items-center justify-between bg-[#121418] p-3 rounded-lg border border-[#23272E]"
                  >
                    <div>
                      <span className="text-sm font-bold text-[#E8EAEE] block">{name}</span>
                      <span className="font-mono text-[#6B7480] text-[11px]">{id}</span>
                    </div>

                    <button
                      onClick={() => onDisableMod(id)}
                      className="bg-[#20252D] hover:bg-[#DC2626] text-[#E8EAEE] px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Disable this mod to resolve the collision"
                      type="button"
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                      <span>Disable Mod</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-2 border-t border-[#23272E] flex items-center justify-between">
            <button
              onClick={() => onIgnoreConflict(conflict.id)}
              className="text-[#9AA3AF] hover:text-[#E8EAEE] text-xs underline cursor-pointer"
              type="button"
            >
              Ignore this conflict (don't warn again)
            </button>

            <button
              onClick={onClose}
              className="bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] text-xs font-semibold px-4 py-2 rounded-lg cursor-pointer"
              type="button"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
