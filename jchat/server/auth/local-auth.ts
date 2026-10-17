// jchat/server/auth/local-auth.ts
//
// Business logic for local (username + password) authentication.
// Replaces Supabase Auth for the custom-auth path.
//
// Provides: register, login, refresh, logout.
//
// Password hashing: Argon2id via @node-rs/argon2 (native Rust binding).
// Token signing/verification: HS256 via jose.

import { hash, verify } from '@node-rs/argon2';
import crypto from 'node:crypto';
import { db } from '../lib/db.js';
import { localUsers, agents, userAgents } from '../sql/schema/index.js';
import { eq, sql } from 'drizzle-orm';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './local-jwt.js';
import { JchatError } from '@shared/errors.js';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,30}$/;
const ARGON2_OPTIONS = {
  memoryCost: 19456,   // 19 MiB
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
};

/** Progressive lockout schedule (after Nth failure): seconds */
const LOCKOUT_SCHEDULE = [0, 0, 0, 0, 0, 30, 60, 300, 900, 3600];
const MAX_LOCKOUT = 3600; // cap at 1 hour

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string | null;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

/* ------------------------------------------------------------------ */
/*  Register                                                           */
/* ------------------------------------------------------------------ */

interface RegisterInput {
  username: string;
  password: string;
  displayName?: string;
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const { username, password, displayName } = input;

  // --- Validate username ---
  if (!USERNAME_RE.test(username)) {
    throw new JchatError('VALIDATION_ERROR',
      'Username must be 3-30 characters: letters, numbers, underscores, hyphens');
  }

  // --- Validate password ---
  if (password.length < 8 || password.length > 128) {
    throw new JchatError('VALIDATION_ERROR',
      'Password must be between 8 and 128 characters');
  }

  // --- Check uniqueness ---
  const existing = await db
    .select({ id: localUsers.id })
    .from(localUsers)
    .where(eq(localUsers.username, username))
    .limit(1);

  if (existing.length > 0) {
    throw new JchatError('VALIDATION_ERROR', 'Username already taken');
  }

  // --- Hash password ---
  const passwordHash = await hash(password, ARGON2_OPTIONS);

  // --- Insert user ---
  const inserted = await db
    .insert(localUsers)
    .values({
      username,
      passwordHash,
      displayName: displayName || username,
    })
    .returning({
      id: localUsers.id,
      username: localUsers.username,
      displayName: localUsers.displayName,
    });

  const user = inserted[0];
  if (!user) {
    throw new JchatError('INTERNAL_ERROR', 'Failed to create user');
  }

  // --- Link default agents to the new user ---
  // New users should see all is_default agents in their contact list
  // immediately after registration. Uses ON CONFLICT DO NOTHING so the
  // call is idempotent (safe to re-run on backfill).
  try {
    const defaultAgents = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.isDefault, true));

    if (defaultAgents.length > 0) {
      await db
        .insert(userAgents)
        .values(
          defaultAgents.map((a) => ({
            userId: user.id,
            agentId: a.id,
            isRemovable: true,
          }))
        )
        .onConflictDoNothing();
    }
  } catch (err) {
    // Non-fatal: the user can still log in; contacts can be added later.
    console.error('[local-auth] Failed to link default agents for new user:', (err as Error).message);
  }

  // --- Issue tokens ---
  return {
    ...(await issueTokens(user)),
    user: { id: user.id, username: user.username, displayName: user.displayName },
  };
}

/* ------------------------------------------------------------------ */
/*  Login                                                              */
/* ------------------------------------------------------------------ */

interface LoginInput {
  username: string;
  password: string;
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const { username, password } = input;

  // --- Find user ---
  const rows = await db
    .select()
    .from(localUsers)
    .where(eq(localUsers.username, username))
    .limit(1);

  const userRow = rows[0];
  if (!userRow) {
    // Burn equivalent time to a real Argon2 verify to prevent
    // timing-based username enumeration.
    // Use a structurally valid dummy hash so @node-rs/argon2 doesn't throw.
    try {
      await verify('$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'dummy', ARGON2_OPTIONS);
    } catch {
      // If the dummy verify throws (e.g. library version mismatch), fall
      // through — the timing defence is best-effort, not security-critical.
    }
    throw new JchatError('AUTH_INVALID', 'Invalid username or password');
  }

  // --- Check lockout ---
  if (userRow.lockedUntil && new Date(userRow.lockedUntil) > new Date()) {
    const remaining = Math.ceil(
      (new Date(userRow.lockedUntil).getTime() - Date.now()) / 1000
    );
    throw new JchatError('RATE_LIMITED',
      `Account locked. Try again in ${remaining} seconds`);
  }

  // --- Verify password ---
  const valid = await verify(userRow.passwordHash, password, ARGON2_OPTIONS);

  if (!valid) {
    // Increment failure count and apply lockout if threshold crossed
    const newAttempts = userRow.failedAttempts + 1;
    const lockSeconds = LOCKOUT_SCHEDULE[newAttempts] ?? MAX_LOCKOUT;
    const lockUntil = lockSeconds > 0
      ? new Date(Date.now() + lockSeconds * 1000)
      : null;

    await db
      .update(localUsers)
      .set({
        failedAttempts: newAttempts,
        lockedUntil: lockUntil,
      })
      .where(eq(localUsers.id, userRow.id));

    throw new JchatError('AUTH_INVALID', 'Invalid username or password');
  }

  // --- Success: reset failures, update lastLogin ---
  await db
    .update(localUsers)
    .set({
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    })
    .where(eq(localUsers.id, userRow.id));

  // --- Issue tokens ---
  return {
    ...(await issueTokens(userRow)),
    user: {
      id: userRow.id,
      username: userRow.username,
      displayName: userRow.displayName,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Refresh                                                            */
/* ------------------------------------------------------------------ */

/**
 * Rotate a refresh token. On success, the old token is marked as
 * replaced_by the new jti and a new token is issued.
 *
 * THEFT_DETECTED: if the old token was already replaced, all tokens in
 * the family are invalidated (someone stole & used the old token).
 */
export async function refresh(refreshToken: string): Promise<AuthResult> {
  const payload = await verifyRefreshToken(refreshToken);
  const jti = payload.jti;
  if (!jti) throw new JchatError('AUTH_INVALID', 'Malformed refresh token');

  // Theft detection runs OUTSIDE the transaction so the THEFT_DETECTED status
  // persists even if the subsequent transaction rolls back.  We do a
  // non-locking pre-check first to avoid holding a row lock for the full
  // duration of the theft-path UPDATE + throw.
  const preCheck = await db.execute(
    sql`SELECT id FROM refresh_token_families
        WHERE jti = ${jti} AND status = 'ACTIVE' AND replaced_by IS NULL
        LIMIT 1`
  );
  if (!(preCheck.rows as any[])?.[0]) {
    // Token not found or already replaced.  Before marking the entire family
    // as THEFT_DETECTED, check whether the replacing token was created within
    // a grace period.  A retry arriving right after a successful concurrent
    // rotation (flaky network, client-side retry logic) should NOT nuke the
    // family — it should just be rejected silently.
    const GRACE_MS = 5000;
    const ti = await db.execute(
      sql`SELECT rtf.replaced_by, rtf2.created_at as replacing_created_at
          FROM refresh_token_families rtf
          LEFT JOIN refresh_token_families rtf2 ON rtf2.jti = rtf.replaced_by
          WHERE rtf.jti = ${jti}
          LIMIT 1`
    );
    const ri = (ti.rows as any[])?.[0];

    if (ri?.replacing_created_at) {
      const age = Date.now() - new Date(ri.replacing_created_at as string).getTime();
      if (age < GRACE_MS) {
        throw new JchatError('AUTH_INVALID', 'Refresh token already used');
      }
    }

    // Outside the grace window — true theft pattern.
    await db.execute(
      sql`UPDATE refresh_token_families
          SET status = 'THEFT_DETECTED'
          WHERE family_id = (
            SELECT family_id FROM refresh_token_families WHERE jti = ${jti} LIMIT 1
          )`
    );
    throw new JchatError('AUTH_INVALID', 'Refresh token reused — possible theft');
  }

  // All subsequent DB operations run in a single transaction with FOR UPDATE
  // to serialize concurrent refresh attempts on the same token family.
  const result = await db.transaction(async (tx) => {
    const familiesResult = await tx.execute(
      sql`SELECT id, user_id, family_id, jti, status, replaced_by, expires_at
          FROM refresh_token_families
          WHERE jti = ${jti} AND status = 'ACTIVE' AND replaced_by IS NULL
          LIMIT 1
          FOR UPDATE`
    );

    const tokenRow = (familiesResult.rows as any[])?.[0];
    if (!tokenRow) {
      // Raced with another refresh — token was replaced between preCheck and now.
      throw new JchatError('AUTH_INVALID', 'Refresh token reused — possible theft');
    }

    const familyId = tokenRow.family_id as string;
    const userId = tokenRow.user_id as string;

    const userRows = await tx
      .select({
        id: localUsers.id,
        username: localUsers.username,
        displayName: localUsers.displayName,
      })
      .from(localUsers)
      .where(eq(localUsers.id, userId))
      .limit(1);

    const user = userRows[0];
    if (!user) {
      throw new JchatError('AUTH_INVALID', 'User not found');
    }

    const newJti = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await tx.execute(
      sql`UPDATE refresh_token_families
          SET replaced_by = ${newJti}
          WHERE jti = ${jti}`
    );

    await tx.execute(
      sql`INSERT INTO refresh_token_families (user_id, family_id, jti, expires_at)
          VALUES (${userId}::uuid, ${familyId}, ${newJti}, ${expiresAt})`
    );

    return { newJti, user };
  });

  const { newJti, user } = result;
  const newRefreshToken = await signRefreshToken(
    { id: user.id, username: user.username },
    newJti
  );

  // Issue new access token
  const newAccessToken = await signAccessToken({
    id: user.id,
    username: user.username,
  });

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    user,
  };
}

/* ------------------------------------------------------------------ */
/*  Logout                                                             */
/* ------------------------------------------------------------------ */

/**
 * Mark all refresh tokens for this user as LOGOUT'd. Does not invalidate
 * the current access token (it will expire naturally via its short TTL).
 */
export async function logout(userId: string): Promise<void> {
  await db.execute(
    sql`UPDATE refresh_token_families
        SET status = 'LOGOUT'
        WHERE user_id = ${userId}::uuid AND status = 'ACTIVE'`
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function issueTokens(user: { id: string; username: string }): Promise<AuthTokens> {
  const familyId = crypto.randomUUID();
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Persist refresh token family
  await db.execute(
    sql`INSERT INTO refresh_token_families (user_id, family_id, jti, expires_at)
        VALUES (${user.id}::uuid, ${familyId}, ${jti}, ${expiresAt})`
  );

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(user),
    signRefreshToken(user, jti),
  ]);

  return { accessToken, refreshToken };
}
