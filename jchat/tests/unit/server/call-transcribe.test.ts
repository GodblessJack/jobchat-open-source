import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mockDb, mockSelect, mockInsert, mockUpdate, mockExecute } from '../../mock-db.js';
import { JchatError } from '@shared/errors.js';

vi.mock('../../../server/auth/jwt-verify.js', () => ({ verifyJchatJwt: vi.fn() }));
vi.mock('../../../server/lib/db.js', () => ({ db: mockDb }));

import { verifyJchatJwt } from '../../../server/auth/jwt-verify.js';
import { mountCallRoutes } from '../../../server/call/call-routes.js';

const broadcastStub = vi.fn().mockResolvedValue(undefined);
function makeApp() {
  const a = express();
  a.use(express.json());
  mountCallRoutes(a, { broadcastConvSnapshot: broadcastStub });
  return a;
}

const SESSION_ROW = {
  id: 's1', userId: 'u1', agentId: 'a1', conversationId: 'c1',
  status: 'ongoing', startedAt: new Date('2026-04-29T00:00:00Z'), endedAt: null,
};

describe('POST /api/call/transcribe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    broadcastStub.mockClear();
    mockDb.select = mockSelect([]);
    mockDb.insert = mockInsert([{ id: 'mock-id' }]);
    mockDb.update = mockUpdate();
    mockDb.execute = mockExecute({ rows: [] });
  });

  it('401 without Authorization', async () => {
    (verifyJchatJwt as any).mockRejectedValue(new JchatError('AUTH_INVALID', 'no token'));
    const r = await request(makeApp()).post('/api/call/transcribe').send({});
    expect(r.status).toBe(401);
  });

  it('403 when caller not session owner', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'other' });
    // getSession returns session owned by u1, caller is 'other'
    mockDb.select = mockSelect([SESSION_ROW]);
    const r = await request(makeApp())
      .post('/api/call/transcribe')
      .set('Authorization', 'Bearer t')
      .send({ sessionId: 's1', transcriptEntryId: 'e1', sender: 'user', text: 'hi', timestamp: 1 });
    expect(r.status).toBe(403);
  });

  it('inserts a new message when transcriptEntryId is new', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'u1' });

    // getSession returns the session (select #1)
    // db.execute for existing transcript check returns empty rows
    // db.insert for new message
    let selectCalls = 0;
    mockDb.select = vi.fn(() => {
      selectCalls++;
      return mockSelect([SESSION_ROW])();
    });
    // execute #1: existing transcript check → empty
    // execute #2: upsert → returns new id
    let executeCalls = 0;
    mockDb.execute = vi.fn(() => {
      executeCalls++;
      if (executeCalls === 1) return { rows: [] };
      return { rows: [{ id: 'msg-new' }] };
    });

    const r = await request(makeApp())
      .post('/api/call/transcribe')
      .set('Authorization', 'Bearer t')
      .send({ sessionId: 's1', transcriptEntryId: 'e-new', sender: 'user', text: 'hi', timestamp: 1714000000000 });
    expect(r.status).toBe(200);
    expect(r.body.action).toBe('insert');
    expect(r.body.messageId).toBe('msg-new');
    expect(broadcastStub).toHaveBeenCalledWith('conversation:c1');
  });

  it('updates existing message when transcriptEntryId already known', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'u1' });

    // getSession returns the session
    mockDb.select = mockSelect([SESSION_ROW]);
    // execute #1: existing transcript check returns a row
    // execute #2: upsert returns the existing id
    let execCalls = 0;
    mockDb.execute = vi.fn(() => {
      execCalls++;
      if (execCalls === 1) return { rows: [{ id: 'msg-existing' }] };
      return { rows: [{ id: 'msg-existing' }] };
    });

    const r = await request(makeApp())
      .post('/api/call/transcribe')
      .set('Authorization', 'Bearer t')
      .send({ sessionId: 's1', transcriptEntryId: 'e-old', sender: 'gemini', text: 'hi extended', timestamp: 1 });
    expect(r.status).toBe(200);
    expect(r.body.action).toBe('update');
    expect(r.body.messageId).toBe('msg-existing');
  });

  it('400 on invalid sender', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'u1' });
    const r = await request(makeApp())
      .post('/api/call/transcribe')
      .set('Authorization', 'Bearer t')
      .send({ sessionId: 's1', transcriptEntryId: 'e1', sender: 'wrong', text: 't', timestamp: 1 });
    expect(r.status).toBe(400);
  });
});
