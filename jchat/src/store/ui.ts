/**
 * uiStore — chrome state (sidebars, panel, theme, mobile drill-down).
 */

import { create } from 'zustand';
import type { Uuid } from '@shared/domain';

export type Theme = 'light' | 'dark';
export type MobilePane = 'list' | 'conversation';

export interface ActiveCall {
  sessionId: Uuid;
  conversationId: Uuid;
  agentId: Uuid;
}

export interface UiState {
  sidebarCollapsed: boolean;
  detailPanelVisible: boolean;
  detailPanelActiveTab: 'profile' | 'skills' | 'call';
  detailPanelWidth: number;
  theme: Theme;
  mobilePane: MobilePane;
  activeCall: ActiveCall | null;
  pendingConversationSwitch: { conversationId: string } | null;
  /** Incremented each time Ctrl+K / Cmd+K is pressed, so ContactList can focus its search input. */
  focusSearchTrigger: number;

  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  toggleDetailPanel: () => void;
  setDetailPanelVisible: (v: boolean) => void;
  setDetailPanelActiveTab: (tab: 'profile' | 'skills' | 'call') => void;
  setDetailPanelWidth: (width: number) => void;
  setTheme: (t: Theme) => void;
  setMobilePane: (p: MobilePane) => void;
  setActiveCall: (call: ActiveCall | null) => void;
  setPendingConversationSwitch: (sw: { conversationId: string } | null) => void;
  triggerFocusSearch: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  detailPanelVisible: false,
  detailPanelActiveTab: 'profile',
  detailPanelWidth: 320,
  theme: 'light',
  mobilePane: 'list',
  activeCall: null,
  pendingConversationSwitch: null,
  focusSearchTrigger: 0,

  toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: v => set({ sidebarCollapsed: v }),
  toggleDetailPanel: () => set(s => ({ detailPanelVisible: !s.detailPanelVisible })),
  setDetailPanelVisible: v => set({ detailPanelVisible: v }),
  setDetailPanelActiveTab: tab => set({ detailPanelActiveTab: tab }),
  setDetailPanelWidth: width => set({ detailPanelWidth: width }),
  setTheme: t => set({ theme: t }),
  setMobilePane: p => set({ mobilePane: p }),
  setActiveCall: call => set({ activeCall: call }),
  setPendingConversationSwitch: sw => set({ pendingConversationSwitch: sw }),
  triggerFocusSearch: () => set(s => ({ focusSearchTrigger: s.focusSearchTrigger + 1 })),
}));
