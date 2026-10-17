/**
 * useGlobalShortcuts — window-level keyboard shortcuts.
 *
 * Mount once in AppShell. Skips firing when focus is inside an input,
 * textarea, select, or contenteditable (except for Escape which always
 * fires so users can dismiss panels even while typing).
 *
 * Shortcuts:
 *   Escape       → close detail panel / dismiss overlays
 *   Ctrl/Cmd + K → focus conversation search
 *   Ctrl/Cmd + N → new conversation (/chat/new)
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUiStore } from '../store/ui';

export function useGlobalShortcuts() {
  const navigate = useNavigate();
  const setDetailPanelVisible = useUiStore(s => s.setDetailPanelVisible);
  const triggerFocusSearch = useUiStore(s => s.triggerFocusSearch);

  useEffect(() => {
    function isEditing(): boolean {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if ((el as HTMLElement).isContentEditable) return true;
      return false;
    }

    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      // Escape always fires — dismiss panels even when typing.
      if (e.key === 'Escape') {
        // Don't close Radix dialogs (they handle Escape internally).
        // Only close our detail panel. This is best-effort: if a Radix dialog
        // is open, the dialog's own Escape handler fires first and stops propagation,
        // so this handler won't see the event.
        if (!e.defaultPrevented) {
          setDetailPanelVisible(false);
        }
        return;
      }

      // Remaining shortcuts only fire when the user is NOT editing text.
      if (isEditing()) return;

      if (mod && e.key === 'k') {
        e.preventDefault();
        triggerFocusSearch();
        return;
      }

      if (mod && e.key === 'n') {
        e.preventDefault();
        navigate('/chat/new');
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, setDetailPanelVisible, triggerFocusSearch]);
}
