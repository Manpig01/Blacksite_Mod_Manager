import React, { useState, useEffect, useMemo } from 'react';
import {
  Download,
  Edit2,
  User,
  Zap,
  CheckCircle2,
} from 'lucide-react';
import { ModProfile, InstalledMod, SptPlayerProfile } from '../../types';

interface ProfileInspectorPanelProps {
  profile: ModProfile;
  isActive: boolean;
  installedMods: InstalledMod[];
  playerSaves: SptPlayerProfile[];
  onUpdateProfile: (updated: ModProfile) => void;
  onActivateProfile: (profileId: string) => void;
  onExportProfile: (profile: ModProfile) => void;
  onToggleModInProfile: (modId: string) => void;
  onLinkTarkovSave: (playerId: string) => void;
  onShowToast: (title: string, message: string, type: 'success' | 'warning' | 'info') => void;
}

export const ProfileInspectorPanel: React.FC<ProfileInspectorPanelProps> = ({
  profile,
  isActive,
  installedMods,
  playerSaves,
  onUpdateProfile,
  onActivateProfile,
  onExportProfile,
  onToggleModInProfile,
  onLinkTarkovSave,
  onShowToast,
}) => {
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editBannerColor, setEditBannerColor] = useState('#EA580C');
  const [editTags, setEditTags] = useState('');

  useEffect(() => {
    setEditName(profile.name);
    setEditDesc(profile.description);
    setEditBannerColor(profile.bannerColor || '#EA580C');
    setEditTags((profile.tags || []).join(', '));
    setIsEditingDetails(false);
  }, [profile]);

  // Precomputed O(1) Set for enabled mod IDs in the focused profile
  const enabledModIdSet = useMemo(
    () => new Set(profile.enabledModIds),
    [profile.enabledModIds]
  );

  const handleSaveDetails = () => {
    if (!editName.trim()) return;
    const tags = editTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const updated: ModProfile = {
      ...profile,
      name: editName.trim(),
      description: editDesc.trim(),
      bannerColor: editBannerColor,
      tags,
      updatedAt: Date.now(),
    };
    onUpdateProfile(updated);
    setIsEditingDetails(false);
    onShowToast('Profile Updated', `Saved changes to "${updated.name}".`, 'success');
  };

  return (
    <div className="w-[420px] bg-[#14161B] border-l border-[#23272E] flex flex-col shrink-0 overflow-hidden">
      {/* Inspector Header */}
      <div className="px-5 py-4 border-b border-[#23272E] bg-[#181B20] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: profile.bannerColor || '#EA580C' }}
          />
          <h2 className="text-sm font-bold text-[#E8EAEE] truncate">
            {profile.name}
          </h2>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setIsEditingDetails(!isEditingDetails)}
            className={`p-1.5 rounded transition-colors cursor-pointer text-xs flex items-center gap-1 ${
              isEditingDetails
                ? 'bg-[#EA580C] text-white'
                : 'bg-[#20252D] hover:bg-[#282F3A] text-[#9AA3AF] hover:text-white'
            }`}
            title="Edit profile metadata"
          >
            <Edit2 className="w-3.5 h-3.5" />
            <span>{isEditingDetails ? 'Cancel' : 'Edit'}</span>
          </button>
        </div>
      </div>

      {/* Inspector Content Viewport */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {isEditingDetails ? (
          <div className="bg-[#181B20] border border-[#2B303C] rounded-lg p-3.5 space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#9AA3AF] mb-1">
                Profile Name
              </label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full bg-[#121418] border border-[#2B303C] rounded px-2.5 py-1 text-xs text-[#E8EAEE] focus:outline-none focus:border-[#EA580C]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#9AA3AF] mb-1">
                Description
              </label>
              <textarea
                rows={2}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="w-full bg-[#121418] border border-[#2B303C] rounded px-2.5 py-1 text-xs text-[#E8EAEE] focus:outline-none focus:border-[#EA580C] resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-[#9AA3AF] mb-1">
                  Accent Banner Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={editBannerColor}
                    onChange={(e) => setEditBannerColor(e.target.value)}
                    className="w-7 h-7 bg-transparent border-0 cursor-pointer rounded"
                  />
                  <span className="text-[11px] font-mono text-[#9AA3AF]">
                    {editBannerColor}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#9AA3AF] mb-1">
                  Tags (comma separated)
                </label>
                <input
                  type="text"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="e.g. Combat, AI, Visuals"
                  className="w-full bg-[#121418] border border-[#2B303C] rounded px-2.5 py-1 text-xs text-[#E8EAEE] focus:outline-none focus:border-[#EA580C]"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleSaveDetails}
              className="w-full bg-[#EA580C] hover:bg-[#F97316] text-white text-xs font-semibold py-1.5 rounded transition-colors cursor-pointer"
            >
              Save Profile Changes
            </button>
          </div>
        ) : (
          <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-3.5 space-y-2">
            <p className="text-xs text-[#9AA3AF]">
              {profile.description || 'No description provided.'}
            </p>
            <div className="text-[11px] text-[#6B7480] flex items-center justify-between pt-1 border-t border-[#23272E] tabular-nums">
              <span>Created: {profile.createdDate}</span>
              <span>
                Active Mods: <strong>{profile.enabledModIds.length}</strong>
              </span>
            </div>
          </div>
        )}

        {/* Tarkov Player Character Save Linker */}
        <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#E8EAEE]">
              <User className="w-3.5 h-3.5 text-amber-400" />
              <span>Linked Tarkov Player Save</span>
            </div>
            <span className="text-[10px] text-[#6B7480] font-mono">user/profiles/*.json</span>
          </div>
          <p className="text-[11px] text-[#9AA3AF]">
            Automatically switches active player character in SPT launcher to prevent missing mod item corruption.
          </p>

          <select
            value={profile.linkedSptProfileId || ''}
            onChange={(e) => onLinkTarkovSave(e.target.value)}
            className="w-full bg-[#121418] border border-[#2B303C] rounded px-2.5 py-1.5 text-xs text-[#E8EAEE] focus:outline-none focus:border-amber-500 cursor-pointer"
          >
            <option value="">
              {playerSaves.length === 0
                ? '-- No player saves found in user/profiles --'
                : '-- No linked save (Use SPT Default) --'}
            </option>
            {playerSaves.map((save) => (
              <option key={save.id} value={save.id}>
                {save.name} ({save.side.toUpperCase()} Lvl {save.level} · {save.edition})
              </option>
            ))}
          </select>
        </div>

        {/* Mod Roster for this Profile */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#9AA3AF] uppercase tracking-wider">
              Profile Mod Roster
            </span>
            <span className="text-[11px] font-mono tabular-nums text-[#6B7480]">
              {profile.enabledModIds.length} / {installedMods.length} Enabled
            </span>
          </div>

          <div className="bg-[#181B20] border border-[#23272E] rounded-lg divide-y divide-[#23272E] max-h-96 overflow-y-auto">
            {installedMods.map((mod) => {
              const isModEnabled = enabledModIdSet.has(mod.id);

              return (
                <div
                  key={mod.id}
                  className={`px-3 py-2 flex items-center justify-between gap-3 text-xs transition-colors ${
                    isModEnabled ? 'bg-[#181B20]' : 'bg-[#121418]/60 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={isModEnabled}
                      onChange={() => onToggleModInProfile(mod.id)}
                      className="w-3.5 h-3.5 accent-[#EA580C] cursor-pointer shrink-0"
                    />
                    <div className="truncate">
                      <div className="font-medium text-[#E8EAEE] truncate">{mod.name}</div>
                      <div className="text-[10px] text-[#6B7480] flex items-center gap-1.5 tabular-nums">
                        <span>v{mod.version}</span>
                        <span>·</span>
                        <span className="uppercase">{mod.kind}</span>
                        <span>·</span>
                        <span>Order #{mod.loadOrder ?? 100}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onToggleModInProfile(mod.id)}
                    className={`text-[10px] font-mono px-2 py-0.5 rounded cursor-pointer transition-colors ${
                      isModEnabled
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-[#20252D] text-[#6B7480] hover:text-white'
                    }`}
                  >
                    {isModEnabled ? 'ACTIVE' : 'OFF'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Inspector Footer Actions */}
      <div className="px-5 py-3 border-t border-[#23272E] bg-[#181B20] flex items-center justify-between shrink-0">
        <button
          type="button"
          onClick={() => onExportProfile(profile)}
          className="bg-[#20252D] hover:bg-[#282F3A] text-[#E8EAEE] border border-[#2B303C] text-xs font-medium px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export .bsite</span>
        </button>

        {!isActive ? (
          <button
            type="button"
            onClick={() => onActivateProfile(profile.id)}
            className="bg-[#EA580C] hover:bg-[#F97316] text-white text-xs font-semibold px-4 py-1.5 rounded flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Activate Loadout</span>
          </button>
        ) : (
          <div className="text-xs text-emerald-400 font-mono flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Currently Loaded in VFS</span>
          </div>
        )}
      </div>
    </div>
  );
};
