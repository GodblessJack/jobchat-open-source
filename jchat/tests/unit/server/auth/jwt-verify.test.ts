// jchat/tests/unit/server/auth/jwt-verify.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDb, mockSelect } from '../../../mock-db.js';

// Mock db to prevent real DB connection.
vi.mock('../../../../server/lib/db.js', () => ({ db: mockDb }));

// Config: AUTH_TRANSITION=0 — Supabase path is permanently removed.
vi.mock('../../../../server/config.js', () => ({
  config: {
    authTransition: false,
    nodeEnv: 'test',
  }
}));

// Mock local-jwt to control isLocalJwt/verifyAccessToken.
const verifyAccessTokenMock = vi.fn();
const isLocalJwtMock = vi.fn();
vi.mock('../../../../server/auth/local-jwt.js', () => ({
  isLocalJwt: (...args: unknown[]) => isLocalJwtMock(...args),
  verifyAccessToken: (...args: unknown[]) => verifyAccessTokenMock(...args),
}));

import { verifyJchatJwt, isJwtExpired } from '../../../../server/auth/jwt-verify.js';
import { JchatError } from '@shared/errors.js';

describe('verifyJchatJwt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select = mockSelect([]);
  });

  // ── Rejection paths ────────────────────────────────────────────────

  it('throws JchatError(AUTH_INVALID) on empty token', async () => {
    await expect(verifyJchatJwt('')).rejects.toMatchObject({
      code: 'AUTH_INVALID'
    });
    expect(isLocalJwtMock).not.toHaveBeenCalled();
  });

  it('throws JchatError(AUTH_INVALID) for non-local (unrecognized) tokens', async () => {
    isLocalJwtMock.mockReturnValue(false);
    await expect(verifyJchatJwt('some-unknown-token')).rejects.toMatchObject({
      code: 'AUTH_INVALID'
    });
    expect(isLocalJwtMock).toHaveBeenCalledWith('some-unknown-token');
  });

  // ── Local JWT path ─────────────────────────────────────────────────

  it('returns AuthedUser on valid local JWT', async () => {
    isLocalJwtMock.mockReturnValue(true);
    verifyAccessTokenMock.mockResolvedValue({ sub: 'user-1' });
    // Mock the db.select(...).from(...).where(...).limit(1) chain.
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'user-1', username: 'alice' }]),
    };
    mockDb.select = vi.fn().mockReturnValue(mockChain);

    const u = await verifyJchatJwt('valid-local-token');
    expect(u).toEqual({ id: 'user-1', username: 'alice' });
    expect(verifyAccessTokenMock).toHaveBeenCalledWith('valid-local-token');
  });

  it('throws AUTH_INVALID when local user not found in DB', async () => {
    isLocalJwtMock.mockReturnValue(true);
    verifyAccessTokenMock.mockResolvedValue({ sub: 'ghost-user' });

    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    mockDb.select = vi.fn().mockReturnValue(mockChain);

    await expect(verifyJchatJwt('valid-but-unknown')).rejects.toMatchObject({
      code: 'AUTH_INVALID'
    });
  });

  it('throws AUTH_INVALID when verifyAccessToken itself throws JchatError', async () => {
    isLocalJwtMock.mockReturnValue(true);
    verifyAccessTokenMock.mockRejectedValue(new JchatError('AUTH_INVALID', 'Token expired'));

    await expect(verifyJchatJwt('expired-token')).rejects.toMatchObject({
      code: 'AUTH_INVALID'
    });
  });

  it('wraps non-JchatError from verifyAccessToken as AUTH_INVALID', async () => {
    isLocalJwtMock.mockReturnValue(true);
    verifyAccessTokenMock.mockRejectedValue(new Error('crypto failure'));

    await expect(verifyJchatJwt('bad-sig')).rejects.toMatchObject({
      code: 'AUTH_INVALID'
    });
  });
});

describe('isJwtExpired', () => {
  it('returns true for empty string', () => {
    expect(isJwtExpired('')).toBe(true);
  });

  it('returns true for strings with fewer than 3 parts', () => {
    expect(isJwtExpired('a.b')).toBe(true);
  });

  it('returns true when exp is in the past (seconds since epoch)', () => {
    // Build a token with exp=1 (1970-01-01, way in the past).
    const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url');
    const token = `${header}.${payload}.fakesig`;
    expect(isJwtExpired(token)).toBe(true);
  });

  it('returns false when exp is in the future', () => {
    const farFuture = Math.floor(Date.now() / 1000) + 86400;
    const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ exp: farFuture })).toString('base64url');
    const token = `${header}.${payload}.fakesig`;
    expect(isJwtExpired(token)).toBe(false);
  });

  it('returns true when payload is not valid JSON', () => {
    const header = Buffer.from('{}').toString('base64url');
    const token = `${header}.!!!not-json!!!.sig`;
    expect(isJwtExpired(token)).toBe(true);
  });

  it('returns true when exp is not a number', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ exp: 'tomorrow' })).toString('base64url');
    const token = `${header}.${payload}.sig`;
    expect(isJwtExpired(token)).toBe(true);
  });
});