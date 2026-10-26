import React, { useState, useEffect, useMemo } from 'react';
import { Addon } from '../types';
import { Puzzle } from 'lucide-react';
import { buildCandidateImageUrls, useCachedImageCandidates } from './ModThumbnail';
import { parentModResolver } from '../services/parentModResolver';
import { apiService } from '../services/apiService';

interface AddonThumbnailProps {
  addon: Addon;
  className?: string;
  alt?: string;
}

export const AddonThumbnail: React.FC<AddonThumbnailProps> = ({
  addon,
  className = '',
  alt
}) => {
  const [resolvedParentThumb, setResolvedParentThumb] = useState<string | null>(() => {
    if (addon.mod?.thumbnail) return addon.mod.thumbnail;
    if (addon.mod_id) {
      const cached = parentModResolver.getCachedParentMod(addon.mod_id);
      return cached?.thumbnailUrl || null;
    }
    return null;
  });

  // Asynchronously resolve parent mod thumbnail if missing using coalesced requests
  useEffect(() => {
    let active = true;
    if (!addon.thumbnail && !addon.mod?.thumbnail && addon.mod_id && !resolvedParentThumb) {
      parentModResolver
        .getParentMod(addon.mod_id, async (id) => {
          const mod = await apiService.getMod(id);
          if (!mod) return null;
          return {
            id: mod.id,
            name: mod.name,
            thumbnailUrl: mod.thumbnail ?? null,
            latestVersion: mod.versions?.[0]?.version || '1.0.0',
            isInstalled: false,
          };
        })
        .then((res) => {
          if (active && res?.thumbnailUrl) {
            setResolvedParentThumb(res.thumbnailUrl);
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [addon.thumbnail, addon.mod?.thumbnail, addon.mod_id, resolvedParentThumb]);

  const candidateImages = useMemo(
    () =>
      buildCandidateImageUrls([
        addon.thumbnail,
        addon.mod?.thumbnail || resolvedParentThumb,
        addon.authors?.[0]?.avatar,
      ]),
    [addon.thumbnail, addon.mod?.thumbnail, resolvedParentThumb, addon.authors]
  );

  const { currentImageUrl, isLoaded, hasAllFailed, handleImageError, handleImageLoad } =
    useCachedImageCandidates(candidateImages);

  // Render tactical fallback artwork when no images are available or all candidates fail
  const renderTacticalArtwork = () => {
    const parentName = addon.mod?.name || 'Modular Preset';

    return (
      <div className="w-full h-full bg-gradient-to-br from-[#1C1A17] via-[#141312] to-[#0D0C0B] flex flex-col items-center justify-center p-3 relative overflow-hidden select-none">
        {/* Subtle tactical grid pattern */}
        <div className="absolute inset-0 opacity-15 bg-[linear-gradient(to_right,#EA580C15_1px,transparent_1px),linear-gradient(to_bottom,#EA580C15_1px,transparent_1px)] bg-[size:10px_10px]" />

        <div className="w-14 h-14 rounded-xl border border-[#EA580C]/30 bg-[#EA580C]/5 flex items-center justify-center relative shadow-inner">
          <Puzzle className="w-7 h-7 text-[#EA580C]/80" />
          <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#EA580C] animate-pulse" />
        </div>

        <div className="mt-2 text-center z-10 px-2 max-w-full">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[#EA580C] font-bold block truncate">
            ADDON PRESET
          </span>
          <span className="text-[9px] text-[#9AA3AF] truncate block max-w-[180px] opacity-75 mt-0.5" title={parentName}>
            {parentName}
          </span>
        </div>
      </div>
    );
  };

  if (hasAllFailed || !currentImageUrl) {
    return <div className={`w-full h-full ${className}`}>{renderTacticalArtwork()}</div>;
  }

  return (
    <div className={`relative w-full h-full bg-[#101216] overflow-hidden ${className}`}>
      {/* Background placeholder while image is decoding */}
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#15181E] animate-pulse">
          <Puzzle className="w-6 h-6 text-[#9AA3AF]/30" />
        </div>
      )}

      <img
        src={currentImageUrl}
        alt={alt || addon.name}
        onLoad={handleImageLoad}
        onError={handleImageError}
        loading="lazy"
        className={`w-full h-full object-cover transition-all duration-300 ${
          isLoaded ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`}
      />
    </div>
  );
};
