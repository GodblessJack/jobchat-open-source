// jchat/server/auth/auth-routes.ts
//
// Express routes for local (username + password) authentication.
//
// IMPORTANT: The caller MUST register `app.use(express.json())` and
// `app.use(cookieParser())` BEFORE mounting these routes.
//
// Routes:
//   POST /api/auth/register  — create account (rate-limited 5/15min per IP)
//   POST /api/auth/login     — authenticate   (rate-limited 5/15min per IP)
//   POST /api/auth/refresh   — rotate refresh token (reads from httpOnly cookie)
//   POST /api/auth/logout    — clear refresh token family (clears cookie)
//   GET  /api/auth/me        — current user from Bearer token
//
// Cookie config:
//   httpOnly, secure in production, sameSite: 'strict',
//   path: /api/auth/refresh (narrow scope),
//   maxAge: 7 days

import type { Express, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { register, login, refresh, logout } from './local-auth.js';
import { verifyJchatJwt } from './jwt-verify.js';
import { JchatError } from '@shared/errors.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

/* ------------------------------------------------------------------ */
/*  Rate limiters                                                      */
/* ------------------------------------------------------------------ */

const isDev = config.nodeEnv !== 'production';

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 200 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 200 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
});

/* ------------------------------------------------------------------ */
/*  Cookie helpers                                                     */
/* ------------------------------------------------------------------ */

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.nodeEnv === 'production',
  sameSite: 'strict' as const,
  path: '/api/auth/refresh',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

const CLEAR_COOKIE_OPTIONS = { ...COOKIE_OPTIONS, maxAge: 0 };

/* ------------------------------------------------------------------ */
/*  Mount                                                              */
/* ------------------------------------------------------------------ */

export function mountAuthRoutes(app: Express): void {
  // ── POST /api/auth/register ──────────────────────────────────────
  app.post('/api/auth/register', registerLimiter, async (req: Request, res: Response) => {
    const { username, password, displayName } = (req.body ?? {}) as {
      username?: unknown;
      password?: unknown;
      displayName?: unknown;
    };

    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'username and password are required' });
    }

    try {
      const result = await register({
        username,
        password,
        displayName: typeof displayName === 'string' ? displayName : undefined,
      });

      res.cookie('refresh_token', result.refreshToken, COOKIE_OPTIONS);
      return res.status(201).json({
        accessToken: result.accessToken,
        user: result.user,
      });
    } catch (err) {
      return handleAuthError(res, err);
    }
  });

  // ── POST /api/auth/login ─────────────────────────────────────────
  app.post('/api/auth/login', loginLimiter, async (req: Request, res: Response) => {
    const { username, password } = (req.body ?? {}) as {
      username?: unknown;
      password?: unknown;
    };

    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'username and password are required' });
    }

    try {
      const result = await login({ username, password });

      res.cookie('refresh_token', result.refreshToken, COOKIE_OPTIONS);
      return res.status(200).json({
        accessToken: result.accessToken,
        user: result.user,
      });
    } catch (err) {
      return handleAuthError(res, err);
    }
  });

  // ── POST /api/auth/refresh ───────────────────────────────────────
  const refreshLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
  });

  app.post('/api/auth/refresh', refreshLimiter, async (req: Request, res: Response) => {
    const token: string | undefined = req.cookies?.refresh_token;
    if (!token) {
      return res.status(401).json({ error: 'AUTH_INVALID', message: 'No refresh token' });
    }

    try {
      const result = await refresh(token);

      res.cookie('refresh_token', result.refreshToken, COOKIE_OPTIONS);
      return res.status(200).json({
        accessToken: result.accessToken,
        user: result.user,
      });
    } catch (err) {
      // Only clear the cookie on genuine auth/validation failures — NOT on
      // transient DB/infra errors where the token may still be valid.
      const code = (err as any)?.code;
      if ((err as any)?.name === 'JchatError' || code === 'AUTH_INVALID' || code === 'VALIDATION_ERROR' || code === 'ERR_JWT_EXPIRED') {
        res.cookie('refresh_token', '', CLEAR_COOKIE_OPTIONS);
      }
      return handleAuthError(res, err);
    }
  });

  // ── POST /api/auth/logout ────────────────────────────────────────
  app.post('/api/auth/logout', async (req: Request, res: Response) => {
    try {
      // Extract user from Bearer token to know whose tokens to invalidate
      const authHeader = req.header('authorization') ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (token) {
        const user = await verifyJchatJwt(token).catch(() => null);
        if (user) {
          await logout(user.id).catch((err) => {
            logger.warn({ err }, 'logout: failed to invalidate refresh tokens');
          });
        }
      }
    } catch {
      // Best-effort: always clear the cookie
    }

    res.cookie('refresh_token', '', CLEAR_COOKIE_OPTIONS);
    return res.status(204).end();
  });

  // ── GET /api/auth/me ──────────────────────────────────────────────
  app.get('/api/auth/me', async (req: Request, res: Response) => {
    const authHeader = req.header('authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!token) {
      return res.status(401).json({ error: 'AUTH_INVALID', message: 'Missing token' });
    }

    try {
      const user = await verifyJchatJwt(token);
      return res.status(200).json({ user });
    } catch (err) {
      return handleAuthError(res, err);
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Error handler                                                      */
/* ------------------------------------------------------------------ */

function handleAuthError(res: Response, err: unknown): Response {
  if (err instanceof JchatError) {
    switch (err.code) {
      case 'VALIDATION_ERROR':
        return res.status(400).json({ error: err.code, message: err.message, details: err.details });
      case 'AUTH_INVALID':
        return res.status(401).json({ error: err.code, message: err.message });
      case 'RATE_LIMITED':
        return res.status(429).json({ error: err.code, message: err.message });
      default:
        return res.status(500).json({ error: err.code, message: 'Internal error' });
    }
  }
  // Non-JchatError — could be a raw jose JWT verification error.
  const code = (err as any)?.code;
  if (code === 'ERR_JWT_EXPIRED' || code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' || code === 'ERR_JWS_INVALID') {
    return res.status(401).json({ error: 'AUTH_INVALID', message: 'Token invalid or expired — please log in again' });
  }
  logger.error({ err }, 'auth-routes: unexpected error');
  return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal error' });
}
