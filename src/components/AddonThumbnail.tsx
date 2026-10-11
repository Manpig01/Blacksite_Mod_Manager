import React, { useState, useEffect, useMemo } from 'react';
import { Addon } from '../types';
import { Puzzle, Layers, Sparkles, Box } from 'lucide-react';
import { imageCacheService } from '../services/imageCacheService';
import { getProxiedForgeImageUrl } from './ModThumbnail';

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
  // Build prioritized candidate URLs list:
  // 1. Addon primary thumbnail
  // 2. Parent mod thumbnail
  // 3. Author avatar
  const candidateImages = useMemo(() => {
    const urls: string[] = [];
    const isDesktop = typeof window !== 'undefined' && Boolean((window as any).desktopBridge?.isElectron);

    const addCandidate = (rawUrl?: string | null) => {
      if (!rawUrl) return;
      const trimmed = rawUrl.trim();
      if (!trimmed) return;

      if (isDesktop) {
        // Direct URLs supported natively with Electron Referer header injection
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

    // Candidate 1: Addon direct thumbnail
    if (addon.thumbnail) {
      addCandidate(addon.thumbnail);
    }

    // Candidate 2: Parent mod thumbnail
    if (addon.mod?.thumbnail) {
      addCandidate(addon.mod.thumbnail);
    }

    // Candidate 3: Author avatar
    if (addon.authors && addon.authors.length > 0 && addon.authors[0].avatar) {
      addCandidate(addon.authors[0].avatar);
    }

    return urls;
  }, [addon.thumbnail, addon.mod?.thumbnail, addon.authors]);

  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [cachedUrl, setCachedUrl] = useState<string | null>(() => {
    for (const url of candidateImages) {
      const mem = imageCacheService.getMemoryUrl(url);
      if (mem) return mem;
    }
    return null;
  });
  const [isLoaded, setIsLoaded] = useState<boolean>(Boolean(cachedUrl));
  const [hasAllFailed, setHasAllFailed] = useState<boolean>(candidateImages.length === 0);

  useEffect(() => {
    setCurrentIndex(0);
    setDataUrl(null);
    setHasAllFailed(candidateImages.length === 0);

    let isMounted = true;
    const checkCache = async () => {
      for (const url of candidateImages) {
        const cached = await imageCacheService.getCachedImageUrl(url);
        if (cached && isMounted) {
          setCachedUrl(cached);
          setIsLoaded(true);
          return;
        }
      }
      if (isMounted) {
        setCachedUrl(null);
        setIsLoaded(false);
      }
    };
    checkCache();

    return () => {
      isMounted = false;
    };
  }, [candidateImages]);

  const handleImageError = async () => {
    // If running in desktop app, try IPC data URL fetch before falling back
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
        console.error('IPC image fetch failed for addon thumbnail:', e);
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
    // Background persistent caching to IndexedDB
    const activeUrl = candidateImages[currentIndex];
    if (activeUrl && !cachedUrl && !activeUrl.startsWith('data:')) {
      imageCacheService.fetchAndCache(activeUrl).catch(() => {});
    }
  };

  const currentImageUrl = !hasAllFailed
    ? (cachedUrl || dataUrl || candidateImages[currentIndex])
    : null;

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
