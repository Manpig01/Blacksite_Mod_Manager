import React from 'react';
import {
  GitCompare,
  Download,
  Copy,
  Trash2,
  Check,
  User,
  Zap,
} from 'lucide-react';
import { ModProfile } from '../../types';

interface ProfileDeckCardProps {
  profile: ModProfile;
  isActive: boolean;
  isSelected: boolean;
  installedModsCount: number;
  canDelete: boolean;
  onSelectCard: (profileId: string) => void;
  onActivateProfile: (profileId: string) => void;
  onCompareProfile: (profile: ModProfile) => void;
  onExportProfile: (profile: ModProfile) => void;
  onCloneProfile: (profile: ModProfile) => void;
  onDeleteProfile: (profileId: string) => void;
}

export const ProfileDeckCard: React.FC<ProfileDeckCardProps> = React.memo(
  ({
    profile,
    isActive,
    isSelected,
    installedModsCount,
    canDelete,
    onSelectCard,
    onActivateProfile,
    onCompareProfile,
    onExportProfile,
    onCloneProfile,
    onDeleteProfile,
  }) => {
    const bannerColor = profile.bannerColor || '#EA580C';

    return (
      <div
        onClick={() => onSelectCard(profile.id)}
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
                  {profile.name}
                </h3>
                {profile.isDefault && (
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#20252D] text-[#9AA3AF]">
                    Default
                  </span>
                )}
              </div>

              {isActive && (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 text-[11px] font-mono font-semibold shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>ACTIVE VFS</span>
                </div>
              )}
            </div>

            {/* Description */}
            <p className="text-xs text-[#9AA3AF] line-clamp-2 mb-3">
              {profile.description || 'Custom tactical mod profile.'}
            </p>

            {/* Tags */}
            {profile.tags && profile.tags.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap mb-3">
                {profile.tags.map((t) => (
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
            {profile.linkedSptProfileName && (
              <div className="mb-3 px-2 py-1 bg-[#121418] border border-[#23272E] rounded flex items-center gap-1.5 text-xs text-[#9AA3AF]">
                <User className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="text-[11px]">Save Account:</span>
                <span className="text-[11px] font-medium text-[#E8EAEE] truncate">
                  {profile.linkedSptProfileName}
                </span>
              </div>
            )}
          </div>

          {/* Footer Metrics & Actions */}
          <div className="border-t border-[#23272E] pt-3 mt-2 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs tabular-nums">
              <span className="text-[#6B7480]">Mods:</span>
              <span className="font-mono font-bold text-white">
                {profile.enabledModIds.length}
              </span>
              <span className="text-[10px] text-[#6B7480]">
                / {installedModsCount} in library
              </span>
            </div>

            {/* Card Action Buttons */}
            <div className="flex items-center gap-1.5">
              {!isActive ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onActivateProfile(profile.id);
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
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCompareProfile(profile);
                }}
                className="bg-[#20252D] hover:bg-[#282F3A] text-[#9AA3AF] hover:text-white p-1 rounded border border-[#2B303C] transition-colors cursor-pointer"
                title="Compare with another profile"
              >
                <GitCompare className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onExportProfile(profile);
                }}
                className="bg-[#20252D] hover:bg-[#282F3A] text-[#9AA3AF] hover:text-white p-1 rounded border border-[#2B303C] transition-colors cursor-pointer"
                title="Export .bsite bundle"
              >
                <Download className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloneProfile(profile);
                }}
                className="bg-[#20252D] hover:bg-[#282F3A] text-[#9AA3AF] hover:text-white p-1 rounded border border-[#2B303C] transition-colors cursor-pointer"
                title="Clone profile"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>

              {canDelete && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteProfile(profile.id);
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
  }
);

ProfileDeckCard.displayName = 'ProfileDeckCard';
