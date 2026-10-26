import { useEffect } from 'react';

export type ActiveTabKey =
  | 'browse'
  | 'addons'
  | 'installed'
  | 'profiles'
  | 'conflicts'
  | 'settings';

const TAB_HOTKEY_MAP: Record<string, ActiveTabKey> = {
  '1': 'browse',
  '2': 'addons',
  '3': 'installed',
  '4': 'profiles',
  '5': 'conflicts',
  '6': 'settings',
};

interface UseKeyboardShortcutsOptions {
  onSelectTab: (tab: ActiveTabKey) => void;
  onDismissModal?: () => boolean;
}

/**
 * Global power-user keyboard shortcuts for Blacksite Mod Manager:
 * - Ctrl/Cmd + K or '/' (outside inputs): Focus active view's search input ([data-global-search="true"])
 * - Alt + 1..6: Switch directly between primary workspace tabs
 * - Escape: Dismiss active modal/drawer or blur focused input
 */
export function useKeyboardShortcuts({
  onSelectTab,
  onDismissModal,
}: UseKeyboardShortcutsOptions): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName?.toUpperCase() || '';
      const isEditable =
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        tagName === 'SELECT' ||
        Boolean(target?.isContentEditable);

      // 1. Escape: dismiss open modal first, or blur active input
      if (e.key === 'Escape') {
        if (onDismissModal && onDismissModal()) {
          e.preventDefault();
          return;
        }
        if (isEditable && target) {
          target.blur();
          return;
        }
      }

      // 2. Ctrl/Cmd + K or '/' (outside editable inputs): focus active search input
      const isCtrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
      const isSlash = !isEditable && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === '/';

      if (isCtrlK || isSlash) {
        const searchInput = document.querySelector<HTMLInputElement>(
          'input[data-global-search="true"]'
        );
        if (searchInput) {
          e.preventDefault();
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // 3. Alt + 1..6: switch workspace tabs
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const targetTab = TAB_HOTKEY_MAP[e.key];
        if (targetTab) {
          e.preventDefault();
          onSelectTab(targetTab);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSelectTab, onDismissModal]);
}
