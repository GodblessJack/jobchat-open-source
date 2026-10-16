// jchat/server/services/create-contact.ts
//
// Orchestrates the full flow of persisting a distilled persona as a
// private contact:
//   1. Atomic stored-function call (quota++ + slug conflict + 3-table INSERT)
//   2. Best-effort avatar download → local filesystem
//   3. Optional contacts-snapshot broadcast for UI refresh
//
// Errors raised by the stored function (P0001) propagate up; the MCP layer
// (create-contact-mcp.ts) maps them to friendly user-facing strings.
//
// Spec: §4.2.3, §4.3, §7

import { db } from '../lib/db.js';
import { agents } from '../sql/schema/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { logger } from '../logger.js';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

export interface CreateContactInput {
  name: string;
  slug: string;
  skill_md: string;
  persona_summary: string;
  initial_message: string;
  source_type: 'x_profile' | 'x_tweet';
  source_url: string;
  x_handle: string;
  avatar_hint_url?: string;
  bio?: string;
}

export interface CreateContactResult {
  agent_id: string;
  slug_resolved: string;
  avatar_url: string | null;
  name: string;
}

export async function createContact(
  userId: string,
  input: CreateContactInput,
  broadcast?: (userId: string, topic: string) => void
): Promise<CreateContactResult> {
  // 1. Stored function: atomic quota + slug + 3-table INSERT.
  let data: unknown;
  try {
    const result = await db.execute(sql`
      SELECT * FROM create_distilled_contact(
        p_user_id => ${userId},
        p_name => ${input.name},
        p_base_slug => ${input.slug},
        p_skill_md => ${input.skill_md},
        p_persona_summary => ${input.persona_summary},
        p_initial_message => ${input.initial_message},
        p_source_type => ${input.source_type},
        p_source_url => ${input.source_url},
        p_x_handle => ${input.x_handle},
        p_bio => ${input.bio ?? null},
        p_avatar_url => ${null}
      )
    `);
    data = result.rows;
  } catch (err) {
    // PG raise_exception comes back as an error object.
    const wrapped = new Error((err as Error).message) as Error & { code?: string };
    wrapped.code = (err as any).code ?? 'P0001';
    throw wrapped;
  }

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('create_distilled_contact returned empty result');
  }
  const row = data[0] as { agent_id: string; slug_resolved: string };
  const { agent_id, slug_resolved } = row;

  // 2. Avatar download (best-effort — failure does NOT roll back contact).
  let avatarUrl: string | null = null;
  if (input.avatar_hint_url) {
    avatarUrl = await uploadAvatar(userId, slug_resolved, input.avatar_hint_url);
    if (avatarUrl) {
      await db
        .update(agents)
        .set({ avatarUrl })
        .where(and(
          eq(agents.id, agent_id),
          eq(agents.ownerUserId, userId)
        ))
        .catch((updateErr) => {
          logger.warn(
            { agent_id, err: (updateErr as Error).message },
            'avatar URL update failed; contact remains without avatar'
          );
        });
    }
  }

  // 3. Broadcast contacts-snapshot change (best-effort).
  if (broadcast) {
    try {
      broadcast(userId, 'contacts');
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'contacts broadcast failed');
    }
  }

  return { agent_id, slug_resolved, avatar_url: avatarUrl, name: input.name };
}

async function uploadAvatar(
  userId: string,
  slug: string,
  hintUrl: string
): Promise<string | null> {
  // Bounded fetch — twitter/cdn occasionally hangs on dead URLs and the
  // MCP layer's 60s tool timeout would otherwise be our only backstop.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const resp = await fetch(hintUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; jchat-distill/1.0)' },
      signal: controller.signal
    });
    if (!resp.ok) {
      logger.warn({ hintUrl, status: resp.status }, 'avatar fetch non-200');
      return null;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    const avatarFilename = `${slug}.jpg`;
    const avatarDir = path.join(config.filesRoot, 'avatars', userId);
    await mkdir(avatarDir, { recursive: true });
    await writeFile(path.join(avatarDir, avatarFilename), buf);
    // Return a permanent /files/ path (served via express.static).
    // Signed URLs are no longer needed since files are served directly.
    return `/files/avatars/${userId}/${avatarFilename}`;
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'avatar pipeline threw');
    return null;
  } finally {
    clearTimeout(timer);
  }
}
