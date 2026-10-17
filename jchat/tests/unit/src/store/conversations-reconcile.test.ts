// jchat/tests/unit/src/store/conversations-reconcile.test.ts
//
// useConversationsStore.reconcile must drop locally-cached conversations that
// no longer appear in the server snapshot — the bug Codex flagged was that
// deleted conversations lingered in byId after the server stopped sending
// them. Drafts (created locally, not yet acknowledged) MUST be preserved.

import { describe, it, expect, beforeEach } from 'vitest';
import { useConversationsStore } from '../../../../src/store/conversations';
import type { ConversationSummary } from '../../../../shared/domain';

function fakeConv(id: string): ConversationSummary {
  return {
    id,
    userId: 'u1',
    type: 'dm',
    title: null,
    archivedAt: null,
    deletedAt: null,
    createdAt: '2026-05-17T00:00:00Z',
    updatedAt: '2026-05-17T00:00:00Z',
    members: []
  } as ConversationSummary;
}

describe('useConversationsStore.reconcile', () => {
  beforeEach(() => useConversationsStore.getState().clear());

  it('drops entries not in the server snapshot id list', () => {
    const a = fakeConv('a');
    const b = fakeConv('b');
    const c = fakeConv('c');
    useConversationsStore.getState().upsert(a);
    useConversationsStore.getState().upsert(b);
    useConversationsStore.getState().upsert(c);

    useConversationsStore.getState().reconcile(['a', 'c']); // b deleted server-side

    const byId = useConversationsStore.getState().byId;
    expect(Object.keys(byId).sort()).toEqual(['a', 'c']);
  });

  it('preserves drafts even when not in the snapshot', () => {
    const a = fakeConv('a');
    const draft = fakeConv('draft-1');
    useConversationsStore.getState().upsert(a);
    useConversationsStore.getState().upsert(draft);
    useConversationsStore.getState().markDraft('draft-1');

    // Server snapshot doesn't include the draft yet (still pending ack).
    useConversationsStore.getState().reconcile(['a']);

    const byId = useConversationsStore.getState().byId;
    expect(Object.keys(byId).sort()).toEqual(['a', 'draft-1']);
  });

  it('clears activeId when the active conversation is reconciled out', () => {
    const a = fakeConv('a');
    const b = fakeConv('b');
    useConversationsStore.getState().upsert(a);
    useConversationsStore.getState().upsert(b);
    useConversationsStore.getState().open('b');

    useConversationsStore.getState().reconcile(['a']); // b is gone

    expect(useConversationsStore.getState().activeId).toBeNull();
  });

  it('keeps activeId when the active conversation survives the reconcile', () => {
    const a = fakeConv('a');
    useConversationsStore.getState().upsert(a);
    useConversationsStore.getState().open('a');

    useConversationsStore.getState().reconcile(['a']);

    expect(useConversationsStore.getState().activeId).toBe('a');
  });
});
