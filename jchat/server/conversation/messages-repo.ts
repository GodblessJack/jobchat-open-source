// jchat/server/conversation/messages-repo.ts
//
// CRUD over `jchat_messages`. Service-role; ownership is verified upstream
// by conversation-repo / ws-router.

import type {
  MessageAttachmentRef,
  MessageDeliveryStatus,
  MessageSenderType,
  MessageSummary,
  ToolCallRecord,
  Uuid
} from '@shared/domain.js';
import { ErrorCodes, JchatError } from '@shared/errors.js';
import { db } from '../lib/db.js';
import { jchatMessages, jchatConversations } from '../sql/schema/index.js';
import { eq, and, isNull, lt, desc, sql } from 'drizzle-orm';
import { logger } from '../logger.js';

interface MsgRow {
  id: string;
  conversationId: string;
  senderType: MessageSenderType;
  senderId: string;
  content: string | null;
  mentions: string[] | null;
  toolCalls: ToolCallRecord[] | null;
  attachments: MessageAttachmentRef[] | null;
  parentId: string | null;
  sdkSessionId: string | null;
  deliveryStatus: MessageDeliveryStatus;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  metadata?: Record<string, unknown> | null;
}

function rowToMessage(row: MsgRow): MessageSummary {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderType: row.senderType,
    senderId: row.senderId,
    content: row.content,
    mentions: row.mentions ?? undefined,
    // toolCalls intentionally excluded from client-facing MessageSummary.
    // Full ToolCallRecord contains args + result payloads (SQL queries,
    // file paths, URLs, etc.) that must never leak to the browser.
    attachments: row.attachments ?? undefined,
    parentId: row.parentId,
    sdkSessionId: row.sdkSessionId,
    deliveryStatus: row.deliveryStatus,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    metadata: row.metadata ?? undefined
  };
}

export interface AppendMessageInput {
  conversationId: Uuid;
  senderType: MessageSenderType;
  senderId: Uuid;
  content?: string | null;
  mentions?: Uuid[];
  toolCalls?: ToolCallRecord[];
  attachments?: MessageAttachmentRef[];
  parentId?: Uuid | null;
  sdkSessionId?: Uuid | null;
  deliveryStatus?: MessageDeliveryStatus;
}

/**
 * Insert a new message row. Returns the persisted MessageSummary.
 * Default deliveryStatus is 'final' (callers writing partial agent
 * messages must pass 'partial' explicitly).
 */
export async function appendMessage(input: AppendMessageInput): Promise<MessageSummary> {
  const rows = await db
    .insert(jchatMessages)
    .values({
      conversationId: input.conversationId,
      senderType: input.senderType,
      senderId: input.senderId,
      content: input.content ?? null,
      mentions: input.mentions && input.mentions.length > 0 ? input.mentions : null,
      toolCalls: input.toolCalls ?? null,
      attachments: input.attachments ?? null,
      parentId: input.parentId ?? null,
      sdkSessionId: input.sdkSessionId ?? null,
      deliveryStatus: input.deliveryStatus ?? 'final',
    })
    .returning({
      id: jchatMessages.id,
      conversationId: jchatMessages.conversationId,
      senderType: jchatMessages.senderType,
      senderId: jchatMessages.senderId,
      content: jchatMessages.content,
      mentions: jchatMessages.mentions,
      toolCalls: jchatMessages.toolCalls,
      attachments: jchatMessages.attachments,
      parentId: jchatMessages.parentId,
      sdkSessionId: jchatMessages.sdkSessionId,
      deliveryStatus: jchatMessages.deliveryStatus,
      createdAt: jchatMessages.createdAt,
      editedAt: jchatMessages.editedAt,
      deletedAt: jchatMessages.deletedAt,
      metadata: jchatMessages.metadata,
    });

  if (rows.length === 0) {
    logger.error({ input }, 'appendMessage failed');
    throw new JchatError(ErrorCodes.INTERNAL_ERROR, 'appendMessage failed');
  }

  // Touch conversation.updated_at so list ordering is fresh.
  await db
    .update(jchatConversations)
    .set({ updatedAt: new Date() })
    .where(eq(jchatConversations.id, input.conversationId));

  return rowToMessage(rows[0] as unknown as MsgRow);
}

export async function updateMessageStatus(
  messageId: Uuid,
  status: MessageDeliveryStatus
): Promise<void> {
  await db
    .update(jchatMessages)
    .set({ deliveryStatus: status })
    .where(eq(jchatMessages.id, messageId));
}

export async function updateMessageContent(
  messageId: Uuid,
  content: string,
  opts: { toolCalls?: ToolCallRecord[]; attachments?: MessageAttachmentRef[]; deliveryStatus?: MessageDeliveryStatus } = {}
): Promise<void> {
  const updateData: Record<string, unknown> = { content };
  if (opts.toolCalls) updateData.toolCalls = opts.toolCalls;
  if (opts.attachments) updateData.attachments = opts.attachments;
  if (opts.deliveryStatus) updateData.deliveryStatus = opts.deliveryStatus;
  await db
    .update(jchatMessages)
    .set(updateData as any)
    .where(eq(jchatMessages.id, messageId));
}

export async function appendToolCall(
  messageId: Uuid,
  toolCall: ToolCallRecord
): Promise<void> {
  // Read-modify-write: jsonb append. Acceptable while one worker owns one
  // message (per-message single writer invariant); upgrade to RPC append
  // if we ever multi-writer the same row.
  const rows = await db
    .select({ toolCalls: jchatMessages.toolCalls })
    .from(jchatMessages)
    .where(eq(jchatMessages.id, messageId))
    .limit(1)
    .catch((err) => {
      logger.error({ err, messageId }, 'appendToolCall read failed');
      throw err;
    });

  if (!Array.isArray(rows)) return;
  if (rows.length === 0) throw new JchatError(ErrorCodes.NOT_FOUND, `message not found: ${messageId}`);
  const existing = (rows[0]?.toolCalls ?? []) as ToolCallRecord[];

  // Replace by id when status=result/error follows up an earlier start.
  const idx = existing.findIndex((t) => t.id === toolCall.id);
  if (idx >= 0) existing[idx] = { ...existing[idx], ...toolCall };
  else existing.push(toolCall);

  await db
    .update(jchatMessages)
    .set({ toolCalls: existing })
    .where(eq(jchatMessages.id, messageId))
    .catch((err) => {
      logger.error({ err, messageId }, 'appendToolCall write failed');
      throw err;
    });
}

export interface LoadHistoryOpts {
  beforeMessageId?: Uuid | null;
  limit?: number;
}

/**
 * Load conversation history in REVERSE chronological order, then return in
 * forward order (oldest-first). If `beforeMessageId` is given, only rows
 * strictly older than that message are returned (paging up).
 */
export async function loadHistory(
  conversationId: Uuid,
  opts: LoadHistoryOpts = {}
): Promise<MessageSummary[]> {
  const limit = Math.min(opts.limit ?? 50, 200);

  let beforeTs: Date | null = null;
  if (opts.beforeMessageId) {
    const rows = await db
      .select({ createdAt: jchatMessages.createdAt })
      .from(jchatMessages)
      .where(eq(jchatMessages.id, opts.beforeMessageId))
      .limit(1)
      .catch((err) => {
        logger.error({ err, conversationId }, 'loadHistory anchor lookup failed');
        return [];
      });
    if (Array.isArray(rows) && rows.length > 0) {
      beforeTs = rows[0].createdAt;
    }
  }

  const conditions = [
    eq(jchatMessages.conversationId, conversationId),
    isNull(jchatMessages.deletedAt),
  ];
  if (beforeTs) {
    conditions.push(lt(jchatMessages.createdAt, beforeTs));
  }

  const rows = await db
    .select({
      id: jchatMessages.id,
      conversationId: jchatMessages.conversationId,
      senderType: jchatMessages.senderType,
      senderId: jchatMessages.senderId,
      content: jchatMessages.content,
      mentions: jchatMessages.mentions,
      toolCalls: jchatMessages.toolCalls,
      attachments: jchatMessages.attachments,
      parentId: jchatMessages.parentId,
      sdkSessionId: jchatMessages.sdkSessionId,
      deliveryStatus: jchatMessages.deliveryStatus,
      createdAt: jchatMessages.createdAt,
      editedAt: jchatMessages.editedAt,
      deletedAt: jchatMessages.deletedAt,
      metadata: jchatMessages.metadata,
    })
    .from(jchatMessages)
    .where(and(...conditions))
    .orderBy(desc(jchatMessages.createdAt))
    .limit(limit)
    .catch((err) => {
      logger.error({ err, conversationId }, 'loadHistory failed');
      return [];
    });

  if (!Array.isArray(rows)) return [];
  return (rows as unknown as MsgRow[]).map(rowToMessage).reverse();
}

export async function softDeleteMessage(
  userId: Uuid,
  messageId: Uuid
): Promise<void> {
  // Verify ownership via conversation join.
  const rows = await db
    .select({
      id: jchatMessages.id,
      conversationId: jchatMessages.conversationId,
      ownerUserId: jchatConversations.userId,
    })
    .from(jchatMessages)
    .innerJoin(jchatConversations, eq(jchatMessages.conversationId, jchatConversations.id))
    .where(and(eq(jchatMessages.id, messageId), isNull(jchatMessages.deletedAt)))
    .limit(1);

  if (rows.length === 0) {
    throw new JchatError(ErrorCodes.VALIDATION_ERROR, 'message not found');
  }
  if (rows[0].ownerUserId !== userId) {
    throw new JchatError(ErrorCodes.AUTH_FORBIDDEN, 'message not owned');
  }

  await db
    .update(jchatMessages)
    .set({ deletedAt: new Date() })
    .where(eq(jchatMessages.id, messageId));

  // Touch conversation updated_at so deleted messages update sidebar ordering.
  if (rows[0].conversationId) {
    await db.update(jchatConversations)
      .set({ updatedAt: new Date() })
      .where(eq(jchatConversations.id, rows[0].conversationId))
      .catch(() => { /* best-effort */ });
  }
}

export async function editMessage(
  userId: Uuid,
  messageId: Uuid,
  content: string
): Promise<void> {
  const rows = await db
    .select({
      id: jchatMessages.id,
      conversationId: jchatMessages.conversationId,
      senderType: jchatMessages.senderType,
      senderId: jchatMessages.senderId,
      ownerUserId: jchatConversations.userId,
    })
    .from(jchatMessages)
    .innerJoin(jchatConversations, eq(jchatMessages.conversationId, jchatConversations.id))
    .where(and(eq(jchatMessages.id, messageId), isNull(jchatMessages.deletedAt)))
    .limit(1);

  if (rows.length === 0) throw new JchatError(ErrorCodes.VALIDATION_ERROR, 'message not found');
  if (rows[0].ownerUserId !== userId) throw new JchatError(ErrorCodes.AUTH_FORBIDDEN, 'message not owned');
  if (rows[0].senderType !== 'user' || rows[0].senderId !== userId) {
    throw new JchatError(ErrorCodes.AUTH_FORBIDDEN, 'only user-authored messages can be edited');
  }

  await db
    .update(jchatMessages)
    .set({ content, editedAt: new Date() })
    .where(eq(jchatMessages.id, messageId));

  // Touch conversation updated_at so edited messages surface in sidebar sort.
  if (rows[0].conversationId) {
    await db.update(jchatConversations)
      .set({ updatedAt: new Date() })
      .where(eq(jchatConversations.id, rows[0].conversationId))
      .catch(() => { /* best-effort */ });
  }
}

export interface SearchHit {
  messageId: Uuid;
  conversationId: Uuid;
  snippet: string;
  ts: number;
}

/**
 * FTS over the user's own messages. Uses Postgres tsquery for full-text search.
 */
export async function searchMessages(
  userId: Uuid,
  query: string,
  limit = 20
): Promise<SearchHit[]> {
  // Use raw SQL for pg text search — Drizzle doesn't have built-in textSearch.
  const result = await db.execute(sql`
    SELECT m.id, m.conversation_id, m.content, m.created_at
    FROM jchat_messages m
    INNER JOIN jchat_conversations c ON m.conversation_id = c.id
    WHERE c.user_id = ${userId}
      AND m.deleted_at IS NULL
      AND m.content_tsv @@ websearch_to_tsquery('simple', ${query})
    LIMIT ${limit}
  `);

  const rows = result.rows as Array<{ id: string; conversation_id: string; content: string | null; created_at: string }>;
  return rows.map((r) => ({
    messageId: r.id,
    conversationId: r.conversation_id,
    snippet: (r.content ?? '').slice(0, 240),
    ts: new Date(r.created_at).getTime()
  }));
}

/**
 * Get a single message by id. Returns null if not found.
 */
export async function getMessage(messageId: Uuid): Promise<MessageSummary | null> {
  const rows = await db
    .select({
      id: jchatMessages.id,
      conversationId: jchatMessages.conversationId,
      senderType: jchatMessages.senderType,
      senderId: jchatMessages.senderId,
      content: jchatMessages.content,
      mentions: jchatMessages.mentions,
      toolCalls: jchatMessages.toolCalls,
      attachments: jchatMessages.attachments,
      parentId: jchatMessages.parentId,
      sdkSessionId: jchatMessages.sdkSessionId,
      deliveryStatus: jchatMessages.deliveryStatus,
      createdAt: jchatMessages.createdAt,
      editedAt: jchatMessages.editedAt,
      deletedAt: jchatMessages.deletedAt,
      metadata: jchatMessages.metadata,
    })
    .from(jchatMessages)
    .where(eq(jchatMessages.id, messageId))
    .limit(1);

  if (rows.length === 0) return null;
  return rowToMessage(rows[0] as unknown as MsgRow);
}
