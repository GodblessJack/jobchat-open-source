// jchat/server/auth/local-jwt.ts
//
// JWT sign/verify using jose (HS256). Replaces Supabase Auth JWT for the
// local authentication path. Tokens are self-contained; no network calls.
//
// Two token types:
//   access  — short-lived (15 min), carried in Authorization header
//   refresh — long-lived (7 days), stored in httpOnly cookie

import * as jose from 'jose';
import type { JWTPayload } from 'jose';
import { config } from '../config.js';

const ACCESS_TTL = '15 minutes';
const REFRESH_TTL = '7 days';

/* ------------------------------------------------------------------ */
/*  Secret helpers                                                     */
/* ------------------------------------------------------------------ */

function getAccessSecret(): Uint8Array {
  if (!config.jwtAccessSecret) throw new Error('LOCAL_JWT_ACCESS_SECRET not set');
  return new TextEncoder().encode(config.jwtAccessSecret);
}

function getRefreshSecret(): Uint8Array {
  if (!config.jwtRefreshSecret) throw new Error('LOCAL_JWT_REFRESH_SECRET not set');
  return new TextEncoder().encode(config.jwtRefreshSecret);
}

/* ------------------------------------------------------------------ */
/*  Payload shape                                                      */
/* ------------------------------------------------------------------ */

export interface LocalJwtPayload extends JWTPayload {
  sub: string;
  username: string;
  type: 'access' | 'refresh';
  jti?: string;
}

/* ------------------------------------------------------------------ */
/*  Sign                                                               */
/* ------------------------------------------------------------------ */

export async function signAccessToken(user: { id: string; username: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new jose.SignJWT({ sub: user.id, username: user.username, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(ACCESS_TTL)
    .setIssuer('jobchat')
    .sign(getAccessSecret());
}

export async function signRefreshToken(user: { id: string; username: string }, jti: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new jose.SignJWT({ sub: user.id, username: user.username, type: 'refresh', jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(REFRESH_TTL)
    .setIssuer('jobchat')
    .sign(getRefreshSecret());
}

/* ------------------------------------------------------------------ */
/*  Verify                                                             */
/* ------------------------------------------------------------------ */

export async function verifyAccessToken(token: string): Promise<LocalJwtPayload> {
  const { payload } = await jose.jwtVerify(token, getAccessSecret(), {
    issuer: 'jobchat',
  });
  if (payload.type !== 'access') throw new Error('Wrong token type');
  return payload as unknown as LocalJwtPayload;
}

export async function verifyRefreshToken(token: string): Promise<LocalJwtPayload> {
  const { payload } = await jose.jwtVerify(token, getRefreshSecret(), {
    issuer: 'jobchat',
  });
  if (payload.type !== 'refresh') throw new Error('Wrong token type');
  return payload as unknown as LocalJwtPayload;
}

/* ------------------------------------------------------------------ */
/*  Detection helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Cheap heuristic: is this a locally-issued HS256 JWT vs a Supabase JWT?
 * Checks only the header — no signature verification, no network call.
 */
export function isLocalJwt(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    return header.alg === 'HS256';
  } catch {
    return false;
  }
}
