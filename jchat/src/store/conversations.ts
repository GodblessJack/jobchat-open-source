/**
 * conversationsStore — currently-opened conversation snapshot bookkeeping.
 */

import { create } from 'zustand';
import type { ConversationSummary, Uuid } from '@shared/domain';

export interface ConversationsState {
  byId: Record<Uuid, ConversationSummary>;
  draftIds: Set<Uuid>;             // conversations created locally but not yet acked by server
  activeId: Uuid | null;

  open: (id: Uuid | null) => void;
  upsert: (conv: ConversationSummary) => void;
  remove: (id: Uuid) => void;
  markDraft: (id: Uuid) => void;
  unmarkDraft: (id: Uuid) => void;
  /**
   * Reconcile against a server snapshot: keep entries whose IDs are in the
   * snapshot (or marked as drafts), drop everything else. Used by the
   * contacts-snapshot handler so deletes propagate to local state.
   */
  reconcile: (serverIds: Uuid[]) => void;
  clear: () => void;
}

export const useConversationsStore = create<ConversationsState>((set) => ({
  byId: {},
  draftIds: new Set<Uuid>(),
  activeId: null,

  open(id) {
    set({ activeId: id });
  },

  upsert(conv) {
    set(state => ({ byId: { ...state.byId, [conv.id]: conv } }));
  },

  remove(id) {
    set(state => {
      const { [id]: _, ...rest } = state.byId;
      const drafts = new Set(state.draftIds);
      drafts.delete(id);
      return { byId: rest, draftIds: drafts, activeId: state.activeId === id ? null : state.activeId };
    });
  },

  markDraft(id) {
    set(state => {
      const drafts = new Set(state.draftIds);
      drafts.add(id);
      return { draftIds: drafts };
    });
  },

  unmarkDraft(id) {
    set(state => {
      const drafts = new Set(state.draftIds);
      drafts.delete(id);
      return { draftIds: drafts };
    });
  },

  reconcile(serverIds) {
    set(state => {
      const keep = new Set<Uuid>([...serverIds, ...state.draftIds]);
      const next: Record<Uuid, ConversationSummary> = {};
      for (const id of keep) {
        if (state.byId[id]) next[id] = state.byId[id];
      }
      const activeId = state.activeId && next[state.activeId] ? state.activeId : null;
      return { byId: next, activeId };
    });
  },

  clear() {
    set({ byId: {}, draftIds: new Set<Uuid>(), activeId: null });
  }
}));
