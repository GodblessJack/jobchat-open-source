// jchat/tests/unit/server/distillation-quota-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../server/auth/jwt-verify.js', () => ({
  verifyJchatJwt: vi.fn(),
}));
vi.mock('../../../server/services/quota.js', () => ({
  getDistillationQuota: vi.fn(),
}));

import { verifyJchatJwt } from '../../../server/auth/jwt-verify.js';
import { getDistillationQuota } from '../../../server/services/quota.js';
import { mountDistillationRoutes } from '../../../server/distillation/distillation-routes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  mountDistillationRoutes(app);
  return app;
}

describe('GET /api/distillation/quota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns quota for authenticated user', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'user-1' });
    (getDistillationQuota as any).mockResolvedValue({
      used: 1,
      limit: 3,
      allowed: true,
      reset_at: '2026-05-15T16:00:00.000Z',
    });
    const res = await request(makeApp())
      .get('/api/distillation/quota')
      .set('Authorization', 'Bearer faketok');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      used: 1,
      limit: 3,
      remaining: 2,
      reset_at: '2026-05-15T16:00:00.000Z',
    });
  });

  it('401 when no Authorization header', async () => {
    const res = await request(makeApp()).get('/api/distillation/quota');
    expect(res.status).toBe(401);
  });
});
