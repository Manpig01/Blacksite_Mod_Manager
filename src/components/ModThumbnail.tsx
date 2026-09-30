import React, { useState } from 'react';
import { Mod } from '../types';
import { Bot, Cpu, Eye, ShoppingBag, Crosshair, Volume2, Compass, Wrench, Package } from 'lucide-react';

export function getProxiedForgeImageUrl(url?: string | null): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/api/forge-image') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }
  // In Electron desktop environment, return direct HTTPS URL because main process
  // webRequest.onBeforeSendHeaders automatically attaches Referer: https://sp-mod.com/
  if (typeof window !== 'undefined' && (window as any).desktopBridge?.isElectron) {
    return trimmed;
  }
  if (trimmed.includes('sp-mod.com') || trimmed.includes('files.sp-mod.com')) {
    return `/api/forge-image?url=${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
}

interface ModThumbnailProps {
  mod: Mod;
  className?: string;
}

export const ModThumbnail: React.FC<ModThumbnailProps> = ({ mod, className = '' }) => {
  // Build prioritized list of candidate URLs
  const candidateImages = React.useMemo(() => {
    const urls: string[] = [];
    const isDesktop = typeof window !== 'undefined' && Boolean((window as any).desktopBridge?.isElectron);

    const addCandidate = (rawUrl?: string | null) => {
      if (!rawUrl) return;
      const trimmed = rawUrl.trim();
      if (!trimmed) return;
      if (isDesktop) {
        // In desktop mode, direct URLs work natively with Electron header injection
        if (!urls.includes(trimmed)) {
          urls.push(trimmed);
        }
      } else {
        const proxied = getProxiedForgeImageUrl(trimmed);
        if (proxied && !urls.includes(proxied)) {
          urls.push(proxied);
        }
        if (!urls.includes(trimmed) && trimmed !== proxied) {
          urls.push(trimmed);
        }
      }
    };

    if (mod.thumbnail) {
      addCandidate(mod.thumbnail);
    }

    if (mod.hub_id) {
      addCandidate(`https://files.sp-mod.com/mods/${mod.hub_id}.png`);
      addCandidate(`https://files.sp-mod.com/mods/${mod.hub_id}.jpg`);
    }

    if (mod.owner?.profile_photo_url) {
      addCandidate(mod.owner.profile_photo_url);
    }

    return urls;
  }, [mod.thumbnail, mod.hub_id, mod.owner?.profile_photo_url]);

  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [hasAllFailed, setHasAllFailed] = useState<boolean>(candidateImages.length === 0);

  React.useEffect(() => {
    setCurrentIndex(0);
    setDataUrl(null);
    setIsLoaded(false);
    setHasAllFailed(candidateImages.length === 0);
  }, [candidateImages]);

  const handleImageError = async () => {
    // If running in desktop app, try fetching via IPC data URL before giving up on current candidate
    const currentUrl = candidateImages[currentIndex];
    const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
    if (bridge?.fetchImageDataUrl && currentUrl && !currentUrl.startsWith('data:') && !dataUrl) {
      try {
        const base64 = await bridge.fetchImageDataUrl(currentUrl);
        if (base64) {
          setDataUrl(base64);
          setIsLoaded(false);
          return;
        }
      } catch (e) {
        console.error('IPC image fetch failed:', e);
      }
    }

    setDataUrl(null);
    if (currentIndex < candidateImages.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setIsLoaded(false);
    } else {
      setHasAllFailed(true);
    }
  };

  const handleImageLoad = () => {
    setIsLoaded(true);
  };

  const currentImageUrl = !hasAllFailed ? (dataUrl || candidateImages[currentIndex]) : null;

  // Thematic Category Graphic Fallback Renderer
  const renderCategoryArtwork = () => {
    const catSlug = mod.category?.slug?.toLowerCase() || '';
    const catTitle = mod.category?.title?.toLowerCase() || '';

    if (catSlug === 'bots' || catTitle.includes('bot') || catTitle.includes('ai')) {
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#1E1528] via-[#14121F] to-[#0D0B14] flex flex-col items-center justify-center p-3 relative overflow-hidden select-none">
          <div className="absolute inset-0 opacity-20 bg-[linear-gradient(to_right,#8B5CF615_1px,transparent_1px),linear-gradient(to_bottom,#8B5CF615_1px,transparent_1px)] bg-[size:12px_12px]" />
          <div className="w-16 h-16 rounded-full border border-[#8B5CF6]/30 flex items-center justify-center relative">
            <div className="w-10 h-10 rounded-full border border-dashed border-[#8B5CF6]/50 flex items-center justify-center animate-spin" style={{ animationDuration: '24s' }} />
            <Bot className="w-7 h-7 text-[#A78BFA] absolute z-10" />
            <div className="absolute w-full h-[1px] bg-[#8B5CF6]/30" />
            <div className="absolute h-full w-[1px] bg-[#8B5CF6]/30" />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#A78BFA] mt-2 font-semibold z-10">
            BOTS & AI
          </span>
        </div>
      );
    }

    if (catSlug === 'overhauls' || catTitle.includes('overhaul') || catTitle.includes('server')) {
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#261B0F] via-[#1B140B] to-[#0F0C07] flex flex-col items-center justify-center p-3 relative overflow-hidden select-none">
          <div className="absolute inset-0 opacity-20 bg-[linear-gradient(to_right,#F59E0B15_1px,transparent_1px),linear-gradient(to_bottom,#F59E0B15_1px,transparent_1px)] bg-[size:12px_12px]" />
          <div className="w-16 h-16 rounded-lg border border-[#F59E0B]/30 flex items-center justify-center relative bg-[#F59E0B]/5">
            <Cpu className="w-8 h-8 text-[#FBBF24]" />
            <div className="absolute top-1 left-1 w-1.5 h-1.5 rounded-full bg-[#10B981] animate-ping" />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#FBBF24] mt-2 font-semibold z-10">
            SVM / OVERHAUL
          </span>
        </div>
      );
    }

    if (catSlug === 'retextures' || catTitle.includes('visual') || catTitle.includes('graphic')) {
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#0B2228] via-[#08181D] to-[#050E12] flex flex-col items-center justify-center p-3 relative overflow-hidden select-none">
          <div className="absolute inset-0 opacity-20 bg-[linear-gradient(to_right,#06B6D415_1px,transparent_1px),linear-gradient(to_bottom,#06B6D415_1px,transparent_1px)] bg-[size:12px_12px]" />
          <div className="w-16 h-16 rounded-full border border-[#06B6D4]/40 flex items-center justify-center relative">
            <Eye className="w-8 h-8 text-[#22D3EE]" />
            <div className="absolute inset-1 rounded-full border border-dashed border-[#06B6D4]/30" />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#22D3EE] mt-2 font-semibold z-10">
            VISUALS & SHADERS
          </span>
        </div>
      );
    }

    if (catSlug === 'traders' || catTitle.includes('trader')) {
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#0B2519] via-[#081B12] to-[#040E0A] flex flex-col items-center justify-center p-3 relative overflow-hidden select-none">
          <div className="absolute inset-0 opacity-20 bg-[linear-gradient(to_right,#10B98115_1px,transparent_1px),linear-gradient(to_bottom,#10B98115_1px,transparent_1px)] bg-[size:12px_12px]" />
          <div className="w-16 h-16 rounded-lg border border-[#10B981]/30 flex items-center justify-center relative bg-[#10B981]/5">
            <ShoppingBag className="w-8 h-8 text-[#34D399]" />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#34D399] mt-2 font-semibold z-10">
            FLEA & TRADER
          </span>
        </div>
      );
    }

    if (catSlug === 'weapons' || catSlug === 'items' || catTitle.includes('weapon') || catTitle.includes('item')) {
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#2A1215] via-[#1D0C0F] to-[#120709] flex flex-col items-center justify-center p-3 relative overflow-hidden select-none">
          <div className="absolute inset-0 opacity-20 bg-[linear-gradient(to_right,#EF444415_1px,transparent_1px),linear-gradient(to_bottom,#EF444415_1px,transparent_1px)] bg-[size:12px_12px]" />
          <div className="w-16 h-16 rounded-full border border-[#EF4444]/30 flex items-center justify-center relative">
            <Crosshair className="w-8 h-8 text-[#F87171]" />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#F87171] mt-2 font-semibold z-10">
            WEAPONS & GEAR
          </span>
        </div>
      );
    }

    if (catSlug === 'audio' || catTitle.includes('audio') || catTitle.includes('sound')) {
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#28131E] via-[#1A0C14] to-[#10070C] flex flex-col items-center justify-center p-3 relative overflow-hidden select-none">
          <div className="absolute inset-0 opacity-20 bg-[linear-gradient(to_right,#F43F5E15_1px,transparent_1px),linear-gradient(to_bottom,#F43F5E15_1px,transparent_1px)] bg-[size:12px_12px]" />
          <div className="w-16 h-16 rounded-full border border-[#F43F5E]/30 flex items-center justify-center relative">
            <Volume2 className="w-8 h-8 text-[#FB7185]" />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#FB7185] mt-2 font-semibold z-10">
            TACTICAL AUDIO
          </span>
        </div>
      );
    }

    if (catSlug === 'quests' || catTitle.includes('quest') || catSlug === 'other') {
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#261E0E] via-[#1A1409] to-[#0E0B05] flex flex-col items-center justify-center p-3 relative overflow-hidden select-none">
          <div className="absolute inset-0 opacity-20 bg-[linear-gradient(to_right,#EAB30815_1px,transparent_1px),linear-gradient(to_bottom,#EAB30815_1px,transparent_1px)] bg-[size:12px_12px]" />
          <div className="w-16 h-16 rounded-full border border-[#EAB308]/30 flex items-center justify-center relative">
            <Compass className="w-8 h-8 text-[#FDE047]" />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#FDE047] mt-2 font-semibold z-10">
            NAV & EXPEDITION
          </span>
        </div>
      );
    }

    if (catSlug === 'hideout' || catSlug === 'tools' || catTitle.includes('tool')) {
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#1E242B] via-[#15191E] to-[#0D1013] flex flex-col items-center justify-center p-3 relative overflow-hidden select-none">
          <div className="absolute inset-0 opacity-20 bg-[linear-gradient(to_right,#64748B15_1px,transparent_1px),linear-gradient(to_bottom,#64748B15_1px,transparent_1px)] bg-[size:12px_12px]" />
          <div className="w-16 h-16 rounded-lg border border-[#64748B]/30 flex items-center justify-center relative">
            <Wrench className="w-8 h-8 text-[#94A3B8]" />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#94A3B8] mt-2 font-semibold z-10">
            TOOLS & CORE
          </span>
        </div>
      );
    }

    // Default fallback
    return (
      <div className="w-full h-full bg-gradient-to-br from-[#1C2026] via-[#14171C] to-[#0D0F12] flex flex-col items-center justify-center p-3 relative overflow-hidden select-none">
        <div className="absolute inset-0 opacity-15 bg-[linear-gradient(to_right,#EA580C15_1px,transparent_1px),linear-gradient(to_bottom,#EA580C15_1px,transparent_1px)] bg-[size:12px_12px]" />
        <div className="w-16 h-16 rounded-lg border border-[#EA580C]/30 flex items-center justify-center relative bg-[#EA580C]/5">
          <Package className="w-8 h-8 text-[#EA580C]" />
        </div>
        <span className="text-[10px] font-mono uppercase tracking-wider text-[#E8EAEE] mt-2 font-semibold z-10">
          {mod.name.slice(0, 12)}
        </span>
      </div>
    );
  };

  return (
    <div
      className={`w-[135px] h-[135px] shrink-0 relative bg-[#0D0F12] rounded-md overflow-hidden self-center border border-[#23272E] group-hover:border-[#EA580C]/50 transition-colors shadow-sm ${className}`}
    >
      {/* Tactical Loading Skeleton Shimmer */}
      {!isLoaded && !hasAllFailed && (
        <div className="absolute inset-0 z-0 bg-[#16191F] flex flex-col items-center justify-center overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#2D333F]/40 to-transparent animate-shimmer" />
          <div className="w-10 h-10 rounded border border-[#2A2F38] border-dashed flex items-center justify-center text-[#4B5563] animate-pulse">
            <span className="text-xs font-mono font-bold">{mod.name.charAt(0).toUpperCase()}</span>
          </div>
          <span className="text-[9px] font-mono text-[#6B7280] mt-1.5 animate-pulse">Loading...</span>
        </div>
      )}

      {/* Primary Image from SPT Forge via Hotlink Proxy */}
      {currentImageUrl && (
        <img
          src={currentImageUrl}
          alt={mod.name}
          loading="lazy"
          decoding="async"
          onError={handleImageError}
          onLoad={handleImageLoad}
          className={`w-full h-full object-cover transition-all duration-300 group-hover:scale-105 ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {/* Fallback Artwork when image is missing or unavailable */}
      {hasAllFailed && renderCategoryArtwork()}
    </div>
  );
};
