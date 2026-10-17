// jchat/tests/integration/call-flow.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mockDb, mockSelect, mockInsert, mockUpdate, mockExecute, mockChain } from '../mock-db.js';

vi.mock('../../server/auth/jwt-verify.js', () => ({ verifyJchatJwt: vi.fn() }));
vi.mock('../../server/lib/db.js', () => ({ db: mockDb }));

import { verifyJchatJwt } from '../../server/auth/jwt-verify.js';
import { mountCallRoutes } from '../../server/call/call-routes.js';

function makeApp() {
  const a = express();
  a.use(express.json());
  mountCallRoutes(a, { broadcastConvSnapshot: vi.fn().mockResolvedValue(undefined) });
  return a;
}

type SessionRow = {
  id: string; userId: string; agentId: string; conversationId: string;
  status: string; startedAt: Date; endedAt: Date | null;
};

// Helper to make session rows with proper Date fields (required by getSession → .toISOString())
function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 's1', userId: 'u1', agentId: 'a1', conversationId: 'c1',
    status: 'ongoing', startedAt: new Date('2026-04-29T00:00:00Z'), endedAt: null,
    ...overrides,
  };
}

describe('call flow integration (mocked supabase)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select = mockSelect([]);
    mockDb.insert = mockInsert([{ id: 'mock-id' }]);
    mockDb.update = mockUpdate();
    mockDb.execute = mockExecute({ rows: [] });
  });

  it('start → transcribe(insert) → transcribe(update same id) → end', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'u1' });

    let selectCall = 0;
    mockDb.select = vi.fn(() => {
      selectCall++;
      // Call 1: resolveDmOwner — select conversations (start)
      if (selectCall === 1) return mockSelect([{ id: 'c1', userId: 'u1', type: 'dm' }])();
      // Call 2: resolveDmOwner — select members (start)
      if (selectCall === 2) return mockSelect([{ agentId: 'a1' }])();
      // Call 3: getSession — select meeting_sessions (transcribe/end)
      if (selectCall === 3) return mockSelect([sessionRow()])();
      // Call 4: endSession SELECT for conversationId (aliased as cid)
      if (selectCall === 4) return mockSelect([{ cid: 'c1' }])();
      // Call 5+: subsequent calls
      return mockSelect([sessionRow()])();
    });

    // Insert: createSession + message insert
    const insertReturnId = 's1';
    mockDb.insert = vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => mockChain([{ id: insertReturnId }])),
      })),
      onConflictDoUpdate: vi.fn(() => ({ set: vi.fn(() => mockChain(undefined)) })),
    }));

    // Update: endSession + message update
    mockDb.update = mockUpdate();

    // Execute: transcript lookup (returns empty by default = no existing)
    mockDb.execute = vi.fn(() => mockChain({ rows: [] }));

    const app = makeApp();

    // ── 1. start ──
    const start = await request(app)
      .post('/api/call/start')
      .set('Authorization', 'Bearer t')
      .send({ conversationId: 'c1' });
    expect(start.status).toBe(200);
    const sessionId = start.body.sessionId;
    expect(sessionId).toBe('s1');

    // ── 2. first transcribe → insert ──
    mockDb.execute = vi.fn()
      .mockImplementationOnce(() => mockChain({ rows: [] })) // no existing transcript
      .mockImplementationOnce(() => mockChain({ rows: [{ id: 'm-1' }] })); // atomic upsert

    const t1 = await request(app)
      .post('/api/call/transcribe')
      .set('Authorization', 'Bearer t')
      .send({ sessionId, transcriptEntryId: 'e1', sender: 'user', text: 'hi', timestamp: 1 });
    expect(t1.status).toBe(200);
    expect(t1.body.action).toBe('insert');
    expect(t1.body.messageId).toBe('m-1');

    // ── 3. second transcribe with same id → update ──
    mockDb.select = mockSelect([sessionRow()]);
    mockDb.execute = vi.fn()
      .mockImplementationOnce(() => mockChain({ rows: [{ id: 'm-1' }] })) // existing transcript
      .mockImplementationOnce(() => mockChain({ rows: [{ id: 'm-1' }] })); // atomic upsert

    const t2 = await request(app)
      .post('/api/call/transcribe')
      .set('Authorization', 'Bearer t')
      .send({ sessionId, transcriptEntryId: 'e1', sender: 'user', text: 'hi there', timestamp: 1 });
    expect(t2.status).toBe(200);
    expect(t2.body.action).toBe('update');
    expect(t2.body.messageId).toBe('m-1');

    // ── 4. end ──
    mockDb.select = vi.fn()
      .mockImplementationOnce(() => mockChain([sessionRow()])) // getSession
      .mockImplementationOnce(() => mockChain([{ cid: 'c1' }])); // endSession conversation lookup
    mockDb.update = mockUpdate();
    mockDb.execute = mockExecute({ rows: [] }); // persistCallToMemory looks for transcripts

    const end = await request(app)
      .post('/api/call/end')
      .set('Authorization', 'Bearer t')
      .send({ sessionId, status: 'completed' });
    expect(end.status).toBe(204);
  });
});
