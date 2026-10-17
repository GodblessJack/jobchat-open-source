// jchat/tests/unit/server/distillation-run-route.test.ts
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
import { getDistillationQuota } from '../../../server/services/quota.js';
import { launchDistillation } from '../../../server/distillation/launcher.js';
import { mountDistillationRoutes } from '../../../server/distillation/distillation-routes.js';
import { __resetForTests } from '../../../server/distillation/run-registry.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  mountDistillationRoutes(app);
  return app;
}

describe('POST /api/distillation/run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetForTests();
    (verifyJchatJwt as any).mockResolvedValue({ id: 'user-1' });
    (getDistillationQuota as any).mockResolvedValue({ used: 0, limit: 3, allowed: true, reset_at: 'x' });
  });

  it('returns 202 + run_id and launches the distillation', async () => {
    const res = await request(makeApp())
      .post('/api/distillation/run')
      .set('Authorization', 'Bearer faketok')
      .send({ x_url: 'https://x.com/naval' });
    expect(res.status).toBe(202);
    expect(res.body.run_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(launchDistillation).toHaveBeenCalledWith({
      runId: res.body.run_id,
      userId: 'user-1',
      xUrl: 'https://x.com/naval',
    });
  });

  it('rejects /status/ URLs with invalid_x_url', async () => {
    const res = await request(makeApp())
      .post('/api/distillation/run')
      .set('Authorization', 'Bearer faketok')
      .send({ x_url: 'https://x.com/naval/status/123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_x_url');
    expect(launchDistillation).not.toHaveBeenCalled();
  });

  it('rejects non-X URLs', async () => {
    const res = await request(makeApp())
      .post('/api/distillation/run')
      .set('Authorization', 'Bearer faketok')
      .send({ x_url: 'https://example.com/naval' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_x_url');
  });

  it('400 quota_exhausted when allowed=false', async () => {
    (getDistillationQuota as any).mockResolvedValue({ used: 3, limit: 3, allowed: false, reset_at: 'x' });
    const res = await request(makeApp())
      .post('/api/distillation/run')
      .set('Authorization', 'Bearer faketok')
      .send({ x_url: 'https://x.com/naval' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('quota_exhausted');
  });

  it('400 concurrent_running when user already has a running run', async () => {
    await request(makeApp())
      .post('/api/distillation/run')
      .set('Authorization', 'Bearer faketok')
      .send({ x_url: 'https://x.com/naval' });
    const res2 = await request(makeApp())
      .post('/api/distillation/run')
      .set('Authorization', 'Bearer faketok')
      .send({ x_url: 'https://x.com/balajis' });
    expect(res2.status).toBe(400);
    expect(res2.body.error).toBe('concurrent_running');
  });

  it('accepts twitter.com aliases', async () => {
    const res = await request(makeApp())
      .post('/api/distillation/run')
      .set('Authorization', 'Bearer faketok')
      .send({ x_url: 'https://twitter.com/naval' });
    expect(res.status).toBe(202);
  });
});
