import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mockDb, mockSelect, mockInsert } from '../../mock-db.js';
import { JchatError } from '@shared/errors.js';

vi.mock('../../../server/auth/jwt-verify.js', () => ({
  verifyJchatJwt: vi.fn()
}));
vi.mock('../../../server/lib/db.js', () => ({
  db: mockDb
}));

import { verifyJchatJwt } from '../../../server/auth/jwt-verify.js';
import { mountCallRoutes } from '../../../server/call/call-routes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  mountCallRoutes(app, { broadcastConvSnapshot: vi.fn().mockResolvedValue(undefined) });
  return app;
}

function mockConvLookup(opts: { type: 'dm' | 'group'; ownerId: string; agentId: string | null }) {
  // resolveDmOwner does:
  // 1. db.select().from(jchatConversations).where(eq(...)).limit(1) → conv rows
  // 2. db.select().from(jchatConversationMembers).where(...).limit(1) → member rows
  // createSession does: db.insert(jchatMeetingSessions).values(...).returning(...)
  // We use mockChain so each .select() call returns the right thing.

  let selectCallCount = 0;
  mockDb.select = vi.fn(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      // First select: conversation lookup
      return mockDb;
    }
    // Second select: member lookup
    return mockDb;
  });

  // Instead of tracking calls, just set up the final resolution values.
  // The mockChain approach means ALL .select().from().where().limit() chains
  // resolve to the LAST set value. So we need to handle this differently.
  // Let's just use simple overrides.

  // For call-start, the order of DB calls is:
  // 1. resolveDmOwner: select conversations → returns conv row
  // 2. resolveDmOwner: select members → returns member row
  // 3. createSession: insert sessions → returns { id: 'sess-new' }

  // Since mockChain always returns the same value from all chain calls,
  // we'll set up the insert to return the session ID and the select to return
  // what the conv lookup needs. The member lookup returns the same select value.
  // This works because resolveDmOwner checks convRows[0].userId and type first,
  // then memberRows[0].agentId.

  const convRow = {
    id: 'c1', userId: opts.ownerId, type: opts.type,
  };

  // resolveDmOwner needs conv row first, then member row
  mockDb.select = mockSelect([convRow]);

  // Override select to return different things on different calls
  let callIdx = 0;
  mockDb.select = vi.fn(() => {
    callIdx++;
    if (callIdx === 1) {
      return mockSelect([convRow])();
    }
    // Second call: member lookup
    if (opts.agentId) {
      return mockSelect([{ agentId: opts.agentId }])();
    }
    return mockSelect([])();
  });

  // createSession: insert
  mockDb.insert = mockInsert([{ id: 'sess-new' }]);
}

describe('POST /api/call/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select = mockSelect([]);
    mockDb.insert = mockInsert([{ id: 'mock-id' }]);
  });

  it('401 without Authorization', async () => {
    (verifyJchatJwt as any).mockRejectedValue(new JchatError('AUTH_INVALID', 'no token'));
    const r = await request(makeApp()).post('/api/call/start').send({ conversationId: 'c1' });
    expect(r.status).toBe(401);
  });

  it('403 when conversation type is group', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'u1' });
    mockConvLookup({ type: 'group', ownerId: 'u1', agentId: 'a1' });
    const r = await request(makeApp())
      .post('/api/call/start')
      .set('Authorization', 'Bearer t')
      .send({ conversationId: 'c1' });
    expect(r.status).toBe(403);
  });

  it('403 when caller is not conversation owner', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'u-other' });
    mockConvLookup({ type: 'dm', ownerId: 'u1', agentId: 'a1' });
    const r = await request(makeApp())
      .post('/api/call/start')
      .set('Authorization', 'Bearer t')
      .send({ conversationId: 'c1' });
    expect(r.status).toBe(403);
  });

  it('200 returns sessionId for valid DM owner', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'u1' });
    mockConvLookup({ type: 'dm', ownerId: 'u1', agentId: 'a1' });
    const r = await request(makeApp())
      .post('/api/call/start')
      .set('Authorization', 'Bearer t')
      .send({ conversationId: 'c1' });
    expect(r.status).toBe(200);
    expect(r.body.sessionId).toBe('sess-new');
  });
});
