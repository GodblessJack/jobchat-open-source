// jchat/tests/unit/server/call-persona.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mockDb, mockSelect } from '../../mock-db.js';

vi.mock('../../../server/auth/jwt-verify.js', () => ({ verifyJchatJwt: vi.fn() }));
vi.mock('../../../server/lib/db.js', () => ({ db: mockDb }));

import { verifyJchatJwt } from '../../../server/auth/jwt-verify.js';
import { mountCallRoutes } from '../../../server/call/call-routes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  mountCallRoutes(app, { broadcastConvSnapshot: vi.fn().mockResolvedValue(undefined) });
  return app;
}

describe('GET /api/call/persona', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select = mockSelect([]);
  });

  it('returns systemInstruction with identity + last messages', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'u1' });

    // resolveDmOwner makes 2 select calls:
    // 1. select conversations (returns DM owned by u1)
    // 2. select members (returns agent a1)
    // Then the route makes:
    // 3. select agents (returns agent with name/identity)
    // 4. select messages (returns history)
    let callIdx = 0;
    mockDb.select = vi.fn(() => {
      callIdx++;
      if (callIdx === 1) {
        return mockSelect([{ id: 'c1', userId: 'u1', type: 'dm' }])();
      }
      if (callIdx === 2) {
        return mockSelect([{ agentId: 'a1' }])();
      }
      if (callIdx === 3) {
        return mockSelect([{
          id: 'a1', name: '李雷', avatarUrl: 'http://x',
          role: null, personaDescription: null,
          identity: { emoji: '😊', self_address: '李雷', user_address: null, speaking_style: null, signature_phrases: null },
          bootstrapMd: 'help',
        }])();
      }
      // callIdx === 4: message history
      return mockSelect([
        { senderType: 'user', content: '你好', createdAt: new Date('2026-04-01T00:00:00Z') },
        { senderType: 'agent', content: '你好,有什么可以帮你', createdAt: new Date('2026-04-01T00:00:01Z') },
      ])();
    });

    const r = await request(makeApp())
      .get('/api/call/persona?conversationId=c1')
      .set('Authorization', 'Bearer t');
    expect(r.status).toBe(200);
    expect(r.body.session.agentName).toBe('李雷');
    expect(r.body.systemInstruction).toContain('自称"李雷"');
    expect(r.body.systemInstruction).toContain('你好');
  });

  it('400 when conversationId missing', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'u1' });
    const r = await request(makeApp()).get('/api/call/persona').set('Authorization', 'Bearer t');
    expect(r.status).toBe(400);
  });

  it('403 for group conversation', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'u1' });
    // resolveDmOwner: first select returns group type → 403
    mockDb.select = mockSelect([{ id: 'c1', userId: 'u1', type: 'group' }]);
    const r = await request(makeApp()).get('/api/call/persona?conversationId=c1').set('Authorization', 'Bearer t');
    expect(r.status).toBe(403);
  });
});
