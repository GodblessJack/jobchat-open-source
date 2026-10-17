// jchat/server/agent/user-profile.ts
import { db } from '../lib/db.js';
import { jchatUserProfile, localUsers, users } from '../sql/schema/index.js';
import { eq } from 'drizzle-orm';
import { logger } from '../logger.js';
import { defendField, CUSTOM_INSTRUCTIONS_LIMIT } from './prompt-defense.js';
import type { Uuid } from '@shared/domain.js';

interface ProfileRow {
  displayName: string | null;
  profileMarkdown: string | null;
  timezone: string | null;
  locale: string | null;
}

async function loadProfile(userId: Uuid): Promise<ProfileRow | null> {
  const rows = await db
    .select({
      displayName: jchatUserProfile.displayName,
      profileMarkdown: jchatUserProfile.profileMarkdown,
      timezone: jchatUserProfile.timezone,
      locale: jchatUserProfile.locale,
    })
    .from(jchatUserProfile)
    .where(eq(jchatUserProfile.userId, userId))
    .limit(1)
    .catch((err) => {
      logger.warn({ err, userId }, 'loadProfile failed');
      return [];
    });

  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

async function loadAuthMeta(userId: Uuid): Promise<{ email?: string; fullName?: string }> {
  try {
  // Try local_users first (new auth system), fall back to users table (linkedin).
  const localRows = await db
    .select({
      username: localUsers.username,
      displayName: localUsers.displayName,
    })
    .from(localUsers)
    .where(eq(localUsers.id, userId))
    .limit(1);

  if (localRows.length > 0) {
    return {
      email: localRows[0].username,
      fullName: localRows[0].displayName ?? undefined
    };
  }

  // Fallback: try the old `users` table (LinkedIn users)
  const userRows = await db
    .select({
      email: users.email,
      fullName: users.fullName,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (userRows.length > 0) {
    return {
      email: userRows[0].email ?? undefined,
      fullName: userRows[0].fullName ?? undefined
    };
  }

  return {};
  } catch (err) {
    logger.warn({ err, userId }, 'loadAuthMeta failed');
    return {};
  }
}

function emailLocal(email: string | undefined): string {
  if (!email) return '';
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

export interface UserSectionData {
  timezone: string | null;
  locale: string | null;
}

/**
 * Render the USER section AND return the timezone/locale so DATETIME can reuse them.
 */
export async function renderUserSection(userId: Uuid): Promise<{ section: string; meta: UserSectionData }> {
  const [profile, auth] = await Promise.all([loadProfile(userId), loadAuthMeta(userId)]);
  const displayName = profile?.displayName?.trim()
    || auth.fullName
    || emailLocal(auth.email)
    || 'unknown';
  const timezone = profile?.timezone ?? null;
  const locale = profile?.locale ?? null;

  // Defense-in-depth: run displayName through defendField even though auth
  // metadata is not normally user-controllable — a compromised auth flow or
  // malicious Supabase admin could still inject content via display_name.
  const safeName = defendField(displayName, 'display_name', 200) || displayName;

  const lines = ['# 用户信息', '', `当前用户：${safeName}`];
  if (locale) lines.push(`首选语言：${locale}`);
  if (timezone) lines.push(`所在时区：${timezone}`);

  if (profile?.profileMarkdown) {
    const safe = defendField(profile.profileMarkdown, 'profile_markdown', CUSTOM_INSTRUCTIONS_LIMIT);
    if (safe) {
      lines.push('', '## 用户画像', safe);
    }
  }

  return { section: lines.join('\n'), meta: { timezone, locale } };
}
