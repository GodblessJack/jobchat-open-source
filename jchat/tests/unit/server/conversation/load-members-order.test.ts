// jchat/tests/unit/server/conversation/load-members-order.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDb, mockSelect } from '../../../mock-db.js';

vi.mock('../../../../server/lib/db.js', () => ({ db: mockDb }));

import { getConversationMembers } from '../../../../server/conversation/conversation-repo.js';

const MEMBER_ROWS = [
  { conversationId: 'conv-1', agentId: 'agent-x', role: 'member' as const, joinedAt: new Date('2026-05-17T00:00:00Z'), position: 0 },
  { conversationId: 'conv-1', agentId: 'agent-y', role: 'member' as const, joinedAt: new Date('2026-05-17T00:00:00Z'), position: 1 },
  { conversationId: 'conv-1', agentId: 'agent-z', role: 'member' as const, joinedAt: new Date('2026-05-17T00:00:00Z'), position: 2 }
];

describe('loadMembers ordering (position ASC)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select = mockSelect(MEMBER_ROWS);
  });

  it('preserves the DB-returned row order in the mapped output', async () => {
    const members = await getConversationMembers('conv-1');
    expect(members).toHaveLength(3);
    expect(members.map(m => m.agentId)).toEqual(['agent-x', 'agent-y', 'agent-z']);
    expect(members.map(m => m.position)).toEqual([0, 1, 2]);
  });

  it('returns empty array when no members', async () => {
    mockDb.select = mockSelect([]);
    const members = await getConversationMembers('conv-empty');
    expect(members).toEqual([]);
  });
});
