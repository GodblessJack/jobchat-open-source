/**
 * presenceStore — multi-tab / multi-device presence broadcast from server.
 */

import { create } from 'zustand';

export interface PresenceState {
  devices: number;
  otherTabs: string[];
  set: (devices: number, otherTabs: string[]) => void;
  clear: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  devices: 1,
  otherTabs: [],
  set: (devices, otherTabs) => set({ devices, otherTabs }),
  clear: () => set({ devices: 1, otherTabs: [] })
}));
