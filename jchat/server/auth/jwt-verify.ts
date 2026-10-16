// jchat/server/auth/jwt-verify.ts
//
// Local JWT verification (HS256 via jose).
//
// Flow:
//   1. Fast local check: if `isLocalJwt(token)` → verify locally & look up user
//      in the `local_users` table. No network call.
//   2. Otherwise: reject with AUTH_INVALID.

import { Buffer } from 'node:buffer';
import { JchatError } from '@shared/errors';
import { isLocalJwt, verifyAccessToken } from './local-jwt.js';
import { db } from '../lib/db.js';
import { localUsers } from '../sql/schema/index.js';
import { eq } from 'drizzle-orm';
import { logger } from '../logger.js';

/**
 * Cheap local-only check: is this JWT's `exp` claim in the past?
 *
 * Used for mid-session re-validation: the upgrade-time `verifyJchatJwt`
 * call already proved the signature is valid (and the user exists). After
 * that we trust the token until its `exp` instant.
 *
 * Returns true if the token is malformed, missing `exp`, or expired;
 * false if it's still within its validity window. The conservative bias
 * (treat malformed as expired) is intentional — a broken token never
 * passed upgrade-time verify, so seeing one here would mean tampering.
 */
export function isJwtExpired(token: string, now = Date.now()): boolean {
  if (!token || typeof token !== 'string') return true;
  const parts = token.split('.');
  if (parts.length !== 3) return true;
  let payload: { exp?: unknown };
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
  } catch {
    return true;
  }
  if (typeof payload.exp !== 'number') return true;
  return payload.exp * 1000 <= now;
}

export interface AuthedUser {
  id: string;
  email?: string;
  username?: string;
}

/**
 * Verify a JWT — supports both local (HS256) and Supabase tokens.
 * @throws JchatError('AUTH_INVALID') for invalid/expired tokens
 * @throws JchatError('INTERNAL_ERROR') for transport / unexpected errors
 */
export async function verifyJchatJwt(token: string): Promise<AuthedUser> {
  if (!token || typeof token !== 'string') {
    throw new JchatError('AUTH_INVALID', 'missing token');
  }

  // ── Path 1: local JWT (no network call) ──────────────────────────
  if (isLocalJwt(token)) {
    try {
      const payload = await verifyAccessToken(token);
      // Reject purpose-specific tokens (upload/download) — they share the
      // same HS256 secret and type='access' but must not grant full API auth.
      if ((payload as any).purpose) {
        throw new JchatError('AUTH_INVALID', 'purpose-specific token rejected');
      }

      const rows = await db
        .select({ id: localUsers.id, username: localUsers.username, displayName: localUsers.displayName })
        .from(localUsers)
        .where(eq(localUsers.id, payload.sub))
        .limit(1);

      const user = rows[0];
      if (!user) {
        throw new JchatError('AUTH_INVALID', 'User not found');
      }

      return { id: user.id, username: user.username ?? undefined };
    } catch (err) {
      if (err instanceof JchatError) throw err;
      logger.warn({ err }, 'jwt local verification failed');
      throw new JchatError('AUTH_INVALID', 'Token verification failed');
    }
  }

  // ── Not a local JWT — reject ──────────────────────────────────────
  throw new JchatError('AUTH_INVALID', 'Unrecognized token format');
}
