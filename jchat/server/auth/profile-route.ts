// jchat/server/auth/profile-route.ts
//
// Express route: POST /api/profile
// Accepts { timezone, locale } from the authenticated frontend and upserts
// into jchat_user_profile. Auth is via the JWT in the Authorization
// header (Bearer token), validated by verifyJchatJwt.
//
// Validation rules:
//   timezone — IANA tz format, conservative: /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/
//   locale   — BCP 47 simplified:             /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/
//   At least one of the two must be valid; otherwise 400.
//
// HTTP responses:
//   204  — upsert succeeded
//   400  — neither timezone nor locale passed validation
//   401  — missing / invalid Authorization header (verifyJchatJwt throws AUTH_INVALID)
//   500  — upsert error

import type { Express, Request, Response } from 'express';
import { db } from '../lib/db.js';
import { sql } from 'drizzle-orm';
import { verifyJchatJwt } from './jwt-verify.js';
import { logger } from '../logger.js';
import { JchatError } from '@shared/errors.js';

const TZ_RE = /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/;
const LOCALE_RE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/;

export function mountProfileRoute(app: Express): void {
  app.post('/api/profile', async (req: Request, res: Response) => {
    // ── Auth ──────────────────────────────────────────────────────────────
    const authHeader = req.header('authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    let userId: string;
    try {
      const user = await verifyJchatJwt(token);
      userId = user.id;
    } catch (err) {
      const code = err instanceof JchatError ? err.code : 'INTERNAL_ERROR';
      if (code === 'AUTH_INVALID') {
        return res.status(401).end();
      }
      logger.warn({ err }, 'profile-route: unexpected auth error');
      return res.status(500).end();
    }

    // ── Validate payload ─────────────────────────────────────────────────
    const { timezone, locale } = (req.body ?? {}) as {
      timezone?: unknown;
      locale?: unknown;
    };
    const tz = typeof timezone === 'string' && TZ_RE.test(timezone) ? timezone : null;
    const lc = typeof locale === 'string' && LOCALE_RE.test(locale) ? locale : null;

    if (!tz && !lc) {
      return res.status(400).end();
    }

    // ── Upsert ───────────────────────────────────────────────────────────
    // Only include fields that passed validation so a partial update (e.g.
    // timezone only) does not overwrite a previously-stored locale with null.
    try {
      await db.execute(sql`
        INSERT INTO jchat_user_profile (user_id, timezone, locale, updated_at)
        VALUES (${userId}, ${tz}, ${lc}, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          timezone = COALESCE(${tz}, jchat_user_profile.timezone),
          locale = COALESCE(${lc}, jchat_user_profile.locale),
          updated_at = NOW()
      `);
    } catch (err) {
      logger.warn({ err, userId }, 'profile-route: upsert failed');
      return res.status(500).end();
    }

    return res.status(204).end();
  });
}
