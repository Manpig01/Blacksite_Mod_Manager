import React, { useState, useMemo, useEffect } from 'react';
import {
  Layers,
  Plus,
  GitCompare,
  Upload,
  Download,
  Copy,
  Trash2,
  Edit2,
  Check,
  Shield,
  User,
  Zap,
  Search,
  ExternalLink,
  Sliders,
  Settings,
  Server,
  Monitor,
  CheckCircle2,
  Clock,
  Sparkles,
  Info,
  X,
} from 'lucide-react';
import {
  ModProfile,
  InstalledMod,
  SptPlayerProfile,
  BsiteBundleModEntry,
} from '../types';
import { profileService } from '../services/profileService';
import { ProfileCompareModal } from './ProfileCompareModal';
import { BsiteExportModal } from './BsiteExportModal';
import { BsiteImportModal } from './BsiteImportModal';

interface ProfilesTabProps {
  profiles: ModProfile[];
  activeProfileId: string;
  installedMods: InstalledMod[];
  sptVersion: string;
  sptDirectory: string;
  onSelectProfile: (profileId: string) => void;
  onCreateProfile: (name?: string) => void;
  onUpdateProfile: (profile: ModProfile) => void;
  onDeleteProfile: (profileId: string) => void;
  onBatchDownloadMods?: (mods: BsiteBundleModEntry[]) => void;
  onShowToast: (title: string, message: string, type: 'success' | 'warning' | 'info') => void;
}

export const ProfilesTab: React.FC<ProfilesTabProps> = ({
  profiles,
  activeProfileId,
  installedMods,
  sptVersion,
  sptDirectory,
  onSelectProfile,
  onCreateProfile,
  onUpdateProfile,
  onDeleteProfile,
  onBatchDownloadMods,
  onShowToast,
}) => {
  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Selected Profile for Inspector Pane
  const [selectedProfileId, setSelectedProfileId] = useState<string>(() => {
    return activeProfileId || profiles[0]?.id || '';
  });

  // Keep selectedProfileId in sync if profiles change
  useEffect(() => {
    if (!profiles.some((p) => p.id === selectedProfileId)) {
      setSelectedProfileId(activeProfileId || profiles[0]?.id || '');
    }
  }, [profiles, selectedProfileId, activeProfileId]);

  // Tarkov Character Save Profiles
  const [playerSaves, setPlayerSaves] = useState<SptPlayerProfile[]>([]);

  useEffect(() => {
    profileService.scanSptPlayerProfiles(sptDirectory).then(setPlayerSaves);
  }, [sptDirectory]);

  // Modals state
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [compareProfileAId, setCompareProfileAId] = useState<string>('');
  const [compareProfileBId, setCompareProfileBId] = useState<string>('');

  const [exportModalProfile, setExportModalProfile] = useState<ModProfile | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');

  // Editing profile details in inspector
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editBannerColor, setEditBannerColor] = useState('#EA580C');
  const [editTags, setEditTags] = useState('');

  // Currently focused profile in inspector
  const focusedProfile = useMemo(() => {
    return profiles.find((p) => p.id === selectedProfileId) || profiles[0];
  }, [profiles, selectedProfileId]);

  // Sync edit fields when focused profile changes
  useEffect(() => {
    if (focusedProfile) {
      setEditName(focusedProfile.name);
      setEditDesc(focusedProfile.description);
      setEditBannerColor(focusedProfile.bannerColor || '#EA580C');
      setEditTags((focusedProfile.tags || []).join(', '));
      setIsEditingDetails(false);
    }
  }, [focusedProfile]);

  // All unique tags across profiles
  const allTags = useMemo(() => {
    const set = new Set<string>();
    profiles.forEach((p) => {
      (p.tags || []).forEach((t) => set.add(t));
    });
    return Array.from(set);
  }, [profiles]);

  // Filtered profiles deck
  const filteredProfiles = useMemo(() => {
    return profiles.filter((p) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        (p.tags || []).some((t) => t.toLowerCase().includes(q));

      const matchesTag = !selectedTag || (p.tags || []).includes(selectedTag);

      return matchesSearch && matchesTag;
    });
  }, [profiles, searchQuery, selectedTag]);

  // Active Profile object
  const activeProfile = useMemo(() => {
    return profiles.find((p) => p.id === activeProfileId) || profiles[0];
  }, [profiles, activeProfileId]);

  // Handle clone
  const handleCloneProfile = (source: ModProfile) => {
    const cloned = profileService.cloneProfile(source);
    onUpdateProfile(cloned);
    setSelectedProfileId(cloned.id);
    onShowToast('Profile Cloned', `Created clone "${cloned.name}".`, 'success');
  };

  // Handle 1-click rollback checkpoint
  const handleTakeCheckpoint = () => {
    if (!activeProfile) return;
    const checkpoint = profileService.createCheckpoint(activeProfile, installedMods, sptVersion);
    onUpdateProfile(checkpoint);
    setSelectedProfileId(checkpoint.id);
    onShowToast(
      'Checkpoint Saved',
      `Saved rollback snapshot "${checkpoint.name}" (${checkpoint.enabledModIds.length} active mods).`,
      'success'
    );
  };

  const handleSubmitNewProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newProfileName.trim();
    if (!trimmed) return;
    onCreateProfile(trimmed);
    setNewProfileName('');
    setIsCreatingProfile(false);
  };

  // Save edited details
  const handleSaveDetails = () => {
    if (!focusedProfile || !editName.trim()) return;
    const tags = editTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const updated: ModProfile = {
      ...focusedProfile,
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

  // Toggle a mod within the focused profile
  const handleToggleModInProfile = (modId: string) => {
    if (!focusedProfile) return;
    const currentEnabled = new Set(focusedProfile.enabledModIds);
    if (currentEnabled.has(modId)) {
      currentEnabled.delete(modId);
    } else {
      currentEnabled.add(modId);
    }

    const updated: ModProfile = {
      ...focusedProfile,
      enabledModIds: Array.from(currentEnabled),
      updatedAt: Date.now(),
    };
    onUpdateProfile(updated);

    // If this is currently the active profile, trigger active switch to relink
    if (focusedProfile.id === activeProfileId) {
      onSelectProfile(focusedProfile.id);
    }
  };

  // Link Tarkov character save to focused profile
  const handleLinkTarkovSave = (playerId: string) => {
    if (!focusedProfile) return;
    const player = playerSaves.find((p) => p.id === playerId);
    const updated: ModProfile = {
      ...focusedProfile,
      linkedSptProfileId: playerId || undefined,
      linkedSptProfileName: player
        ? `${player.name} (${player.side.toUpperCase()} Lvl ${player.level})`
        : undefined,
      updatedAt: Date.now(),
    };
    onUpdateProfile(updated);
    onShowToast(
      'Character Linked',
      player
        ? `Linked character "${player.name}" to loadout "${focusedProfile.name}".`
        : 'Unlinked character save from profile.',
      'info'
    );
  };

  // Open Compare Modal for a specific profile
  const handleOpenCompare = (profileA: ModProfile) => {
    setCompareProfileAId(profileA.id);
    const other = profiles.find((p) => p.id !== profileA.id);
    setCompareProfileBId(other ? other.id : profileA.id);
    setCompareModalOpen(true);
  };

  // Complete Import of a .bsite file
  const handleImportComplete = (
    newProfile: ModProfile,
    missingModsToDownload: BsiteBundleModEntry[]
  ) => {
    onUpdateProfile(newProfile);
    setSelectedProfileId(newProfile.id);
    if (missingModsToDownload.length > 0 && onBatchDownloadMods) {
      onBatchDownloadMods(missingModsToDownload);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#121418] select-none">
      {/* Top Tactical Command Strip */}
      <div className="bg-[#181B20] border-b border-[#23272E] px-5 py-3 flex items-center justify-between gap-4 shrink-0 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-[#EA580C]/15 border border-[#EA580C]/40 flex items-center justify-center">
            <Layers className="w-4 h-4 text-[#EA580C]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-[#E8EAEE] tracking-tight">
                Tactical Mod Profiles & Loadouts
              </h1>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#20252D] text-[#9AA3AF] border border-[#2B303C]">
                {profiles.length} Profiles
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#9AA3AF]">
              <span className="flex items-center gap-1 text-emerald-400 font-mono">
                <Zap className="w-3 h-3 text-emerald-400" />
                NTFS Zero-Copy VFS Active
              </span>
              <span>·</span>
              <span>
                Active Loadout:{' '}
                <strong className="text-white font-medium">{activeProfile.name}</strong> (
                {activeProfile.enabledModIds.length} mods enabled)
              </span>
            </div>
          </div>
        </div>

        {/* Global Toolbar Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {isCreatingProfile ? (
            <form onSubmit={handleSubmitNewProfile} className="flex items-center gap-1.5">
              <input
                type="text"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="New profile name..."
                autoFocus
                className="bg-[#0E1013] border border-[#EA580C] rounded px-2.5 py-1 text-xs text-[#E8EAEE] focus:outline-none w-44"
              />
              <button
                type="submit"
                className="bg-[#16A34A] hover:bg-[#22C55E] text-white text-xs font-semibold px-2.5 py-1 rounded cursor-pointer"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCreatingProfile(false);
                  setNewProfileName('');
                }}
                className="bg-[#20252D] hover:bg-[#282F3A] text-[#9AA3AF] text-xs px-2 py-1 rounded cursor-pointer"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              onClick={() => setIsCreatingProfile(true)}
              className="bg-[#EA580C] hover:bg-[#F97316] text-white text-xs font-semibold px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              title="Create a new tactical mod profile"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Profile</span>
            </button>
          )}

          <button
            onClick={handleTakeCheckpoint}
            className="bg-[#20252D] hover:bg-[#282F3A] border border-[#2B303C] hover:border-[#3A4150] text-[#E8EAEE] text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Create an instant timestamped rollback checkpoint of your current active loadout"
          >
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span>Take Checkpoint</span>
          </button>

          <button
            onClick={() => setImportModalOpen(true)}
            className="bg-[#20252D] hover:bg-[#282F3A] border border-[#2B303C] hover:border-[#3A4150] text-[#E8EAEE] text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Import a .bsite bundle, JSON manifest, or BS- share code"
          >
            <Upload className="w-3.5 h-3.5 text-blue-400" />
            <span>Import / Share Code</span>
          </button>

          <button
            onClick={() => setExportModalProfile(activeProfile)}
            className="bg-[#20252D] hover:bg-[#282F3A] border border-[#2B303C] hover:border-[#3A4150] text-[#E8EAEE] text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Export active loadout as a .bsite bundle or compact BS- share code"
          >
            <Download className="w-3.5 h-3.5 text-[#EA580C]" />
            <span>Export / Share</span>
          </button>

          <button
            onClick={() => {
              setCompareProfileAId(activeProfileId);
              const other = profiles.find((p) => p.id !== activeProfileId);
              setCompareProfileBId(other ? other.id : activeProfileId);
              setCompareModalOpen(true);
            }}
            className="bg-[#20252D] hover:bg-[#282F3A] border border-[#2B303C] hover:border-[#3A4150] text-[#E8EAEE] text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Open side-by-side loadout compare matrix"
          >
            <GitCompare className="w-3.5 h-3.5 text-amber-400" />
            <span>Compare Loadouts</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-[#14161B] border-b border-[#23272E] px-5 py-2.5 flex items-center justify-between gap-3 shrink-0 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-[#6B7480] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search profiles by name, tags, or description..."
            className="w-full bg-[#0E1013] border border-[#23272E] rounded text-xs text-[#E8EAEE] pl-8 pr-3 py-1.5 focus:outline-none focus:border-[#EA580C]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6B7480] hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Tag filters */}
        {allTags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-[#6B7480] mr-1">Filter Tags:</span>
            <button
              onClick={() => setSelectedTag(null)}
              className={`px-2 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
                selectedTag === null
                  ? 'bg-[#EA580C] text-white font-medium'
                  : 'bg-[#20252D] text-[#9AA3AF] hover:text-white'
              }`}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                className={`px-2 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
                  selectedTag === tag
                    ? 'bg-[#EA580C] text-white font-medium'
                    : 'bg-[#20252D] text-[#9AA3AF] hover:text-white'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main Split Interface: Deck (Left) + Inspector Pane (Right) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Tactical Profiles Deck */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-4">
            {filteredProfiles.map((p) => {
              const isActive = p.id === activeProfileId;
              const isSelected = p.id === selectedProfileId;
              const bannerColor = p.bannerColor || '#EA580C';

              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedProfileId(p.id)}
                  className={`bg-[#181B20] border rounded-lg overflow-hidden transition-all duration-150 cursor-pointer flex flex-col ${
                    isSelected
                      ? 'border-[#EA580C] shadow-lg shadow-[#EA580C]/5 ring-1 ring-[#EA580C]'
                      : 'border-[#23272E] hover:border-[#3A4150]'
                  }`}
                >
                  {/* Top Tactical Banner Accent */}
                  <div
                    className="h-1 w-full"
                    style={{ backgroundColor: bannerColor }}
                  />

                  <div className="p-4 flex-1 flex flex-col justify-between">
                    <div>
                      {/* Title & Active Badge */}
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-sm text-[#E8EAEE] tracking-tight truncate">
                            {p.name}
                          </h3>
                          {p.isDefault && (
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#20252D] text-[#9AA3AF]">
                              Default
                            </span>
                          )}
                        </div>

                        {isActive ? (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 text-[11px] font-mono font-semibold shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span>ACTIVE VFS</span>
                          </div>
                        ) : null}
                      </div>

                      {/* Description */}
                      <p className="text-xs text-[#9AA3AF] line-clamp-2 mb-3">
                        {p.description || 'Custom tactical mod profile.'}
                      </p>

                      {/* Tags */}
                      {p.tags && p.tags.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap mb-3">
                          {p.tags.map((t) => (
                            <span
                              key={t}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-[#121418] border border-[#23272E] text-[#6B7480]"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Linked Tarkov Character Profile */}
                      {p.linkedSptProfileName && (
                        <div className="mb-3 px-2 py-1 bg-[#121418] border border-[#23272E] rounded flex items-center gap-1.5 text-xs text-[#9AA3AF]">
                          <User className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span className="text-[11px]">Save Account:</span>
                          <span className="text-[11px] font-medium text-[#E8EAEE] truncate">
                            {p.linkedSptProfileName}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Footer Metrics & Actions */}
                    <div className="border-t border-[#23272E] pt-3 mt-2 flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-[#6B7480]">Mods:</span>
                        <span className="font-mono font-bold text-white">
                          {p.enabledModIds.length}
                        </span>
                        <span className="text-[10px] text-[#6B7480]">
                          / {installedMods.length} in library
                        </span>
                      </div>

                      {/* Card Action Buttons */}
                      <div className="flex items-center gap-1.5">
                        {!isActive ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectProfile(p.id);
                            }}
                            className="bg-[#EA580C] hover:bg-[#F97316] text-white text-xs font-semibold px-2.5 py-1 rounded flex items-center gap-1 transition-colors cursor-pointer shadow-xs"
                            title="Activate this profile and relink NTFS hardlinks"
                          >
                            <Zap className="w-3 h-3" />
                            <span>Activate</span>
                          </button>
                        ) : (
                          <div className="text-[11px] text-emerald-400 font-mono flex items-center gap-1">
                            <Check className="w-3 h-3" />
                            <span>Loaded</span>
                          </div>
                        )}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenCompare(p);
                          }}
                          className="bg-[#20252D] hover:bg-[#282F3A] text-[#9AA3AF] hover:text-white p-1 rounded border border-[#2B303C] transition-colors cursor-pointer"
                          title="Compare with another profile"
                        >
                          <GitCompare className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setExportModalProfile(p);
                          }}
                          className="bg-[#20252D] hover:bg-[#282F3A] text-[#9AA3AF] hover:text-white p-1 rounded border border-[#2B303C] transition-colors cursor-pointer"
                          title="Export .bsite bundle"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCloneProfile(p);
                          }}
                          className="bg-[#20252D] hover:bg-[#282F3A] text-[#9AA3AF] hover:text-white p-1 rounded border border-[#2B303C] transition-colors cursor-pointer"
                          title="Clone profile"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>

                        {!p.isDefault && profiles.length > 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Delete profile "${p.name}"?`)) {
                                onDeleteProfile(p.id);
                              }
                            }}
                            className="bg-[#20252D] hover:bg-red-900/60 text-[#9AA3AF] hover:text-red-300 p-1 rounded border border-[#2B303C] transition-colors cursor-pointer"
                            title="Delete profile"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Selected Profile Inspector Panel */}
        {focusedProfile && (
          <div className="w-[420px] bg-[#14161B] border-l border-[#23272E] flex flex-col shrink-0 overflow-hidden">
            {/* Inspector Header */}
            <div className="px-5 py-4 border-b border-[#23272E] bg-[#181B20] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: focusedProfile.bannerColor || '#EA580C' }}
                />
                <h2 className="text-sm font-bold text-[#E8EAEE] truncate">
                  {focusedProfile.name}
                </h2>
              </div>

              <div className="flex items-center gap-1.5">
                <button
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
              {/* Profile Details Edit Form or Readout */}
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
                    onClick={handleSaveDetails}
                    className="w-full bg-[#EA580C] hover:bg-[#F97316] text-white text-xs font-semibold py-1.5 rounded transition-colors cursor-pointer"
                  >
                    Save Profile Changes
                  </button>
                </div>
              ) : (
                <div className="bg-[#181B20] border border-[#23272E] rounded-lg p-3.5 space-y-2">
                  <p className="text-xs text-[#9AA3AF]">
                    {focusedProfile.description || 'No description provided.'}
                  </p>
                  <div className="text-[11px] text-[#6B7480] flex items-center justify-between pt-1 border-t border-[#23272E]">
                    <span>Created: {focusedProfile.createdDate}</span>
                    <span>
                      Active Mods: <strong>{focusedProfile.enabledModIds.length}</strong>
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
                  <span className="text-[10px] text-[#6B7480]">user/profiles/*.json</span>
                </div>
                <p className="text-[11px] text-[#9AA3AF]">
                  Automatically switches active player character in SPT launcher to prevent missing mod item corruption.
                </p>

                <select
                  value={focusedProfile.linkedSptProfileId || ''}
                  onChange={(e) => handleLinkTarkovSave(e.target.value)}
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
                  <span className="text-[11px] font-mono text-[#6B7480]">
                    {focusedProfile.enabledModIds.length} / {installedMods.length} Enabled
                  </span>
                </div>

                <div className="bg-[#181B20] border border-[#23272E] rounded-lg divide-y divide-[#23272E] max-h-96 overflow-y-auto">
                  {installedMods.map((mod) => {
                    const isModEnabled = focusedProfile.enabledModIds.includes(mod.id);

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
                            onChange={() => handleToggleModInProfile(mod.id)}
                            className="w-3.5 h-3.5 accent-[#EA580C] cursor-pointer shrink-0"
                          />
                          <div className="truncate">
                            <div className="font-medium text-[#E8EAEE] truncate">{mod.name}</div>
                            <div className="text-[10px] text-[#6B7480] flex items-center gap-1.5">
                              <span>v{mod.version}</span>
                              <span>·</span>
                              <span className="uppercase">{mod.kind}</span>
                              <span>·</span>
                              <span>Order #{mod.loadOrder ?? 100}</span>
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => handleToggleModInProfile(mod.id)}
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
                onClick={() => setExportModalProfile(focusedProfile)}
                className="bg-[#20252D] hover:bg-[#282F3A] text-[#E8EAEE] border border-[#2B303C] text-xs font-medium px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export .bsite</span>
              </button>

              {focusedProfile.id !== activeProfileId ? (
                <button
                  onClick={() => onSelectProfile(focusedProfile.id)}
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
        )}
      </div>

      {/* Compare Modal */}
      {compareModalOpen && (
        <ProfileCompareModal
          isOpen={compareModalOpen}
          onClose={() => setCompareModalOpen(false)}
          profiles={profiles}
          installedMods={installedMods}
          initialProfileAId={compareProfileAId}
          initialProfileBId={compareProfileBId}
          onUpdateProfile={onUpdateProfile}
          onShowToast={onShowToast}
        />
      )}

      {/* Export Modal */}
      {exportModalProfile && (
        <BsiteExportModal
          isOpen={Boolean(exportModalProfile)}
          onClose={() => setExportModalProfile(null)}
          profile={exportModalProfile}
          installedMods={installedMods}
          currentSptVersion={sptVersion}
          onShowToast={onShowToast}
        />
      )}

      {/* Import Modal */}
      {importModalOpen && (
        <BsiteImportModal
          isOpen={importModalOpen}
          onClose={() => setImportModalOpen(false)}
          installedMods={installedMods}
          currentSptVersion={sptVersion}
          onImportComplete={handleImportComplete}
          onShowToast={onShowToast}
        />
      )}
    </div>
  );
};
