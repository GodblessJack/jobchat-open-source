// jchat/server/auth/ws-auth-middleware.ts
//
// WebSocket upgrade-time auth: extract JWT from `Authorization: Bearer <token>`
// header or `?token=` query string, verify it via `verifyJchatJwt`, and
// attach the authed user to the WebSocket instance.

import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { verifyJchatJwt, type AuthedUser } from './jwt-verify.js';
import { JchatError } from '@shared/errors';

/** WebSocket extended with the authenticated user. */
export interface AuthedWebSocket extends WebSocket {
  user: AuthedUser;
}

/**
 * Extract a JWT from an HTTP upgrade request. Checks:
 *   1. `Authorization: Bearer <token>` header
 *   2. `?token=<token>` query string (fallback for browsers that can't set
 *      headers on WebSocket upgrades)
 *
 * Returns the raw token string, or `null` if absent.
 */
export function extractJwtFromUpgrade(req: IncomingMessage): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m && m[1]) return m[1].trim();
  }

  // Query-string fallback. `req.url` is path+query.
  const url = req.url || '';
  const qIdx = url.indexOf('?');
  if (qIdx >= 0) {
    const params = new URLSearchParams(url.slice(qIdx + 1));
    const t = params.get('token');
    if (t) return t;
  }

  return null;
}

/**
 * Run upgrade-time auth. Verifies the JWT and attaches the user to `ws`.
 * Returns both the user and the raw token so the router can store it on
 * the WS auth context for mid-session expiry checks (see isJwtExpired).
 * @throws JchatError('AUTH_INVALID') when no token or invalid token
 */
export async function attachAuthToSocket(
  ws: WebSocket,
  req: IncomingMessage
): Promise<{ user: AuthedUser; token: string }> {
  const token = extractJwtFromUpgrade(req);
  if (!token) {
    throw new JchatError('AUTH_INVALID', 'missing token in upgrade request');
  }
  const user = await verifyJchatJwt(token);
  (ws as AuthedWebSocket).user = user;
  return { user, token };
}
