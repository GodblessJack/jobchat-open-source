import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mockDb, mockSelect, mockInsert, mockUpdate, mockExecute } from '../../mock-db.js';

vi.mock('../../../server/auth/jwt-verify.js', () => ({ verifyJchatJwt: vi.fn() }));
vi.mock('../../../server/lib/db.js', () => ({ db: mockDb }));
vi.mock('../../../server/conversation/group-dispatch.js', () => ({
  extractMemoryAsync: vi.fn().mockResolvedValue(undefined)
}));

import { verifyJchatJwt } from '../../../server/auth/jwt-verify.js';
import { extractMemoryAsync } from '../../../server/conversation/group-dispatch.js';
import { mountCallRoutes } from '../../../server/call/call-routes.js';

function makeApp() {
  const a = express();
  a.use(express.json());
  mountCallRoutes(a, { broadcastConvSnapshot: vi.fn().mockResolvedValue(undefined) });
  return a;
}

const SESS_ROW = {
  id: 's1', userId: 'u1', agentId: 'a1', conversationId: 'c1',
  status: 'ongoing', startedAt: new Date('2026-04-30T00:00:00Z'), endedAt: null,
};

describe('POST /api/call/end → distill to agent_memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select = mockSelect([]);
    mockDb.insert = mockInsert([]);
    mockDb.update = mockUpdate();
    mockDb.execute = mockExecute({ rows: [] });
  });

  it('schedules extractMemoryAsync with concatenated transcripts after successful end', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'u1' });

    // getSession returns the session (select #1)
    // endSession also does a select for conversationId (select #2)
    let selCalls = 0;
    mockDb.select = vi.fn(() => {
      selCalls++;
      if (selCalls === 1) return mockSelect([SESS_ROW])();
      return mockSelect([{ cid: 'c1' }])();
    });
    // endSession: update (default mockUpdate is fine — resolves to undefined)
    mockDb.update = mockUpdate();
    // persistCallToMemory: db.execute for transcripts
    mockDb.execute = mockExecute({
      rows: [
        { id: 'm1', sender_type: 'user', content: '你好', created_at: '2026-04-30T00:00:01Z' },
        { id: 'm2', sender_type: 'agent', content: '你好啊', created_at: '2026-04-30T00:00:02Z' },
      ]
    });

    const r = await request(makeApp())
      .post('/api/call/end')
      .set('Authorization', 'Bearer t')
      .send({ sessionId: 's1', status: 'completed' });
    expect(r.status).toBe(204);

    // setImmediate runs after the response — wait one tick.
    await new Promise((res) => setImmediate(res));

    expect(extractMemoryAsync).toHaveBeenCalledTimes(1);
    const args = (extractMemoryAsync as any).mock.calls[0][0];
    expect(args.userId).toBe('u1');
    expect(args.agentId).toBe('a1');
    expect(args.conversationId).toBe('c1');
    expect(args.agentMessageId).toBe('m2');
    expect(args.text).toContain('用户: 你好');
    expect(args.text).toContain('Agent: 你好啊');
    expect(args.importance).toBe(0.6);
  });

  it('does not call extractMemoryAsync when no transcripts exist', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'u1' });

    // getSession returns the session
    mockDb.select = mockSelect([SESS_ROW]);
    // endSession: update
    mockDb.update = mockUpdate();
    // persistCallToMemory: db.execute returns empty
    mockDb.execute = mockExecute({ rows: [] });

    const r = await request(makeApp())
      .post('/api/call/end')
      .set('Authorization', 'Bearer t')
      .send({ sessionId: 's1', status: 'completed' });
    expect(r.status).toBe(204);
    await new Promise((res) => setImmediate(res));
    expect(extractMemoryAsync).not.toHaveBeenCalled();
  });
});
