import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Layers,
  Plus,
  GitCompare,
  Upload,
  Download,
  Zap,
  Search,
  Clock,
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
import { ProfileDeckCard } from './profiles/ProfileDeckCard';
import { ProfileInspectorPanel } from './profiles/ProfileInspectorPanel';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [selectedProfileId, setSelectedProfileId] = useState<string>(() => {
    return activeProfileId || profiles[0]?.id || '';
  });

  useEffect(() => {
    if (!profiles.some((p) => p.id === selectedProfileId)) {
      setSelectedProfileId(activeProfileId || profiles[0]?.id || '');
    }
  }, [profiles, selectedProfileId, activeProfileId]);

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

  const focusedProfile = useMemo(() => {
    return profiles.find((p) => p.id === selectedProfileId) || profiles[0];
  }, [profiles, selectedProfileId]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    profiles.forEach((p) => {
      (p.tags || []).forEach((t) => set.add(t));
    });
    return Array.from(set);
  }, [profiles]);

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

  const activeProfile = useMemo(() => {
    return profiles.find((p) => p.id === activeProfileId) || profiles[0];
  }, [profiles, activeProfileId]);

  const handleCloneProfile = useCallback(
    (source: ModProfile) => {
      const cloned = profileService.cloneProfile(source);
      onUpdateProfile(cloned);
      setSelectedProfileId(cloned.id);
      onShowToast('Profile Cloned', `Created clone "${cloned.name}".`, 'success');
    },
    [onUpdateProfile, onShowToast]
  );

  const handleTakeCheckpoint = useCallback(() => {
    if (!activeProfile) return;
    const checkpoint = profileService.createCheckpoint(activeProfile, installedMods, sptVersion);
    onUpdateProfile(checkpoint);
    setSelectedProfileId(checkpoint.id);
    onShowToast(
      'Checkpoint Saved',
      `Saved rollback snapshot "${checkpoint.name}" (${checkpoint.enabledModIds.length} active mods).`,
      'success'
    );
  }, [activeProfile, installedMods, sptVersion, onUpdateProfile, onShowToast]);

  const handleSubmitNewProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newProfileName.trim();
    if (!trimmed) return;
    onCreateProfile(trimmed);
    setNewProfileName('');
    setIsCreatingProfile(false);
  };

  const handleToggleModInProfile = useCallback(
    (modId: string) => {
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

      if (focusedProfile.id === activeProfileId) {
        onSelectProfile(focusedProfile.id);
      }
    },
    [focusedProfile, activeProfileId, onUpdateProfile, onSelectProfile]
  );

  const handleLinkTarkovSave = useCallback(
    (playerId: string) => {
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
    },
    [focusedProfile, playerSaves, onUpdateProfile, onShowToast]
  );

  const handleOpenCompare = useCallback(
    (profileA: ModProfile) => {
      setCompareProfileAId(profileA.id);
      const other = profiles.find((p) => p.id !== profileA.id);
      setCompareProfileBId(other ? other.id : profileA.id);
      setCompareModalOpen(true);
    },
    [profiles]
  );

  const handleImportComplete = useCallback(
    (newProfile: ModProfile, missingModsToDownload: BsiteBundleModEntry[]) => {
      onUpdateProfile(newProfile);
      setSelectedProfileId(newProfile.id);
      if (missingModsToDownload.length > 0 && onBatchDownloadMods) {
        onBatchDownloadMods(missingModsToDownload);
      }
    },
    [onUpdateProfile, onBatchDownloadMods]
  );

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
              <span className="text-[11px] font-mono tabular-nums px-2 py-0.5 rounded bg-[#20252D] text-[#9AA3AF] border border-[#2B303C]">
                {profiles.length} Profiles
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-[#9AA3AF]">
              <span className="flex items-center gap-1 text-emerald-400 font-mono">
                <Zap className="w-3 h-3 text-emerald-400" />
                NTFS Zero-Copy VFS Active
              </span>
              <span>·</span>
              <span className="tabular-nums">
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
              type="button"
              onClick={() => setIsCreatingProfile(true)}
              className="bg-[#EA580C] hover:bg-[#F97316] text-white text-xs font-semibold px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              title="Create a new tactical mod profile"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Profile</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleTakeCheckpoint}
            className="bg-[#20252D] hover:bg-[#282F3A] border border-[#2B303C] hover:border-[#3A4150] text-[#E8EAEE] text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Create an instant timestamped rollback checkpoint of your current active loadout"
          >
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span>Take Checkpoint</span>
          </button>

          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="bg-[#20252D] hover:bg-[#282F3A] border border-[#2B303C] hover:border-[#3A4150] text-[#E8EAEE] text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Import a .bsite bundle, JSON manifest, or BS- share code"
          >
            <Upload className="w-3.5 h-3.5 text-blue-400" />
            <span>Import / Share Code</span>
          </button>

          <button
            type="button"
            onClick={() => setExportModalProfile(activeProfile)}
            className="bg-[#20252D] hover:bg-[#282F3A] border border-[#2B303C] hover:border-[#3A4150] text-[#E8EAEE] text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Export active loadout as a .bsite bundle or compact BS- share code"
          >
            <Download className="w-3.5 h-3.5 text-[#EA580C]" />
            <span>Export / Share</span>
          </button>

          <button
            type="button"
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
            ref={searchInputRef}
            data-global-search="true"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search profiles by name, tags, or description..."
            className="w-full bg-[#0E1013] border border-[#23272E] rounded text-xs text-[#E8EAEE] pl-8 pr-14 py-1.5 focus:outline-none focus:border-[#EA580C]"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                searchInputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6B7480] hover:text-white cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          ) : (
            <kbd
              onClick={() => searchInputRef.current?.focus()}
              className="hidden sm:inline-block absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-mono text-[#6B7480] bg-[#181B20] border border-[#2A2F38] rounded cursor-pointer hover:border-[#EA580C]"
              title="Press Ctrl+K or '/' to focus search"
            >
              Ctrl K
            </kbd>
          )}
        </div>

        {/* Tag filters */}
        {allTags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-[#6B7480] mr-1">Filter Tags:</span>
            <button
              type="button"
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
                type="button"
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
            {filteredProfiles.map((p) => (
              <ProfileDeckCard
                key={p.id}
                profile={p}
                isActive={p.id === activeProfileId}
                isSelected={p.id === selectedProfileId}
                installedModsCount={installedMods.length}
                canDelete={!p.isDefault && profiles.length > 1}
                onSelectCard={setSelectedProfileId}
                onActivateProfile={onSelectProfile}
                onCompareProfile={handleOpenCompare}
                onExportProfile={setExportModalProfile}
                onCloneProfile={handleCloneProfile}
                onDeleteProfile={onDeleteProfile}
              />
            ))}
          </div>
        </div>

        {/* Right: Selected Profile Inspector Panel */}
        {focusedProfile && (
          <ProfileInspectorPanel
            profile={focusedProfile}
            isActive={focusedProfile.id === activeProfileId}
            installedMods={installedMods}
            playerSaves={playerSaves}
            onUpdateProfile={onUpdateProfile}
            onActivateProfile={onSelectProfile}
            onExportProfile={setExportModalProfile}
            onToggleModInProfile={handleToggleModInProfile}
            onLinkTarkovSave={handleLinkTarkovSave}
            onShowToast={onShowToast}
          />
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
