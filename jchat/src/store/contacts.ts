/**
 * contactsStore — derives the left-rail data from the `contacts` snapshot topic.
 *
 * Snapshot data shape (from server, see shared/domain.ts ContactsSnapshot):
 *   { agents: AgentSummary[], conversations: ConversationSummary[] }
 */

import { create } from 'zustand';
import type {
  AgentSummary,
  ConversationSummary,
  ContactsSnapshot,
  Uuid
} from '@shared/domain';

export interface ContactsState {
  agents: Record<Uuid, AgentSummary>;
  agentIds: Uuid[];                 // stable order — by AgentSummary.name
  conversations: Record<Uuid, ConversationSummary>;
  conversationIds: Uuid[];          // sidebar order — by updatedAt desc
  search: string;
  hydrated: boolean;

  applySnapshot: (snap: ContactsSnapshot) => void;
  setSearch: (q: string) => void;
  clear: () => void;

  selectFilteredAgents: () => AgentSummary[];
  selectSidebarConversations: () => ConversationSummary[];
}

function indexById<T extends { id: Uuid }>(rows: T[]): Record<Uuid, T> {
  const out: Record<Uuid, T> = {};
  for (const r of rows) out[r.id] = r;
  return out;
}

export const useContactsStore = create<ContactsState>((set, get) => ({
  agents: {},
  agentIds: [],
  conversations: {},
  conversationIds: [],
  search: '',
  hydrated: false,

  applySnapshot(snap) {
    const agents = indexById(snap.agents);
    const agentIds = [...snap.agents]
      .filter(a => a?.name != null && a?.id != null)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(a => a.id);
    const conversations = indexById(snap.conversations);
    const conversationIds = [...snap.conversations]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map(c => c.id);
    set({ agents, agentIds, conversations, conversationIds, hydrated: true });
  },

  setSearch(q) {
    set({ search: q });
  },

  clear() {
    set({ agents: {}, agentIds: [], conversations: {}, conversationIds: [], search: '', hydrated: false });
  },

  selectFilteredAgents() {
    const { agents, agentIds, search } = get();
    if (!search.trim()) return agentIds.map(id => agents[id]);
    const q = search.trim().toLowerCase();
    return agentIds
      .map(id => agents[id])
      .filter(a =>
        a.name.toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q)
      );
  },

  selectSidebarConversations() {
    const { conversations, conversationIds } = get();
    return conversationIds.map(id => conversations[id]).filter(Boolean);
  }
}));
