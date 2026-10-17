// jchat/tests/unit/server/distillation-status-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../server/auth/jwt-verify.js', () => ({
  verifyJchatJwt: vi.fn(),
}));
vi.mock('../../../server/services/quota.js', () => ({
  getDistillationQuota: vi.fn(),
}));
vi.mock('../../../server/distillation/launcher.js', () => ({
  launchDistillation: vi.fn().mockResolvedValue(undefined),
}));
import { verifyJchatJwt } from '../../../server/auth/jwt-verify.js';
import {
  __resetForTests,
  createRun,
  markDone,
  markError,
} from '../../../server/distillation/run-registry.js';
import { mountDistillationRoutes } from '../../../server/distillation/distillation-routes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  mountDistillationRoutes(app);
  return app;
}

describe('GET /api/distillation/run/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetForTests();
    (verifyJchatJwt as any).mockResolvedValue({ id: 'user-1' });
  });

  it('returns running status', async () => {
    const id = createRun('user-1', 'https://x.com/naval');
    const res = await request(makeApp())
      .get(`/api/distillation/run/${id}`)
      .set('Authorization', 'Bearer faketok');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('running');
    expect(typeof res.body.started_at).toBe('string');
  });

  it('returns done status with payload', async () => {
    const id = createRun('user-1', 'https://x.com/naval');
    markDone(id, { agent_id: 'a1', name: 'Naval', avatar_url: 'http://x/a.png', slug: 'naval' });
    const res = await request(makeApp())
      .get(`/api/distillation/run/${id}`)
      .set('Authorization', 'Bearer faketok');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'done',
      agent_id: 'a1',
      slug: 'naval',
      name: 'Naval',
      avatar_url: 'http://x/a.png',
    });
  });

  it('returns error status with code and message', async () => {
    const id = createRun('user-1', 'https://x.com/naval');
    markError(id, 'NO_CONTACT_CREATED', 'ta 的 X 公开内容太少');
    const res = await request(makeApp())
      .get(`/api/distillation/run/${id}`)
      .set('Authorization', 'Bearer faketok');
    expect(res.body.status).toBe('error');
    expect(res.body.code).toBe('NO_CONTACT_CREATED');
  });

  it('403 when run belongs to another user', async () => {
    const id = createRun('user-2', 'https://x.com/naval');
    const res = await request(makeApp())
      .get(`/api/distillation/run/${id}`)
      .set('Authorization', 'Bearer faketok');
    expect(res.status).toBe(403);
  });

  it('404 when run does not exist', async () => {
    const res = await request(makeApp())
      .get('/api/distillation/run/00000000-0000-0000-0000-000000000099')
      .set('Authorization', 'Bearer faketok');
    expect(res.status).toBe(404);
  });
});
