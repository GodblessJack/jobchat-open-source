/**
 * agentSessionStore — per-agent SDK worker status.
 *
 * Subscribed to topic `agent-status`; snapshot data shape:
 *   { byAgentId: Record<Uuid, { status: SdkSessionStatus; lastActiveAt?: string }> }
 */

import { create } from 'zustand';
import type { Uuid, SdkSessionStatus, AgentStatusSnapshot } from '@shared/domain';

export interface AgentSessionState {
  byAgentId: Record<Uuid, { status: SdkSessionStatus; lastActiveAt?: string }>;
  applySnapshot: (snap: AgentStatusSnapshot) => void;
  setStatus: (agentId: Uuid, status: SdkSessionStatus) => void;
  clear: () => void;
}

export const useAgentSessionStore = create<AgentSessionState>((set) => ({
  byAgentId: {},
  applySnapshot: snap => set({ byAgentId: { ...snap.byAgentId } }),
  setStatus: (agentId, status) =>
    set(state => ({
      byAgentId: { ...state.byAgentId, [agentId]: { ...state.byAgentId[agentId], status } }
    })),
  clear: () => set({ byAgentId: {} })
}));
