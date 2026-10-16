import React, { useState, useMemo } from 'react';
import {
  X,
  GitCompare,
  ArrowRight,
  ArrowLeft,
  Check,
  Layers,
  ArrowLeftRight,
  ShieldAlert,
  Server,
  Monitor,
  Package,
} from 'lucide-react';
import { ModProfile, InstalledMod, ProfileDiffResult } from '../types';
import { profileService } from '../services/profileService';

interface ProfileCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  profiles: ModProfile[];
  installedMods: InstalledMod[];
  initialProfileAId?: string;
  initialProfileBId?: string;
  onUpdateProfile: (profile: ModProfile) => void;
  onShowToast: (title: string, message: string, type: 'success' | 'warning' | 'info') => void;
}

export const ProfileCompareModal: React.FC<ProfileCompareModalProps> = ({
  isOpen,
  onClose,
  profiles,
  installedMods,
  initialProfileAId,
  initialProfileBId,
  onUpdateProfile,
  onShowToast,
}) => {
  const [profileAId, setProfileAId] = useState<string>(() => {
    return initialProfileAId || profiles[0]?.id || '';
  });

  const [profileBId, setProfileBId] = useState<string>(() => {
    if (initialProfileBId && initialProfileBId !== initialProfileAId) {
      return initialProfileBId;
    }
    const second = profiles.find((p) => p.id !== (initialProfileAId || profiles[0]?.id));
    return second ? second.id : profiles[0]?.id || '';
  });

  const [activeDiffTab, setActiveDiffTab] = useState<'all' | 'exclusive' | 'common' | 'orders'>('all');

  const profileA = useMemo(() => profiles.find((p) => p.id === profileAId), [profiles, profileAId]);
  const profileB = useMemo(() => profiles.find((p) => p.id === profileBId), [profiles, profileBId]);

  const diffResult = useMemo<ProfileDiffResult | null>(() => {
    if (!profileA || !profileB) return null;
    return profileService.computeProfileDiff(profileA, profileB, installedMods);
  }, [profileA, profileB, installedMods]);

  if (!isOpen || !profileA || !profileB || !diffResult) return null;

  // Sync a single mod from profileA to profileB
  const handleCopyModToB = (modId: string) => {
    if (profileB.enabledModIds.includes(modId)) return;
    const updatedB: ModProfile = {
      ...profileB,
      enabledModIds: [...profileB.enabledModIds, modId],
      updatedAt: Date.now(),
    };
    onUpdateProfile(updatedB);
    onShowToast(
      'Mod Synchronized',
      `Added mod to profile "${profileB.name}".`,
      'success'
    );
  };

  // Sync a single mod from profileB to profileA
  const handleCopyModToA = (modId: string) => {
    if (profileA.enabledModIds.includes(modId)) return;
    const updatedA: ModProfile = {
      ...profileA,
      enabledModIds: [...profileA.enabledModIds, modId],
      updatedAt: Date.now(),
    };
    onUpdateProfile(updatedA);
    onShowToast(
      'Mod Synchronized',
      `Added mod to profile "${profileA.name}".`,
      'success'
    );
  };

  // Bulk sync: add all missing mods from A into B
  const handleSyncAllAtoB = () => {
    const toAdd = diffResult.onlyInProfileA.map((m) => m.id);
    if (toAdd.length === 0) {
      onShowToast('Already Synced', 'Profile B already contains all mods from Profile A.', 'info');
      return;
    }
    const updatedB: ModProfile = {
      ...profileB,
      enabledModIds: Array.from(new Set([...profileB.enabledModIds, ...toAdd])),
      updatedAt: Date.now(),
    };
    onUpdateProfile(updatedB);
    onShowToast(
      'Loadout Synced',
      `Synchronized ${toAdd.length} mods from "${profileA.name}" into "${profileB.name}".`,
      'success'
    );
  };

  // Bulk sync: add all missing mods from B into A
  const handleSyncAllBtoA = () => {
    const toAdd = diffResult.onlyInProfileB.map((m) => m.id);
    if (toAdd.length === 0) {
      onShowToast('Already Synced', 'Profile A already contains all mods from Profile B.', 'info');
      return;
    }
    const updatedA: ModProfile = {
      ...profileA,
      enabledModIds: Array.from(new Set([...profileA.enabledModIds, ...toAdd])),
      updatedAt: Date.now(),
    };
    onUpdateProfile(updatedA);
    onShowToast(
      'Loadout Synced',
      `Synchronized ${toAdd.length} mods from "${profileB.name}" into "${profileA.name}".`,
      'success'
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
      <div className="bg-[#181B20] border border-[#2B303C] rounded-lg shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#23272E] bg-[#14161B] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#EA580C]/15 border border-[#EA580C]/40 flex items-center justify-center">
              <GitCompare className="w-4 h-4 text-[#EA580C]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#E8EAEE] flex items-center gap-2">
                <span>Tactical Profile Comparison Matrix</span>
                <span className="text-xs px-2 py-0.5 rounded bg-[#20252D] text-[#9AA3AF] font-mono">
                  Diff Engine
                </span>
              </h2>
              <p className="text-xs text-[#9AA3AF]">
                Side-by-side loadout inspection, delta breakdown, and 1-click mod synchronization
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

        {/* Profile Selector Control Bar */}
        <div className="px-5 py-3 border-b border-[#23272E] bg-[#121418] flex items-center justify-between gap-4 shrink-0 flex-wrap">
          {/* Profile A Select */}
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <span className="text-xs font-semibold text-[#EA580C] uppercase tracking-wider">
              Profile A:
            </span>
            <select
              value={profileAId}
              onChange={(e) => setProfileAId(e.target.value)}
              className="bg-[#181B20] border border-[#2B303C] text-[#E8EAEE] text-xs rounded px-3 py-1.5 flex-1 focus:outline-none focus:border-[#EA580C] cursor-pointer"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.enabledModIds.length} mods)
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 text-[#6B7480]">
            <ArrowLeftRight className="w-4 h-4" />
          </div>

          {/* Profile B Select */}
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
              Profile B:
            </span>
            <select
              value={profileBId}
              onChange={(e) => setProfileBId(e.target.value)}
              className="bg-[#181B20] border border-[#2B303C] text-[#E8EAEE] text-xs rounded px-3 py-1.5 flex-1 focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.enabledModIds.length} mods)
                </option>
              ))}
            </select>
          </div>

          {/* Quick Bulk Sync Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSyncAllAtoB}
              disabled={diffResult.onlyInProfileA.length === 0}
              className="bg-[#20252D] hover:bg-[#282F3A] disabled:opacity-40 disabled:pointer-events-none text-[#E8EAEE] border border-[#2B303C] text-xs font-medium px-2.5 py-1.5 rounded flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Copy all mods exclusive to Profile A into Profile B"
            >
              <span>Sync A → B</span>
              <ArrowRight className="w-3 h-3 text-[#EA580C]" />
            </button>
            <button
              onClick={handleSyncAllBtoA}
              disabled={diffResult.onlyInProfileB.length === 0}
              className="bg-[#20252D] hover:bg-[#282F3A] disabled:opacity-40 disabled:pointer-events-none text-[#E8EAEE] border border-[#2B303C] text-xs font-medium px-2.5 py-1.5 rounded flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Copy all mods exclusive to Profile B into Profile A"
            >
              <ArrowLeft className="w-3 h-3 text-emerald-400" />
              <span>Sync B → A</span>
            </button>
          </div>
        </div>

        {/* Delta Metrics Strip */}
        <div className="px-5 py-2.5 bg-[#14161B] border-b border-[#23272E] flex items-center gap-4 text-xs shrink-0 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[#9AA3AF]">Common Mods:</span>
            <span className="font-mono font-bold text-white px-1.5 py-0.5 rounded bg-[#20252D]">
              {diffResult.commonMods.length}
            </span>
          </div>
          <span className="text-[#3A3F4B]">·</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[#9AA3AF]">Exclusive to A:</span>
            <span className="font-mono font-bold text-[#EA580C] px-1.5 py-0.5 rounded bg-[#EA580C]/15 border border-[#EA580C]/30">
              +{diffResult.onlyInProfileA.length}
            </span>
          </div>
          <span className="text-[#3A3F4B]">·</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[#9AA3AF]">Exclusive to B:</span>
            <span className="font-mono font-bold text-emerald-400 px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30">
              +{diffResult.onlyInProfileB.length}
            </span>
          </div>
          <span className="text-[#3A3F4B]">·</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[#9AA3AF]">Load Order Diffs:</span>
            <span className="font-mono font-bold text-amber-400 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30">
              {diffResult.loadOrderMismatches.length}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-1 bg-[#0E1013] p-0.5 rounded border border-[#23272E]">
            <button
              onClick={() => setActiveDiffTab('all')}
              className={`px-2 py-0.5 text-[11px] rounded transition-colors cursor-pointer ${
                activeDiffTab === 'all'
                  ? 'bg-[#20252D] text-white font-medium'
                  : 'text-[#9AA3AF] hover:text-white'
              }`}
            >
              All Deltas
            </button>
            <button
              onClick={() => setActiveDiffTab('exclusive')}
              className={`px-2 py-0.5 text-[11px] rounded transition-colors cursor-pointer ${
                activeDiffTab === 'exclusive'
                  ? 'bg-[#20252D] text-white font-medium'
                  : 'text-[#9AA3AF] hover:text-white'
              }`}
            >
              Exclusives Only
            </button>
            <button
              onClick={() => setActiveDiffTab('common')}
              className={`px-2 py-0.5 text-[11px] rounded transition-colors cursor-pointer ${
                activeDiffTab === 'common'
                  ? 'bg-[#20252D] text-white font-medium'
                  : 'text-[#9AA3AF] hover:text-white'
              }`}
            >
              Common ({diffResult.commonMods.length})
            </button>
          </div>
        </div>

        {/* Diff Content Viewport */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Section: Exclusive to Profile A */}
          {(activeDiffTab === 'all' || activeDiffTab === 'exclusive') && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#EA580C] flex items-center gap-2">
                  <span>Exclusive to {profileA.name}</span>
                  <span className="text-[11px] font-mono font-normal text-[#9AA3AF]">
                    ({diffResult.onlyInProfileA.length} mods)
                  </span>
                </h3>
                {diffResult.onlyInProfileA.length > 0 && (
                  <span className="text-[11px] text-[#6B7480]">
                    Click "Copy to B" to install into {profileB.name}
                  </span>
                )}
              </div>

              {diffResult.onlyInProfileA.length === 0 ? (
                <div className="bg-[#121418] border border-[#23272E] rounded p-3 text-center text-xs text-[#6B7480]">
                  No mods exclusive to {profileA.name}.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {diffResult.onlyInProfileA.map((mod) => (
                    <div
                      key={mod.id}
                      className="bg-[#14161B] border border-[#EA580C]/30 hover:border-[#EA580C]/60 rounded p-3 flex items-center justify-between gap-3 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-[#E8EAEE] truncate">
                            {mod.name}
                          </span>
                          <span className="text-[10px] font-mono px-1 rounded bg-[#20252D] text-[#9AA3AF]">
                            v{mod.version}
                          </span>
                          <span className="text-[10px] text-[#6B7480] uppercase">
                            {mod.kind}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#6B7480] truncate mt-0.5">
                          {mod.author || 'Author'} · Order: #{mod.loadOrder ?? 100}
                        </div>
                      </div>

                      <button
                        onClick={() => handleCopyModToB(mod.id)}
                        className="bg-[#20252D] hover:bg-[#EA580C] hover:text-white text-[#9AA3AF] text-xs px-2.5 py-1 rounded border border-[#2B303C] hover:border-transparent flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                        title={`Copy ${mod.name} into ${profileB.name}`}
                      >
                        <span>Copy to B</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Section: Exclusive to Profile B */}
          {(activeDiffTab === 'all' || activeDiffTab === 'exclusive') && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                  <span>Exclusive to {profileB.name}</span>
                  <span className="text-[11px] font-mono font-normal text-[#9AA3AF]">
                    ({diffResult.onlyInProfileB.length} mods)
                  </span>
                </h3>
                {diffResult.onlyInProfileB.length > 0 && (
                  <span className="text-[11px] text-[#6B7480]">
                    Click "Copy to A" to install into {profileA.name}
                  </span>
                )}
              </div>

              {diffResult.onlyInProfileB.length === 0 ? (
                <div className="bg-[#121418] border border-[#23272E] rounded p-3 text-center text-xs text-[#6B7480]">
                  No mods exclusive to {profileB.name}.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {diffResult.onlyInProfileB.map((mod) => (
                    <div
                      key={mod.id}
                      className="bg-[#14161B] border border-emerald-500/30 hover:border-emerald-500/60 rounded p-3 flex items-center justify-between gap-3 transition-colors"
                    >
                      <button
                        onClick={() => handleCopyModToA(mod.id)}
                        className="bg-[#20252D] hover:bg-emerald-600 hover:text-white text-[#9AA3AF] text-xs px-2.5 py-1 rounded border border-[#2B303C] hover:border-transparent flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                        title={`Copy ${mod.name} into ${profileA.name}`}
                      >
                        <ArrowLeft className="w-3 h-3" />
                        <span>Copy to A</span>
                      </button>

                      <div className="min-w-0 flex-1 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-[10px] text-[#6B7480] uppercase">
                            {mod.kind}
                          </span>
                          <span className="text-[10px] font-mono px-1 rounded bg-[#20252D] text-[#9AA3AF]">
                            v{mod.version}
                          </span>
                          <span className="font-semibold text-xs text-[#E8EAEE] truncate">
                            {mod.name}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#6B7480] truncate mt-0.5">
                          Order: #{mod.loadOrder ?? 100} · {mod.author || 'Author'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Section: Load Order Discrepancies */}
          {activeDiffTab === 'all' && diffResult.loadOrderMismatches.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <span>Load Order Mismatches</span>
                <span className="text-[11px] font-mono font-normal text-[#9AA3AF]">
                  ({diffResult.loadOrderMismatches.length} mods)
                </span>
              </h3>
              <div className="bg-[#121418] border border-amber-500/20 rounded divide-y divide-[#23272E]">
                {diffResult.loadOrderMismatches.map((m) => (
                  <div key={m.modId} className="px-4 py-2.5 flex items-center justify-between text-xs">
                    <span className="font-medium text-[#E8EAEE]">{m.modName}</span>
                    <div className="flex items-center gap-4 font-mono">
                      <span className="text-[#EA580C]">
                        {profileA.name}: #{m.orderA}
                      </span>
                      <span className="text-[#6B7480]">vs</span>
                      <span className="text-emerald-400">
                        {profileB.name}: #{m.orderB}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section: Common Mods */}
          {(activeDiffTab === 'all' || activeDiffTab === 'common') && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#9AA3AF] flex items-center gap-2">
                <span>Common Mods (Active in Both Loadouts)</span>
                <span className="text-[11px] font-mono font-normal text-[#6B7480]">
                  ({diffResult.commonMods.length} mods)
                </span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {diffResult.commonMods.map((mod) => (
                  <div
                    key={mod.id}
                    className="bg-[#121418] border border-[#23272E] rounded px-3 py-2 flex items-center justify-between text-xs"
                  >
                    <div className="truncate">
                      <span className="text-[#E8EAEE] truncate font-medium">{mod.name}</span>
                      <div className="text-[10px] text-[#6B7480] font-mono">v{mod.version}</div>
                    </div>
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 ml-2" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#23272E] bg-[#14161B] flex items-center justify-between shrink-0">
          <div className="text-xs text-[#6B7480]">
            Changes to profiles are applied immediately to storage.
          </div>
          <button
            onClick={onClose}
            className="bg-[#20252D] hover:bg-[#282F3A] text-white text-xs font-medium px-4 py-1.5 rounded transition-colors cursor-pointer"
          >
            Close Compare Matrix
          </button>
        </div>
      </div>
    </div>
  );
};
