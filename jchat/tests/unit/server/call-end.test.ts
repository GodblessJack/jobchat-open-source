// jchat/tests/unit/server/call-end.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mockDb, mockSelect, mockUpdate } from '../../mock-db.js';

vi.mock('../../../server/auth/jwt-verify.js', () => ({ verifyJchatJwt: vi.fn() }));
vi.mock('../../../server/lib/db.js', () => ({ db: mockDb }));

import { verifyJchatJwt } from '../../../server/auth/jwt-verify.js';
import { mountCallRoutes } from '../../../server/call/call-routes.js';

function makeApp() {
  const a = express();
  a.use(express.json());
  mountCallRoutes(a, { broadcastConvSnapshot: vi.fn().mockResolvedValue(undefined) });
  return a;
}

const SESS_ROW = {
  id: 's1', userId: 'u1', agentId: 'a1', conversationId: 'c1',
  status: 'ongoing', startedAt: new Date('2026-04-29T00:00:00Z'), endedAt: null,
};

describe('POST /api/call/end', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select = mockSelect([]);
    mockDb.insert = vi.fn(() => mockDb);
    mockDb.update = mockUpdate();
  });

  function mockSessionFound() {
    // getSession calls db.select (call #1)
    // endSession also does a select for conversationId (call #2)
    let selCalls = 0;
    mockDb.select = vi.fn(() => {
      selCalls++;
      if (selCalls === 1) return mockSelect([SESS_ROW])();
      return mockSelect([{ cid: 'c1' }])();
    });
    mockDb.update = mockUpdate();
  }

  it('204 with Authorization header path', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'u1' });
    mockSessionFound();
    const r = await request(makeApp())
      .post('/api/call/end')
      .set('Authorization', 'Bearer t')
      .send({ sessionId: 's1', status: 'completed' });
    expect(r.status).toBe(204);
  });

  it('204 with body.jwt path (sendBeacon)', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'u1' });
    mockSessionFound();
    const r = await request(makeApp())
      .post('/api/call/end')
      .send({ sessionId: 's1', status: 'completed', jwt: 'beacon-jwt' });
    expect(r.status).toBe(204);
  });

  it('401 when neither header nor body.jwt', async () => {
    const r = await request(makeApp())
      .post('/api/call/end')
      .send({ sessionId: 's1', status: 'completed' });
    expect(r.status).toBe(401);
  });

  it('403 when caller is not session owner', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'someone-else' });
    mockSessionFound();
    const r = await request(makeApp())
      .post('/api/call/end')
      .set('Authorization', 'Bearer t')
      .send({ sessionId: 's1', status: 'completed' });
    expect(r.status).toBe(403);
  });

  it('400 on invalid status', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'u1' });
    const r = await request(makeApp())
      .post('/api/call/end')
      .set('Authorization', 'Bearer t')
      .send({ sessionId: 's1', status: 'wrong' });
    expect(r.status).toBe(400);
  });
});
