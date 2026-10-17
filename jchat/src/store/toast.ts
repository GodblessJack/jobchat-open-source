/**
 * Toast store — lightweight notification queue.
 *
 * Toasts auto-dismiss after a per-toast duration (default 3.5s).
 * Components import `useToastStore` and call `addToast({...})`.
 */

import { create } from 'zustand';

export interface Toast {
  id: string;
  message: string;
  /** Visual variant. */
  variant: 'success' | 'error' | 'info';
  /** Auto-dismiss timeout in ms. Default 3500. */
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (t: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast(t) {
    const MAX_VISIBLE_TOASTS = 5;
    const id = crypto.randomUUID();
    const toast: Toast = { ...t, id };
    set(state => ({ toasts: [...state.toasts, toast].slice(-MAX_VISIBLE_TOASTS) }));

    const duration = t.duration ?? 3500;
    if (duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, duration);
    }
  },

  removeToast(id) {
    set(state => ({
      toasts: state.toasts.filter(t => t.id !== id)
    }));
  }
}));
