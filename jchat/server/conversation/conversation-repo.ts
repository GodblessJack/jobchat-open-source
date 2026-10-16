// jchat/server/conversation/conversation-repo.ts
//
// CRUD over `jchat_conversations` and `jchat_conversation_members`.
//
// All ops use the service-role client; the JWT layer above is the trust
// boundary, so we always pass `user_id` / `userId` explicitly and verify
// ownership in code rather than relying on auth.uid() in RLS.

import type {
  ConversationMember,
  ConversationSummary,
  ConversationType,
  MessageSummary,
  Uuid
} from '@shared/domain.js';
import { ErrorCodes, JchatError } from '@shared/errors.js';
import { db } from '../lib/db.js';
import { jchatConversations, jchatConversationMembers, agents } from '../sql/schema/index.js';
import { eq, and, isNull, desc, asc, inArray, sql } from 'drizzle-orm';
import { logger } from '../logger.js';

interface ConvRow {
  id: string;
  userId: string;
  type: ConversationType;
  title: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MemberRow {
  conversationId: string;
  agentId: string;
  role: 'member' | 'moderator';
  joinedAt: string;
  position: number;
}

function rowToSummary(
  row: ConvRow,
  members: ConversationMember[],
  lastMessage?: MessageSummary
): ConversationSummary {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    title: row.title,
    archivedAt: row.archivedAt,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    members,
    ...(lastMessage ? { lastMessage } : {})
  };
}

/** Minimal message-row shape used by bulk last-message lookup. */
interface LastMsgRow {
  id: string;
  conversation_id: string;
  sender_type: 'user' | 'agent' | 'system';
  sender_id: string;
  content: string | null;
  attachments: unknown;
  delivery_status: string | null;
  created_at: string;
}

function lastMsgRowToSummary(r: LastMsgRow): MessageSummary {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    senderType: r.sender_type,
    senderId: r.sender_id,
    content: r.content ?? '',
    deliveryStatus: (r.delivery_status as MessageSummary['deliveryStatus']) ?? 'final',
    attachments: Array.isArray(r.attachments) ? (r.attachments as MessageSummary['attachments']) : undefined,
    createdAt: r.created_at
  };
}

function memberRowTo(m: MemberRow): ConversationMember {
  return {
    conversationId: m.conversationId,
    agentId: m.agentId,
    role: m.role,
    joinedAt: m.joinedAt,
    position: m.position
  };
}

function convRowFromDb(r: {
  id: string;
  userId: string;
  type: string;
  title: string | null;
  archivedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ConvRow {
  return {
    id: r.id,
    userId: r.userId,
    type: r.type as ConversationType,
    title: r.title,
    archivedAt: r.archivedAt?.toISOString() ?? null,
    deletedAt: r.deletedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Fetch members for a conversation. */
async function loadMembers(conversationId: Uuid): Promise<ConversationMember[]> {
  const rows = await db
    .select({
      conversationId: jchatConversationMembers.conversationId,
      agentId: jchatConversationMembers.agentId,
      role: jchatConversationMembers.role,
      joinedAt: jchatConversationMembers.joinedAt,
      position: jchatConversationMembers.position,
    })
    .from(jchatConversationMembers)
    .where(eq(jchatConversationMembers.conversationId, conversationId))
    .orderBy(asc(jchatConversationMembers.position))
    .catch((err) => {
      logger.error({ err, conversationId }, 'loadMembers failed');
      return [];
    });

  if (!Array.isArray(rows)) return [];
  return rows.map((r) => memberRowTo({
    conversationId: r.conversationId,
    agentId: r.agentId,
    role: r.role as 'member' | 'moderator',
    joinedAt: r.joinedAt.toISOString(),
    position: r.position,
  }));
}

export interface CreateConversationOpts {
  userId: Uuid;
  type: ConversationType;
  agentIds: Uuid[];
  title?: string | null;
}

export async function createConversation(
  opts: CreateConversationOpts
): Promise<ConversationSummary> {
  if (opts.type === 'dm' && opts.agentIds.length !== 1) {
    throw new JchatError(ErrorCodes.VALIDATION_ERROR, 'dm conversation requires exactly 1 agentId');
  }
  if (opts.type === 'group' && opts.agentIds.length < 1) {
    throw new JchatError(ErrorCodes.VALIDATION_ERROR, 'group conversation requires >= 1 agentId');
  }

  // Verify all agentIds exist before creating the conversation — prevents
  // phantom member rows that reference non-existent agents.
  const { agents: agentsTable } = await import('../sql/schema/index.js');
  const existingRows = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(inArray(agentsTable.id, opts.agentIds as any[]))
    .catch(() => []);
  const existingIds = new Set((existingRows as { id: string }[]).map(r => r.id));
  for (const aid of opts.agentIds) {
    if (!existingIds.has(aid)) {
      throw new JchatError(ErrorCodes.VALIDATION_ERROR, `agent not found: ${aid}`);
    }
  }

  // Visibility gate: user can only converse with shared agents or agents
  // they have a user_agents row for. Prevents accessing private agents
  // owned by other users.
  const { userAgents: uaTable } = await import('../sql/schema/index.js');
  const visibleRows = await db
    .select({ agentId: uaTable.agentId })
    .from(uaTable)
    .where(and(
      eq(uaTable.userId, opts.userId),
      inArray(uaTable.agentId, opts.agentIds as any[]),
      isNull(uaTable.deletedAt)
    ))
    .catch(() => []);
  const visibleIds = new Set((visibleRows as { agentId: string }[]).map(r => r.agentId));
  // Also allow shared agents (owner_user_id IS NULL)
  const sharedRows = await db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(and(
      inArray(agentsTable.id, opts.agentIds as any[]),
      isNull(agentsTable.ownerUserId)
    ))
    .catch(() => []);
  for (const row of (sharedRows as { id: string }[])) visibleIds.add(row.id);

  for (const aid of opts.agentIds) {
    if (!visibleIds.has(aid)) {
      throw new JchatError(ErrorCodes.AUTH_FORBIDDEN, `agent not visible: ${aid}`);
    }
  }

  // Wrap conversation + member inserts in a transaction so a member-insert
  // failure rolls back the conversation row — prevents orphan conversations
  // that appear in the sidebar with no members (P0 data-integrity bug).
  const row = await db.transaction(async (tx) => {
    const convRows = await tx
      .insert(jchatConversations)
      .values({
        userId: opts.userId,
        type: opts.type,
        title: opts.title ?? null,
      })
      .returning({
        id: jchatConversations.id,
        userId: jchatConversations.userId,
        type: jchatConversations.type,
        title: jchatConversations.title,
        archivedAt: jchatConversations.archivedAt,
        deletedAt: jchatConversations.deletedAt,
        createdAt: jchatConversations.createdAt,
        updatedAt: jchatConversations.updatedAt,
      });

    if (convRows.length === 0) {
      throw new JchatError(ErrorCodes.INTERNAL_ERROR, 'createConversation failed');
    }
    const convRow = convRowFromDb(convRows[0]);

    // `position: idx` preserves the user's pick order from the create-group
    // wizard, which becomes the round-table speaking order on the read path.
    if (opts.agentIds.length > 0) {
      const memberRows = opts.agentIds.map((agentId, idx) => ({
        conversationId: convRow.id,
        agentId,
        role: 'member' as const,
        position: idx,
      }));
      await tx.insert(jchatConversationMembers).values(memberRows);
    }
    return convRow;
  });

  const members = await loadMembers(row.id);
  return rowToSummary(row, members);
}

/**
 * Find an existing DM between this user and exactly the given agentId, or
 * create a fresh one. Used by `conversation.create` to deduplicate DMs so
 * the sidebar doesn't accumulate duplicates each time the user clicks
 * "DM <agent>" from the directory.
 *
 * Lookup criteria:
 *   - user_id = userId
 *   - type = 'dm'
 *   - deleted_at IS NULL (archived DMs are still considered a match —
 *     opening an archived DM should reuse it, not create a sibling)
 *   - exactly one member, and that member.agent_id = agentId
 *
 * If multiple matching DMs exist (legacy data from before this change),
 * we return the most recently updated one. Older duplicates remain in
 * the DB but stop accumulating.
 */
/**
 * Find an existing DM between `userId` and `agentId`. Returns the
 * ConversationSummary if found, or null. Extracted as a helper so
 * findOrCreateDm can double-check after acquiring the advisory lock.
 */
async function findExistingDm(
  userId: Uuid,
  agentId: Uuid
): Promise<ConversationSummary | null> {
  const convRows = await db
    .select({
      id: jchatConversations.id,
      userId: jchatConversations.userId,
      type: jchatConversations.type,
      title: jchatConversations.title,
      archivedAt: jchatConversations.archivedAt,
      deletedAt: jchatConversations.deletedAt,
      createdAt: jchatConversations.createdAt,
      updatedAt: jchatConversations.updatedAt,
    })
    .from(jchatConversations)
    .where(and(
      eq(jchatConversations.userId, userId),
      eq(jchatConversations.type, 'dm'),
      isNull(jchatConversations.deletedAt)
    ))
    .orderBy(desc(jchatConversations.updatedAt))
    .catch((err) => {
      logger.error({ err, userId, agentId }, 'findExistingDm select failed');
      return [];
    });

  if (!Array.isArray(convRows)) return null;
  const parsedRows = convRows.map(convRowFromDb);
  if (parsedRows.length === 0) return null;

  const candidateIds = parsedRows.map((r) => r.id);
  const memberRows = await db
    .select({
      conversationId: jchatConversationMembers.conversationId,
      agentId: jchatConversationMembers.agentId,
      role: jchatConversationMembers.role,
      joinedAt: jchatConversationMembers.joinedAt,
      position: jchatConversationMembers.position,
    })
    .from(jchatConversationMembers)
    .where(inArray(jchatConversationMembers.conversationId, candidateIds))
    .catch((err) => {
      logger.error({ err, userId, agentId }, 'findExistingDm members failed');
      return [];
    });

  if (!Array.isArray(memberRows)) return null;

  const byConv = new Map<string, ConversationMember[]>();
  for (const m of memberRows.map((r) => memberRowTo({
    conversationId: r.conversationId,
    agentId: r.agentId,
    role: r.role as 'member' | 'moderator',
    joinedAt: r.joinedAt.toISOString(),
    position: r.position,
  }))) {
    const arr = byConv.get(m.conversationId) ?? [];
    arr.push(m);
    byConv.set(m.conversationId, arr);
  }
  for (const arr of byConv.values()) arr.sort((a, b) => a.position - b.position);

  for (const row of parsedRows) {
    const members = byConv.get(row.id) ?? [];
    if (members.length === 1 && members[0].agentId === agentId) {
      return rowToSummary(row, members);
    }
  }
  return null;
}

/**
 * Find an existing DM between `userId` and `agentId`, or create one.
 *
 * Handles the TOCTOU race where two concurrent calls both pass the
 * SELECT-then-INSERT dedup check: on createConversation failure we
 * re-query for an existing DM (the other caller's row) and return it.
 * Retries up to 3 times before giving up.
 */
export async function findOrCreateDm(
  userId: Uuid,
  agentId: Uuid
): Promise<ConversationSummary> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await findExistingDm(userId, agentId);
    if (existing) return existing;

    try {
      return await createConversation({
        userId,
        type: 'dm',
        agentIds: [agentId]
      });
    } catch (err) {
      // Another caller may have created the DM between our findExistingDm
      // and createConversation. Re-check before retrying.
      const racedExisting = await findExistingDm(userId, agentId);
      if (racedExisting) return racedExisting;
      if (attempt === 2) throw err;
    }
  }
  // Should never reach here — the loop always returns or throws.
  throw new JchatError(ErrorCodes.INTERNAL_ERROR, 'findOrCreateDm exhausted retries');
}

export async function getConversation(
  userId: Uuid,
  conversationId: Uuid
): Promise<ConversationSummary | null> {
  const rows = await db
    .select({
      id: jchatConversations.id,
      userId: jchatConversations.userId,
      type: jchatConversations.type,
      title: jchatConversations.title,
      archivedAt: jchatConversations.archivedAt,
      deletedAt: jchatConversations.deletedAt,
      createdAt: jchatConversations.createdAt,
      updatedAt: jchatConversations.updatedAt,
    })
    .from(jchatConversations)
    .where(and(
      eq(jchatConversations.id, conversationId),
      isNull(jchatConversations.deletedAt)
    ))
    .limit(1)
    .catch((err) => {
      logger.error({ err, conversationId }, 'getConversation failed');
      return [];
    });

  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = convRowFromDb(rows[0]);
  if (row.userId !== userId) {
    throw new JchatError(ErrorCodes.AUTH_FORBIDDEN, 'conversation not owned by user');
  }
  const members = await loadMembers(row.id);
  return rowToSummary(row, members);
}

export async function listConversationsForUser(
  userId: Uuid,
  opts: { includeArchived?: boolean } = {}
): Promise<ConversationSummary[]> {
  const conditions = [
    eq(jchatConversations.userId, userId),
    isNull(jchatConversations.deletedAt),
  ];
  if (!opts.includeArchived) {
    conditions.push(isNull(jchatConversations.archivedAt));
  }

  const rows = await db
    .select({
      id: jchatConversations.id,
      userId: jchatConversations.userId,
      type: jchatConversations.type,
      title: jchatConversations.title,
      archivedAt: jchatConversations.archivedAt,
      deletedAt: jchatConversations.deletedAt,
      createdAt: jchatConversations.createdAt,
      updatedAt: jchatConversations.updatedAt,
    })
    .from(jchatConversations)
    .where(and(...conditions))
    .orderBy(desc(jchatConversations.updatedAt))
    .catch((err) => {
      logger.error({ err, userId }, 'listConversationsForUser failed');
      return [];
    });

  if (!Array.isArray(rows)) return [];
  if (rows.length === 0) return [];
  const parsedRows = rows.map(convRowFromDb);

  // Bulk-load members in one query.
  const ids = parsedRows.map((r) => r.id);
  const memberRows = await db
    .select({
      conversationId: jchatConversationMembers.conversationId,
      agentId: jchatConversationMembers.agentId,
      role: jchatConversationMembers.role,
      joinedAt: jchatConversationMembers.joinedAt,
      position: jchatConversationMembers.position,
    })
    .from(jchatConversationMembers)
    .where(inArray(jchatConversationMembers.conversationId, ids))
    .catch((err) => {
      logger.error({ err, userId }, 'listConversationsForUser members failed');
      return [];
    });

  const byConv = new Map<string, ConversationMember[]>();
  if (Array.isArray(memberRows)) {
    for (const m of memberRows.map((r) => memberRowTo({
      conversationId: r.conversationId,
      agentId: r.agentId,
      role: r.role as 'member' | 'moderator',
      joinedAt: r.joinedAt.toISOString(),
      position: r.position,
    }))) {
      const arr = byConv.get(m.conversationId) ?? [];
      arr.push(m);
      byConv.set(m.conversationId, arr);
    }
  }
  // Sort each conversation's member list by position.
  for (const arr of byConv.values()) arr.sort((a, b) => a.position - b.position);

  // Bulk-load the latest message per conversation.
  // Use ARRAY[...] with sql.join for proper PostgreSQL array parameterization.
  // (drizzle-orm sql template doesn't automatically convert JS arrays to PG arrays;
  //  passing a raw array to ANY(${ids}::uuid[]) produces "malformed array literal" on
  //  vanilla PostgreSQL.)
  let lastMsgResult: { rows: any[] } | null;
  if (ids.length === 0) {
    lastMsgResult = { rows: [] };
  } else {
    try {
      lastMsgResult = await db.execute(sql`
    SELECT m.id, m.conversation_id, m.sender_type, m.sender_id, m.content, m.attachments, m.delivery_status, m.created_at
    FROM jchat_messages m
    WHERE m.conversation_id = ANY(ARRAY[${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)}])
      AND m.deleted_at IS NULL
    ORDER BY m.created_at DESC
    LIMIT 200
  `) as any;
    } catch (err) {
      logger.warn({ err, userId }, 'listConversationsForUser last-message load failed (non-fatal)');
      lastMsgResult = null;
    }
  }

  const lastByConv = new Map<string, MessageSummary>();
  if (lastMsgResult?.rows) {
    for (const row of lastMsgResult.rows as unknown as LastMsgRow[]) {
      if (lastByConv.has(row.conversation_id)) continue; // first one wins (desc order)
      lastByConv.set(row.conversation_id, lastMsgRowToSummary(row));
    }
  }

  return parsedRows.map((r) => rowToSummary(r, byConv.get(r.id) ?? [], lastByConv.get(r.id)));
}

async function assertOwner(userId: Uuid, conversationId: Uuid): Promise<void> {
  const rows = await db
    .select({ userId: jchatConversations.userId })
    .from(jchatConversations)
    .where(eq(jchatConversations.id, conversationId))
    .limit(1);

  if (rows.length === 0) {
    throw new JchatError(ErrorCodes.VALIDATION_ERROR, 'conversation not found');
  }
  if (rows[0].userId !== userId) {
    throw new JchatError(ErrorCodes.AUTH_FORBIDDEN, 'conversation not owned by user');
  }
}

export async function renameConversation(
  userId: Uuid,
  conversationId: Uuid,
  title: string
): Promise<void> {
  await assertOwner(userId, conversationId);
  await db
    .update(jchatConversations)
    .set({ title, updatedAt: new Date() })
    .where(eq(jchatConversations.id, conversationId));
}

export async function archiveConversation(
  userId: Uuid,
  conversationId: Uuid
): Promise<void> {
  await assertOwner(userId, conversationId);
  await db
    .update(jchatConversations)
    .set({ archivedAt: new Date(), activeSession: null })
    .where(eq(jchatConversations.id, conversationId));
}

export async function deleteConversation(
  userId: Uuid,
  conversationId: Uuid
): Promise<void> {
  await assertOwner(userId, conversationId);
  await db
    .update(jchatConversations)
    .set({ deletedAt: new Date(), activeSession: null })
    .where(eq(jchatConversations.id, conversationId));
}

export async function addMember(
  userId: Uuid,
  conversationId: Uuid,
  agentId: Uuid
): Promise<void> {
  await assertOwner(userId, conversationId);
  // Verify the agent exists before adding (prevents dangling references).
  const agentRows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (agentRows.length === 0) {
    throw new JchatError(ErrorCodes.VALIDATION_ERROR, 'agent not found');
  }
  // DM conversations are fixed to 1 member — reject attempts to add more.
  const convRows = await db
    .select({ type: jchatConversations.type })
    .from(jchatConversations)
    .where(eq(jchatConversations.id, conversationId))
    .limit(1);
  if (convRows[0]?.type === 'dm') {
    throw new JchatError(ErrorCodes.VALIDATION_ERROR, 'cannot add members to a DM conversation');
  }
  // Append at the end of the existing order.
  const maxRows = await db
    .select({ position: jchatConversationMembers.position })
    .from(jchatConversationMembers)
    .where(eq(jchatConversationMembers.conversationId, conversationId))
    .orderBy(desc(jchatConversationMembers.position))
    .limit(1);

  const nextPosition = (maxRows[0]?.position ?? -1) + 1;

  // Upsert via insert with onConflictDoUpdate
  await db
    .insert(jchatConversationMembers)
    .values({
      conversationId,
      agentId,
      role: 'member',
      position: nextPosition,
    })
    .onConflictDoUpdate({
      target: [jchatConversationMembers.conversationId, jchatConversationMembers.agentId],
      set: {
        role: 'member',
        position: nextPosition,
      },
    })
    .catch((err) => {
      logger.error({ err, conversationId, agentId }, 'addMember failed');
      throw new JchatError(ErrorCodes.INTERNAL_ERROR, 'addMember failed');
    });
}

export async function removeMember(
  userId: Uuid,
  conversationId: Uuid,
  agentId: Uuid
): Promise<void> {
  await assertOwner(userId, conversationId);
  // Prevent removing the last member — would leave an orphaned group.
  const countRows = await db
    .select({ count: jchatConversationMembers.agentId })
    .from(jchatConversationMembers)
    .where(eq(jchatConversationMembers.conversationId, conversationId));
  if (countRows.length <= 1) {
    throw new JchatError(ErrorCodes.VALIDATION_ERROR, 'cannot remove the last member of a conversation');
  }
  await db
    .delete(jchatConversationMembers)
    .where(and(
      eq(jchatConversationMembers.conversationId, conversationId),
      eq(jchatConversationMembers.agentId, agentId)
    ))
    .catch((err) => {
      logger.error({ err, conversationId, agentId }, 'removeMember failed');
      throw new JchatError(ErrorCodes.INTERNAL_ERROR, 'removeMember failed');
    });
}

export async function getConversationMembers(
  conversationId: Uuid
): Promise<ConversationMember[]> {
  return loadMembers(conversationId);
}
