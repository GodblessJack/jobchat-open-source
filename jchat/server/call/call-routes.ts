// jchat/server/call/call-routes.ts
import type { Express, Request, Response } from 'express';
import { db } from '../lib/db.js';
import { jchatConversations, jchatConversationMembers, agents, jchatMessages } from '../sql/schema/index.js';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { verifyJchatJwt } from '../auth/jwt-verify.js';
import { logger } from '../logger.js';
import { JchatError } from '@shared/errors.js';
import { createSession, getSession, endSession } from './sessions-repo.js';
import type { MeetingSessionRow } from './sessions-repo.js';
import { buildSystemInstruction } from './persona-builder.js';
import { extractMemoryAsync } from '../conversation/group-dispatch.js';
import { renderIdentity } from '../agent/identity-renderer.js';
import type { AgentIdentity } from '@shared/domain.js';
import type {
  CallStartRequest,
  CallStartResponse,
  CallPersonaResponse,
  CallTranscribeRequest,
  CallTranscribeResponse,
  CallEndRequest
} from '@shared/call-types.js';

export interface CallRouteDeps {
  /**
   * Notify subscribers of `conversation:<id>` topic that messages changed.
   * Wired in server/index.ts as `(topic) => router.broadcastTopicChanged(topic)`.
   * Failures are tolerated (best-effort).
   */
  broadcastConvSnapshot: (topic: string) => Promise<void> | void;
}

type ResolveResult =
  | { ok: true; conversationId: string; userId: string; agentId: string }
  | { ok: false; status: 403 | 404; reason: string };

export async function resolveDmOwner(conversationId: string, callerId: string): Promise<ResolveResult> {
  const convRows = await db
    .select({ id: jchatConversations.id, userId: jchatConversations.userId, type: jchatConversations.type })
    .from(jchatConversations)
    .where(eq(jchatConversations.id, conversationId))
    .limit(1);

  if (convRows.length === 0) return { ok: false, status: 404, reason: 'conversation not found' };
  if (convRows[0].userId !== callerId) return { ok: false, status: 403, reason: 'not conversation owner' };
  if (convRows[0].type !== 'dm') return { ok: false, status: 403, reason: 'video calls only supported in DM' };

  const memberRows = await db
    .select({ agentId: jchatConversationMembers.agentId })
    .from(jchatConversationMembers)
    .where(eq(jchatConversationMembers.conversationId, conversationId))
    .limit(1);

  if (memberRows.length === 0) {
    return { ok: false, status: 404, reason: 'conversation has no agent member' };
  }
  return { ok: true, conversationId, userId: callerId, agentId: memberRows[0].agentId };
}

async function authorize(req: Request): Promise<string> {
  const h = req.header('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const user = await verifyJchatJwt(token);  // throws JchatError('AUTH_INVALID')
  return user.id;
}

function handleAuthError(res: Response, err: unknown): Response {
  if (err instanceof JchatError && err.code === 'AUTH_INVALID') return res.status(401).end();
  logger.error({ err }, 'call route auth error');
  return res.status(500).end();
}

export function mountCallRoutes(app: Express, deps: CallRouteDeps): void {
  // POST /api/call/start
  app.post('/api/call/start', async (req: Request, res: Response) => {
    let userId: string;
    try { userId = await authorize(req); } catch (err) { return handleAuthError(res, err); }

    const body = (req.body ?? {}) as CallStartRequest;
    if (!body.conversationId || typeof body.conversationId !== 'string') {
      return res.status(400).end();
    }

    try {
      const r = await resolveDmOwner(body.conversationId, userId);
      if (!r.ok) return res.status(r.status).end();
      const { sessionId } = await createSession({
        userId: r.userId,
        agentId: r.agentId,
        conversationId: r.conversationId
      });
      logger.info({ sessionId, userId, agentId: r.agentId, conversationId: r.conversationId }, 'call.start');
      const out: CallStartResponse = { sessionId };
      return res.status(200).json(out);
    } catch (err) {
      logger.error({ err }, 'call.start failed');
      return res.status(500).end();
    }
  });

  // GET /api/call/persona?conversationId=...
  app.get('/api/call/persona', async (req: Request, res: Response) => {
    let userId: string;
    try { userId = await authorize(req); } catch (err) { return handleAuthError(res, err); }

    const conversationId = String(req.query.conversationId ?? '');
    if (!conversationId) return res.status(400).end();

    try {
      const r = await resolveDmOwner(conversationId, userId);
      if (!r.ok) return res.status(r.status).end();

      // load agent
      const agentRows = await db
        .select({
          id: agents.id,
          name: agents.name,
          role: agents.role,
          avatarUrl: agents.avatarUrl,
          identity: agents.identity,
          bootstrapMd: agents.bootstrapMd,
          personaDescription: agents.personaDescription,
        })
        .from(agents)
        .where(eq(agents.id, r.agentId))
        .limit(1);
      if (agentRows.length === 0) return res.status(404).end();

      const a = agentRows[0];

      // load history (latest 30, oldest first when consumed)
      const msgRows = await db
        .select({
          senderType: jchatMessages.senderType,
          content: jchatMessages.content,
          createdAt: jchatMessages.createdAt,
        })
        .from(jchatMessages)
        .where(and(
          eq(jchatMessages.conversationId, conversationId),
          isNull(jchatMessages.deletedAt)
        ))
        .orderBy(desc(jchatMessages.createdAt))
        .limit(30);

      const historyChrono = msgRows
        .slice()
        .reverse()
        .filter(row => row.content && (row.senderType === 'user' || row.senderType === 'agent'))
        .map(row => ({ sender: row.senderType as 'user' | 'agent', text: row.content as string }));

      // identity is JSONB — Drizzle returns a parsed object, never a string.
      // Use renderIdentity to produce the same formatted identity string that
      // the text-chat persona builder uses.
      const identityStr = renderIdentity(a.name ?? '', a.identity as AgentIdentity | null);
      const systemInstruction = buildSystemInstruction({
        agent: {
          name: a.name ?? '',
          identity: identityStr,
          bootstrapMd: a.bootstrapMd ?? '',
          personaDescription: a.personaDescription ?? null
        },
        history: historyChrono
      });

      logger.info({ conversationId, historyCount: historyChrono.length, instructionLength: systemInstruction.length }, 'call.persona');

      const out: CallPersonaResponse = {
        session: {
          conversationId,
          agentId: a.id,
          agentName: a.name ?? '',
          agentAvatarUrl: a.avatarUrl ?? null,
          agentRole: a.role ?? null,
          agentDescription: a.personaDescription ?? null
        },
        systemInstruction
      };
      return res.status(200).json(out);
    } catch (err) {
      logger.error({ err }, 'call.persona failed');
      return res.status(500).end();
    }
  });

  // POST /api/call/transcribe
  app.post('/api/call/transcribe', async (req: Request, res: Response) => {
    let userId: string;
    try { userId = await authorize(req); } catch (err) { return handleAuthError(res, err); }

    const body = (req.body ?? {}) as Partial<CallTranscribeRequest>;
    if (
      typeof body.sessionId !== 'string' ||
      typeof body.transcriptEntryId !== 'string' ||
      typeof body.text !== 'string' ||
      typeof body.timestamp !== 'number' || !isFinite(body.timestamp) ||
      (body.sender !== 'user' && body.sender !== 'gemini')
    ) {
      return res.status(400).end();
    }

    try {
      const session = await getSession(body.sessionId);
      if (!session) return res.status(404).end();
      if (session.userId !== userId) return res.status(403).end();
      if (session.status !== 'ongoing') return res.status(409).end();

      // Quick SELECT only for best-effort action classification — does NOT gate
      // the write.  The atomic upsert below eliminates the SELECT-then-INSERT
      // race that caused unique-constraint violations under burst load.
      const existingResult = await db.execute(sql`
        SELECT id FROM jchat_messages
        WHERE conversation_id = ${session.conversationId}
          AND metadata->>'source' = 'call'
          AND metadata->>'transcriptEntryId' = ${body.transcriptEntryId}
        LIMIT 1
      `);
      const hadPriorRow = (existingResult.rows[0] as any)?.id != null;

      const senderType = body.sender === 'user' ? 'user' : 'agent';
      const senderId   = body.sender === 'user' ? session.userId : session.agentId;
      const meta = JSON.stringify({
        source: 'call',
        callSessionId: session.id,
        transcriptEntryId: body.transcriptEntryId
      });

      // Atomic upsert — no race window between check and write.
      const upsertResult = await db.execute(sql`
        INSERT INTO jchat_messages (conversation_id, sender_type, sender_id, content, delivery_status, metadata, created_at)
        VALUES (${session.conversationId}, ${senderType}, ${senderId}, ${body.text}, 'final',
                ${meta}::jsonb, ${new Date(body.timestamp ?? Date.now())})
        ON CONFLICT (conversation_id, (metadata->>'transcriptEntryId')) WHERE (metadata->>'source' = 'call')
        DO UPDATE SET content = EXCLUDED.content
        RETURNING id
      `);

      const row = upsertResult.rows[0] as any;
      if (!row?.id) {
        logger.error({}, 'transcribe: upsert returned no id');
        return res.status(500).end();
      }
      const messageId: string = row.id;
      const action: 'insert' | 'update' = hadPriorRow ? 'update' : 'insert';

      // Best-effort snapshot fan-out.
      try {
        await deps.broadcastConvSnapshot(`conversation:${session.conversationId}`);
      } catch (err) {
        logger.warn({ err }, 'transcribe: broadcast failed (non-fatal)');
      }

      logger.info({ sessionId: session.id, sender: body.sender, textLength: body.text.length, action }, 'call.transcribe');

      const out: CallTranscribeResponse = { messageId, action };
      return res.status(200).json(out);
    } catch (err) {
      logger.error({ err }, 'call.transcribe failed');
      return res.status(500).end();
    }
  });

  // POST /api/call/end
  // Supports two auth paths:
  //  (a) Authorization: Bearer header (normal fetch)
  //  (b) body.jwt field (navigator.sendBeacon, which cannot set headers)
  app.post('/api/call/end', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as CallEndRequest;
    if (typeof body.sessionId !== 'string') return res.status(400).end();
    if (body.status !== 'completed' && body.status !== 'error') return res.status(400).end();

    let userId: string;
    try {
      const headerToken = (req.header('authorization') ?? '').startsWith('Bearer ')
        ? (req.header('authorization') as string).slice(7)
        : '';
      const token = headerToken || body.jwt || '';
      if (!token) throw new JchatError('AUTH_INVALID', 'no token');
      const u = await verifyJchatJwt(token);
      userId = u.id;
    } catch (err) {
      return handleAuthError(res, err);
    }

    try {
      const session = await getSession(body.sessionId);
      if (!session) return res.status(404).end();
      if (session.userId !== userId) return res.status(403).end();
      await endSession(session.id, body.status);
      logger.info({ sessionId: session.id, status: body.status, durationMs: Date.now() - new Date(session.startedAt).getTime() }, 'call.end');
      // Fire-and-forget: distill transcripts into agent_memory for future RAG.
      setImmediate(() => {
        void persistCallToMemory(session).catch((err) =>
          logger.warn({ err, sessionId: session.id }, 'call.distill failed')
        );
      });
      return res.status(204).end();
    } catch (err) {
      logger.error({ err }, 'call.end failed');
      return res.status(500).end();
    }
  });
}

/**
 * Distill the just-ended call into a single agent_memory chunk so future
 * conversations (text or voice) with this agent recall what was said.
 *
 * Fire-and-forget. Failures are logged WARN but never propagate to the
 * already-returned 204 response.
 */
async function persistCallToMemory(session: MeetingSessionRow): Promise<void> {
  // Query messages with metadata->>'callSessionId' matching this session.
  const result = await db.execute(sql`
    SELECT id, sender_type, content, created_at
    FROM jchat_messages
    WHERE conversation_id = ${session.conversationId}
      AND metadata->>'callSessionId' = ${session.id}
    ORDER BY created_at ASC
  `);

  const data = result.rows as Array<{ id: string; sender_type: string; content: string | null; created_at: string }>;

  if (!data || data.length === 0) {
    logger.info({ sessionId: session.id }, 'persistCallToMemory: no transcripts to distill');
    return;
  }

  const transcript = data
    .filter(row => row.content && (row.sender_type === 'user' || row.sender_type === 'agent'))
    .map(row => {
      const role = row.sender_type === 'user' ? '用户' : 'Agent';
      return `${role}: ${row.content}`;
    })
    .join('\n');

  if (!transcript.trim()) return;

  await extractMemoryAsync({
    userId: session.userId,
    agentId: session.agentId,
    conversationId: session.conversationId,
    agentMessageId: data[data.length - 1].id,
    text: transcript,
    importance: 0.6
  });

  logger.info(
    { sessionId: session.id, transcriptCount: data.length, transcriptChars: transcript.length },
    'call.distilled-to-memory'
  );
}
