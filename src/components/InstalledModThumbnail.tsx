import React, { useMemo } from 'react';
import { InstalledMod, FileCollision } from '../types';
import { Bot, Cpu, Eye, ShoppingBag, Wrench, Package, AlertTriangle, AlertCircle } from 'lucide-react';
import { buildCandidateImageUrls, useCachedImageCandidates } from './ModThumbnail';
import { getKnownDependencyMeta } from '../data/knownDependencies';

interface InstalledModThumbnailProps {
  mod: InstalledMod;
  collision?: FileCollision;
  hasMissingDeps?: boolean;
  missingDepSummary?: string[];
  onNavigateConflicts?: () => void;
  className?: string;
}

export const InstalledModThumbnail: React.FC<InstalledModThumbnailProps> = ({
  mod,
  collision,
  hasMissingDeps,
  missingDepSummary = [],
  onNavigateConflicts,
  className = '',
}) => {
  const candidateImages = useMemo(() => {
    const known =
      getKnownDependencyMeta(mod.id) ||
      getKnownDependencyMeta(mod.name) ||
      getKnownDependencyMeta(mod.modId);
    const hubId = (mod as any).hub_id;

    return buildCandidateImageUrls([
      mod.thumbnail,
      known?.thumbnail,
      hubId ? `https://files.sp-mod.com/mods/${hubId}.png` : null,
      hubId ? `https://files.sp-mod.com/mods/${hubId}.jpg` : null,
      mod.modId ? `https://files.sp-mod.com/mods/${mod.modId}.png` : null,
      mod.modId ? `https://files.sp-mod.com/mods/${mod.modId}.jpg` : null,
    ]);
  }, [mod.thumbnail, mod.id, mod.name, mod.modId, (mod as any).hub_id]);

  const { currentImageUrl, isLoaded, hasAllFailed, handleImageError, handleImageLoad } =
    useCachedImageCandidates(candidateImages);

  // Thematic Category Graphic Fallback Renderer
  const renderCategoryArtwork = () => {
    const nameLower = mod.name.toLowerCase();
    const idLower = mod.id.toLowerCase();
    const cat = (mod.categoryTitle || '').toLowerCase();

    if (cat.includes('bot') || nameLower.includes('bot') || nameLower.includes('sain') || nameLower.includes('brain')) {
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#1E1528] via-[#14121F] to-[#0D0B14] flex flex-col items-center justify-center p-2 relative select-none">
          <Bot className="w-8 h-8 text-[#A78BFA] opacity-80" />
          <span className="text-[9.5px] font-mono uppercase tracking-wider text-[#A78BFA] mt-1 font-semibold">BOTS</span>
        </div>
      );
    }

    if (cat.includes('overhaul') || nameLower.includes('svm') || nameLower.includes('server') || mod.kind === 'Server') {
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#261B0F] via-[#1B140B] to-[#0F0C07] flex flex-col items-center justify-center p-2 relative select-none">
          <Cpu className="w-8 h-8 text-[#FBBF24] opacity-80" />
          <span className="text-[9.5px] font-mono uppercase tracking-wider text-[#FBBF24] mt-1 font-semibold">SERVER</span>
        </div>
      );
    }

    if (cat.includes('visual') || cat.includes('retexture') || nameLower.includes('graphic') || nameLower.includes('light')) {
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#0B2228] via-[#08181D] to-[#050E12] flex flex-col items-center justify-center p-2 relative select-none">
          <Eye className="w-8 h-8 text-[#22D3EE] opacity-80" />
          <span className="text-[9.5px] font-mono uppercase tracking-wider text-[#22D3EE] mt-1 font-semibold">VISUALS</span>
        </div>
      );
    }

    if (cat.includes('trader') || nameLower.includes('trader') || nameLower.includes('flea')) {
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#0B2519] via-[#081B12] to-[#040E0A] flex flex-col items-center justify-center p-2 relative select-none">
          <ShoppingBag className="w-8 h-8 text-[#34D399] opacity-80" />
          <span className="text-[9.5px] font-mono uppercase tracking-wider text-[#34D399] mt-1 font-semibold">TRADER</span>
        </div>
      );
    }

    if (cat.includes('tool') || idLower.includes('commonlib') || nameLower.includes('wtt') || nameLower.includes('tool')) {
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#1E242B] via-[#15191E] to-[#0D1013] flex flex-col items-center justify-center p-2 relative select-none">
          <Wrench className="w-8 h-8 text-[#94A3B8] opacity-80" />
          <span className="text-[9.5px] font-mono uppercase tracking-wider text-[#94A3B8] mt-1 font-semibold">TOOLS</span>
        </div>
      );
    }

    return (
      <div className="w-full h-full bg-[#181B20] flex flex-col items-center justify-center p-2 relative select-none">
        <Package className="w-8 h-8 text-[#EA580C] opacity-70" />
        <span className="text-[9.5px] font-mono uppercase tracking-wider text-[#E8EAEE] mt-1 font-semibold">
          {mod.name.slice(0, 10)}
        </span>
      </div>
    );
  };

  return (
    <div
      className={`w-[125px] h-[125px] shrink-0 relative bg-[#181B20] rounded-md overflow-hidden self-center border border-[#23272E] ${
        mod.isDisabled ? 'opacity-70 grayscale' : ''
      } ${className}`}
    >
      {/* Loading shimmer */}
      {!isLoaded && !hasAllFailed && currentImageUrl && (
        <div className="absolute inset-0 bg-[#16191F] flex items-center justify-center">
          <div className="w-7 h-7 rounded border border-[#2A2F38] border-dashed animate-spin text-[#6B7480]" />
        </div>
      )}

      {/* Render Image */}
      {currentImageUrl && (
        <img
          src={currentImageUrl}
          alt={mod.name}
          loading="lazy"
          decoding="async"
          onError={handleImageError}
          onLoad={handleImageLoad}
          className={`w-full h-full object-cover transition-opacity duration-200 ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {/* Fallback Artwork */}
      {(!currentImageUrl || hasAllFailed) && renderCategoryArtwork()}

      {/* Top-left: green SPT version badge */}
      <div className="absolute top-1 left-1 bg-[#16A34A] rounded px-1.5 py-0.5 text-[9.5px] font-semibold text-white tracking-tight shadow">
        SPT {mod.sptVersion || '4.x'}
      </div>

      {/* Top-right: Conflict Warning Badge */}
      {collision && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (onNavigateConflicts) onNavigateConflicts();
          }}
          className="absolute top-1 right-1 bg-[#3A2A10] border border-[#F59E0B] text-[#F59E0B] rounded px-1.5 py-0.5 text-[9.5px] font-bold flex items-center gap-0.5 cursor-pointer shadow hover:bg-[#4A3515] transition-colors z-10"
          title={`${collision.relativePath}: ${collision.details}`}
          type="button"
        >
          <AlertTriangle className="w-2.5 h-2.5" />
          <span>CONFLICT</span>
        </button>
      )}

      {/* Bottom-left: Fika Compatible overlay */}
      {mod.fikaCompatibility && !hasMissingDeps && (
        <div className="absolute bottom-1 left-1 bg-[#0E2A18] border border-[#16A34A] rounded px-1.5 py-0.5 text-[9.5px] font-semibold text-[#22C55E] tracking-tight shadow">
          Fika Compatible
        </div>
      )}

      {/* Bottom-right: Missing Dependency Badge */}
      {hasMissingDeps && (
        <div
          className="absolute bottom-1 right-1 bg-[#DC2626] border border-white/30 text-white rounded px-1.5 py-0.5 text-[9px] font-extrabold flex items-center gap-0.5 shadow-md animate-pulse"
          title={`Missing dependencies: ${missingDepSummary.join(', ')}`}
        >
          <AlertCircle className="w-2.5 h-2.5" />
          <span>MISSING DEP</span>
        </div>
      )}
    </div>
  );
};
