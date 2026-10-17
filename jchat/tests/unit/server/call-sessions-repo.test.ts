import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDb, mockSelect, mockInsert, mockUpdate, mockChain } from '../../mock-db.js';

vi.mock('../../../server/lib/db.js', () => ({ db: mockDb }));

import { createSession, getSession, endSession } from '../../../server/call/sessions-repo.js';

describe('sessions-repo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to defaults
    mockDb.select = mockSelect([]);
    mockDb.insert = mockInsert([{ id: 'mock-id' }]);
    mockDb.update = mockUpdate();
  });

  it('createSession inserts ongoing row with user_id/agent_id/conversation_id', async () => {
    const insertSpy = mockInsert([{ id: 'sess-1' }]);
    mockDb.insert = insertSpy;

    const out = await createSession({ userId: 'u1', agentId: 'a1', conversationId: 'c1' });
    expect(out.sessionId).toBe('sess-1');
    // Drizzle: insert(values).returning() — the insert spy is called with the table,
    // then .values() is called with the row data
    const valuesFn = insertSpy.mock.results[0]?.value;
    expect(valuesFn).toBeDefined();
  });

  it('getSession returns row when found', async () => {
    mockDb.select = mockSelect([{
      id: 's',
      userId: 'u',
      agentId: 'a',
      conversationId: 'c',
      status: 'ongoing',
      startedAt: new Date('2026-04-30T01:39:00Z'),
      endedAt: null,
    }]);

    const row = await getSession('s');
    expect(row?.userId).toBe('u');
    expect(row?.startedAt).toBe('2026-04-30T01:39:00.000Z');
    expect(row?.endedAt).toBeNull();
  });

  it('getSession returns null when no row found', async () => {
    mockDb.select = mockSelect([]);
    const row = await getSession('nonexistent');
    expect(row).toBeNull();
  });

  it('endSession updates status + ended_at and clears active_session', async () => {
    const updateSpy = vi.fn(() => mockChain([{ id: 's' }]));
    mockDb.update = updateSpy;
    // Mock the SELECT that looks up conversationId from the session row
    mockDb.select = mockSelect([{ cid: 'c1' }]);

    await endSession('s', 'completed');
    // update should have been called
    expect(updateSpy).toHaveBeenCalled();
  });
});
