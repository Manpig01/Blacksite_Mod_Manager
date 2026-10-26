import React from 'react';
import { History, ExternalLink, Download, Sparkles, Heart, Calendar, ThumbsUp } from 'lucide-react';
import { Mod } from '../../types';
import { getSptBadgeClass } from '../../utils/versionUtils';
import { ModThumbnail } from '../ModThumbnail';

export function formatForgeDate(dateString?: string | null): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

  if (diffHours < 24 && date.getDate() === now.getDate()) {
    return `Today at ${timeStr}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.getDate() === yesterday.getDate() && date.getMonth() === yesterday.getMonth()) {
    return `Yesterday at ${timeStr}`;
  }
  if (diffDays < 7) {
    const dayName = date.toLocaleDateString([], { weekday: 'long' });
    return `${dayName} at ${timeStr}`;
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

interface BrowseModCardProps {
  mod: Mod;
  isInstalled: boolean;
  isFavorite: boolean;
  displayVersion: string;
  matchingVersion?: string;
  activeTargetSptVersion: string;
  onToggleFavorite: (mod: Mod, e?: React.MouseEvent) => void;
  onOpenVersions: (mod: Mod) => void;
  onInstallMod: (mod: Mod, version?: string, targetSptVersion?: string) => void;
}

export const BrowseModCard: React.FC<BrowseModCardProps> = React.memo(
  ({
    mod,
    isInstalled,
    isFavorite,
    displayVersion,
    matchingVersion,
    activeTargetSptVersion,
    onToggleFavorite,
    onOpenVersions,
    onInstallMod,
  }) => {
    const authorName = mod.owner?.name || 'Unknown';
    const formattedDate = formatForgeDate(mod.published_at);

    return (
      <div className="h-[210px] bg-[#181B20] border border-[#23272E] hover:border-[#EA580C] rounded-lg p-3 transition-colors flex gap-3 relative group">
        {/* Top-Right Favorite Heart Toggle Button */}
        <button
          type="button"
          onClick={(e) => onToggleFavorite(mod, e)}
          className={`absolute top-2.5 right-2.5 z-10 p-1.5 rounded-full transition-all cursor-pointer ${
            isFavorite
              ? 'bg-[#2A1015] border border-[#EF4444] text-[#EF4444] shadow-[0_0_8px_rgba(239,68,68,0.35)] scale-105'
              : 'bg-[#20252D]/85 hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-[#EF4444] border border-[#2A2F38] hover:border-[#EF4444]/40 opacity-80 group-hover:opacity-100'
          }`}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-label={isFavorite ? `Remove ${mod.name} from favorites` : `Add ${mod.name} to favorites`}
        >
          <Heart
            className={`w-3.5 h-3.5 transition-transform active:scale-125 ${
              isFavorite ? 'fill-[#EF4444] text-[#EF4444]' : ''
            }`}
          />
        </button>

        {/* Thumbnail column (135x135) with Forge hotlink proxy image */}
        <ModThumbnail mod={mod} />

        {/* Content area right */}
        <div className="flex-1 flex flex-col justify-between overflow-hidden min-w-0 pr-6">
          <div>
            {/* Title + Version */}
            <div className="flex items-baseline gap-2 truncate pr-2">
              <h3
                className="text-[14px] font-bold text-[#E8EAEE] tracking-tight truncate"
                title={mod.name}
              >
                {mod.name}
              </h3>
              {displayVersion && (
                <span className="text-[11.5px] font-normal text-[#9AA3AF] shrink-0 font-mono tabular-nums">
                  {displayVersion}
                </span>
              )}
            </div>

            {/* Author */}
            <p className="text-[11.5px] text-[#9AA3AF] mt-0.5 truncate">
              Created by <span className="text-[#C2C9D6] font-medium">{authorName}</span>
            </p>

            {/* Badges row */}
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span
                className={`${getSptBadgeClass(activeTargetSptVersion)} text-[10px] font-bold px-2 py-0.5 rounded shadow-sm tabular-nums`}
                title={`Engineered / compatible with SPT ${activeTargetSptVersion}`}
              >
                SPT {activeTargetSptVersion}
              </span>
              {mod.fika_compatibility && (
                <span className="bg-[#0E2A18] text-[#4ADE80] border border-[#16A34A]/40 text-[10px] font-semibold px-2 py-0.5 rounded">
                  Fika
                </span>
              )}
              {mod.category?.title && (
                <span className="bg-[#20252D] border border-[#23272E] text-[#9AA3AF] text-[10px] px-2 py-0.5 rounded">
                  {mod.category.title}
                </span>
              )}
              {mod.featured && (
                <span className="bg-[#EA580C]/20 border border-[#EA580C]/50 text-[#EA580C] text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5">
                  <Sparkles className="w-2.5 h-2.5" /> Featured
                </span>
              )}
            </div>

            {/* 2-line teaser description with word ellipsis */}
            <p
              className="text-[11.5px] text-[#9AA3AF] mt-1.5 line-clamp-2 leading-[16px]"
              title={mod.teaser || ''}
            >
              {mod.teaser || 'No description provided.'}
            </p>
          </div>

          {/* Bottom metadata row matching Forge website */}
          <div className="flex items-center justify-between pt-1.5 border-t border-[#23272E]/60 gap-1.5">
            <div className="flex items-center gap-2 text-[11px] text-[#9AA3AF] truncate">
              {formattedDate && (
                <span className="flex items-center gap-1 text-[#848E9C]" title={mod.published_at || ''}>
                  <Calendar className="w-3 h-3 text-[#6B7480]" />
                  <span className="truncate">{formattedDate}</span>
                </span>
              )}
              {mod.favourites_count > 0 && (
                <span className="flex items-center gap-0.5 text-[#F87171]" title={`${mod.favourites_count} favorites`}>
                  <span>❤️</span>
                  <span className="font-mono tabular-nums text-[10.5px]">{mod.favourites_count}</span>
                </span>
              )}
              {mod.endorsements_count > 0 && (
                <span className="flex items-center gap-0.5 text-[#FBBF24]" title={`${mod.endorsements_count} endorsements`}>
                  <ThumbsUp className="w-3 h-3 text-[#FBBF24]" />
                  <span className="font-mono tabular-nums text-[10.5px]">{mod.endorsements_count}</span>
                </span>
              )}
              <span className="flex items-center gap-0.5 text-[#9AA3AF]" title={`${mod.downloads.toLocaleString()} downloads`}>
                <Download className="w-3 h-3 text-[#6B7480]" />
                <span className="font-mono tabular-nums text-[10.5px]">{mod.downloads.toLocaleString()}</span>
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => onOpenVersions(mod)}
                className="h-6 px-2 bg-[#20252D] hover:bg-[#2A2F38] text-[#E8EAEE] rounded text-[10.5px] flex items-center gap-1 transition-colors cursor-pointer"
                title="Pick a specific release"
                type="button"
              >
                <History className="w-3 h-3 text-[#9AA3AF]" />
                <span>Versions</span>
              </button>

              {mod.detail_url && (
                <a
                  href={mod.detail_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-6 px-1.5 bg-[#20252D] hover:bg-[#2A2F38] text-[#9AA3AF] hover:text-[#E8EAEE] rounded text-[10.5px] flex items-center transition-colors"
                  title="Open on sp-mod.com"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}

              <button
                onClick={() => {
                  const ver = matchingVersion || (displayVersion ? displayVersion.replace(/^v/i, '') : undefined);
                  onInstallMod(mod, ver, activeTargetSptVersion);
                }}
                className="h-6 px-2.5 bg-[#16A34A] hover:bg-[#22C55E] text-white rounded text-[10.5px] font-semibold flex items-center gap-1 transition-colors shadow-sm cursor-pointer"
                title={`Download and install ${mod.name} ${displayVersion} for SPT ${activeTargetSptVersion}`}
                type="button"
              >
                <Download className="w-3 h-3" />
                <span>{isInstalled ? 'Reinstall' : 'Install'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

BrowseModCard.displayName = 'BrowseModCard';
