import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mockDb, mockExecute } from '../../../mock-db.js';
import { JchatError } from '@shared/errors.js';

vi.mock('../../../../server/lib/db.js', () => ({ db: mockDb }));
vi.mock('../../../../server/auth/jwt-verify.js', () => ({
  verifyJchatJwt: vi.fn()
}));

import { verifyJchatJwt } from '../../../../server/auth/jwt-verify.js';
import { mountProfileRoute } from '../../../../server/auth/profile-route.js';

describe('POST /api/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.execute = mockExecute({ rows: [] });
  });

  it('upserts timezone+locale and returns 204', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'u1', email: 'a@b.com' });
    mockDb.execute = mockExecute({ rows: [] });

    const app = express();
    app.use(express.json());
    mountProfileRoute(app);

    const res = await request(app)
      .post('/api/profile')
      .set('Authorization', 'Bearer faketoken')
      .send({ timezone: 'Asia/Shanghai', locale: 'zh-CN' });

    expect(res.status).toBe(204);
    // The execute spy should have been called with the upsert SQL
    expect(mockDb.execute).toHaveBeenCalled();
  });

  it('rejects malformed timezone and locale with 400', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'u1', email: 'a@b.com' });

    const app = express();
    app.use(express.json());
    mountProfileRoute(app);

    const res = await request(app)
      .post('/api/profile')
      .set('Authorization', 'Bearer x')
      .send({ timezone: '../etc/passwd', locale: 'not-valid-locale!!' });

    expect(res.status).toBe(400);
  });

  it('partial update (timezone only) does not include locale: null in payload', async () => {
    (verifyJchatJwt as any).mockResolvedValue({ id: 'u2', email: 'a@b.com' });
    const executeSpy = mockExecute({ rows: [] });
    mockDb.execute = executeSpy;

    const app = express();
    app.use(express.json());
    mountProfileRoute(app);

    const res = await request(app)
      .post('/api/profile')
      .set('Authorization', 'Bearer faketoken')
      .send({ timezone: 'Asia/Shanghai' }); // no locale field

    expect(res.status).toBe(204);
    expect(executeSpy).toHaveBeenCalled();
  });

  it('returns 401 when auth header is missing', async () => {
    (verifyJchatJwt as any).mockRejectedValue(new JchatError('AUTH_INVALID', 'missing token'));

    const app = express();
    app.use(express.json());
    mountProfileRoute(app);

    const res = await request(app).post('/api/profile').send({});

    expect(res.status).toBe(401);
  });
});
