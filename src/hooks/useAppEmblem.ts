import { useState, useEffect, useCallback } from 'react';
import defaultEmblem from '../assets/emblem.png';

export const FALLBACK_EMBLEM_SVG =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none"><path d="M50 8 L85 22 V50 C85 72 50 92 50 92 C50 92 15 72 15 50 V22 Z" fill="%231E222A" stroke="%23EA580C" stroke-width="4"/><path d="M50 20 L74 30 V50 C74 65 50 78 50 78 C50 78 26 65 26 50 V30 Z" fill="%2316181E" stroke="%23EA580C" stroke-width="2" stroke-opacity="0.6"/><path d="M38 42 L50 32 L62 42 L58 56 L42 56 Z" fill="%23EA580C"/><circle cx="50" cy="46" r="4" fill="%23121418"/></svg>';

const STORAGE_KEY = 'blacksite_custom_emblem';
const UPDATE_EVENT = 'emblem-updated';

function getInitialEmblem(): string {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && (stored.startsWith('data:image/') || stored.startsWith('blob:'))) {
        return stored;
      }
    } catch {
      // Ignore localStorage read errors
    }
  }
  return defaultEmblem || FALLBACK_EMBLEM_SVG;
}

export function useAppEmblem() {
  const [emblemSrc, setEmblemSrc] = useState<string>(getInitialEmblem);

  const [hasCustomEmblem, setHasCustomEmblem] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        return !!localStorage.getItem(STORAGE_KEY);
      } catch {
        return false;
      }
    }
    return false;
  });

  useEffect(() => {
    const handleUpdate = () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && stored.startsWith('data:image/')) {
          setEmblemSrc(stored);
          setHasCustomEmblem(true);
        } else {
          setEmblemSrc(defaultEmblem);
          setHasCustomEmblem(false);
        }
      } catch {
        setEmblemSrc(defaultEmblem);
        setHasCustomEmblem(false);
      }
    };

    window.addEventListener(UPDATE_EVENT, handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener(UPDATE_EVENT, handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  const setCustomEmblem = useCallback((dataUrl: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, dataUrl);
      setEmblemSrc(dataUrl);
      setHasCustomEmblem(true);
      window.dispatchEvent(new CustomEvent(UPDATE_EVENT));

      // If running inside desktop Electron, notify bridge
      const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
      if (bridge?.setCustomEmblem) {
        bridge.setCustomEmblem(dataUrl);
      }
    } catch (e) {
      console.warn('Failed to save emblem to localStorage:', e);
    }
  }, []);

  const resetCustomEmblem = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      setEmblemSrc(defaultEmblem);
      setHasCustomEmblem(false);
      window.dispatchEvent(new CustomEvent(UPDATE_EVENT));

      const bridge = typeof window !== 'undefined' ? (window as any).desktopBridge : null;
      if (bridge?.resetCustomEmblem) {
        bridge.resetCustomEmblem();
      }
    } catch (e) {
      console.warn('Failed to reset emblem:', e);
    }
  }, []);

  return {
    emblemSrc,
    hasCustomEmblem,
    setCustomEmblem,
    resetCustomEmblem,
    defaultEmblem,
    fallbackEmblem: FALLBACK_EMBLEM_SVG,
  };
}
