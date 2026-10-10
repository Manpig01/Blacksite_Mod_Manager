import { useState, useEffect, useCallback } from 'react';
import defaultEmblem from '../assets/emblem.png';

const STORAGE_KEY = 'blacksite_custom_emblem';
const UPDATE_EVENT = 'emblem-updated';

export function useAppEmblem() {
  const [emblemSrc, setEmblemSrc] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && stored.startsWith('data:image/')) {
          return stored;
        }
      } catch {
        // Ignore localStorage read errors
      }
    }
    return defaultEmblem;
  });

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
  };
}
