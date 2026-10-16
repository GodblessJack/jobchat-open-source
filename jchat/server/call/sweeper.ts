import { db } from '../lib/db.js';
import { jchatMeetingSessions, jchatConversations } from '../sql/schema/index.js';
import { eq, lt, inArray, and } from 'drizzle-orm';
import { logger } from '../logger.js';
import { slack } from '../lib/slack-notify.js';

const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;     // 2 hours
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;          // every 5 min

/**
 * Mark any 'ongoing' meeting session that started more than `timeoutMs` ago
 * as 'error'. Returns the number of rows swept.
 */
export async function sweepStuckSessions(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<number> {
  const cutoff = new Date(Date.now() - timeoutMs);
  const rows = await db
    .select({ id: jchatMeetingSessions.id })
    .from(jchatMeetingSessions)
    .where(and(
      eq(jchatMeetingSessions.status, 'ongoing'),
      lt(jchatMeetingSessions.startedAt, cutoff)
    ));

  if (rows.length === 0) return 0;
  const ids = rows.map(r => r.id);

  // Guard with status='ongoing' to avoid overwriting a session that was
  // completed by sendBeacon between the SELECT above and this UPDATE.
  await db
    .update(jchatMeetingSessions)
    .set({ status: 'error', endedAt: new Date() })
    .where(and(
      inArray(jchatMeetingSessions.id, ids),
      eq(jchatMeetingSessions.status, 'ongoing')
    ));

  // Clear active_session on affected conversations (best-effort).
  const convRows = await db
    .select({ conversationId: jchatMeetingSessions.conversationId })
    .from(jchatMeetingSessions)
    .where(inArray(jchatMeetingSessions.id, ids))
    .catch(() => []);
  const convIds = (convRows as any[])?.map(r => r.conversationId).filter(Boolean) || [];
  if (convIds.length > 0) {
    await db.update(jchatConversations)
      .set({ activeSession: null } as any)
      .where(inArray(jchatConversations.id, convIds as any))
      .catch(() => { /* best-effort */ });
  }

  logger.info({ swept: ids.length }, 'call.sweeper');
  slack.warn(
    'Meeting sweeper: stuck sessions detected',
    `${ids.length} ongoing meeting session(s) older than 2h marked as error. SendBeacon likely failed on tab close.`,
    { swept: String(ids.length), 'session IDs': ids.join(', ') }
  );
  return ids.length;
}

export function startSweeper(intervalMs = DEFAULT_INTERVAL_MS): () => void {
  const t = setInterval(() => {
    sweepStuckSessions().catch(err => {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'call.sweeper tick failed');
    });
  }, intervalMs);
  // unref so it doesn't keep the process alive in tests
  t.unref?.();
  return () => clearInterval(t);
}
