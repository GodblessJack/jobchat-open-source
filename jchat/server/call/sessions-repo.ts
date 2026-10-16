// jchat/server/call/sessions-repo.ts
//
// CRUD over `jchat_meeting_sessions`. Service-role queries via Drizzle.
// Ownership checks are enforced upstream by call-routes.

import { db } from '../lib/db.js';
import { jchatMeetingSessions, jchatConversations } from '../sql/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { JchatError } from '@shared/errors.js';
import type { Uuid } from '@shared/domain.js';

export interface MeetingSessionRow {
  id: Uuid;
  userId: Uuid;
  agentId: Uuid;
  conversationId: Uuid;
  status: 'ongoing' | 'completed' | 'error';
  startedAt: string;
  endedAt: string | null;
}

export async function createSession(input: {
  userId: Uuid; agentId: Uuid; conversationId: Uuid;
}): Promise<{ sessionId: Uuid }> {
  const rows = await db
    .insert(jchatMeetingSessions)
    .values({
      userId: input.userId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      status: 'ongoing'
    })
    .returning({ id: jchatMeetingSessions.id });
  const row = rows[0];
  if (!row) {
    throw new JchatError('INTERNAL_ERROR', 'createSession failed: no data');
  }
  // Link the conversation to this active session so the frontend can show
  // "call in progress" and the sweeper can find stale sessions.
  await db.update(jchatConversations)
    .set({ activeSession: row.id })
    .where(eq(jchatConversations.id, input.conversationId))
    .catch(() => { /* best-effort */ });
  return { sessionId: row.id };
}

export async function getSession(sessionId: Uuid): Promise<MeetingSessionRow | null> {
  const rows = await db
    .select({
      id: jchatMeetingSessions.id,
      userId: jchatMeetingSessions.userId,
      agentId: jchatMeetingSessions.agentId,
      conversationId: jchatMeetingSessions.conversationId,
      status: jchatMeetingSessions.status,
      startedAt: jchatMeetingSessions.startedAt,
      endedAt: jchatMeetingSessions.endedAt,
    })
    .from(jchatMeetingSessions)
    .where(eq(jchatMeetingSessions.id, sessionId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    agentId: row.agentId,
    conversationId: row.conversationId,
    status: row.status as 'ongoing' | 'completed' | 'error',
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

export async function endSession(sessionId: Uuid, status: 'completed' | 'error'): Promise<void> {
  // Only update if still ongoing — prevents the sweeper (or a duplicate
  // sendBeacon) from overwriting a completed/error status with a stale one.
  const rows = await db
    .update(jchatMeetingSessions)
    .set({ status, endedAt: new Date() })
    .where(and(
      eq(jchatMeetingSessions.id, sessionId),
      eq(jchatMeetingSessions.status, 'ongoing')
    ))
    .returning({ id: jchatMeetingSessions.id });
  // Idempotent: if the session is no longer ongoing (e.g. already swept by
  // the cron sweeper, or ended by a concurrent sendBeacon), treat it as
  // success — the caller's goal (session is in a terminal state) is met.
  if (rows.length === 0) {
    return;
  }
  // Clear the conversation's active_session link so the frontend stops
  // showing "call in progress". Best-effort — the sweeper also cleans up.
  const s = await db
    .select({ cid: jchatMeetingSessions.conversationId })
    .from(jchatMeetingSessions)
    .where(eq(jchatMeetingSessions.id, sessionId))
    .limit(1)
    .catch(() => null);
  if (s && Array.isArray(s) && s.length > 0 && (s[0] as any)?.cid) {
    await db.update(jchatConversations)
      .set({ activeSession: null } as any)
      .where(eq(jchatConversations.id, (s[0] as any).cid as string))
      .catch(() => { /* best-effort */ });
  }
}
