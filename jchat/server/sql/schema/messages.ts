import { pgTable, uuid, text, jsonb, timestamp, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/*
 * NOTE: The database table `jchat_messages` also has a `content_tsv` column:
 *
 *   content_tsv tsvector GENERATED ALWAYS AS
 *     (to_tsvector('simple', coalesce(content, ''))) STORED
 *
 * together with a GIN index `idx_jchat_msg_tsv` for full-text search.
 *
 * This column is intentionally NOT in the Drizzle schema because:
 *   1. It is GENERATED ALWAYS — the database owns it, not the application.
 *   2. All FTS queries go through raw SQL (`search-repo.ts`), never Drizzle's
 *      query builder, so Drizzle-level type safety adds no value.
 *   3. drizzle-kit cannot model GENERATED-always columns and would drop/recreate
 *      it on push, which is expensive (tsvector recomputation) and risky.
 *
 * The column is created by sql/012_jchat_messages.sql and maintained by the
 * database at row-insert/update time.
 */

export const jchatMessages = pgTable('jchat_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').notNull(),
  senderType: text('sender_type').notNull(),
  senderId: uuid('sender_id').notNull(),
  content: text('content'),
  mentions: uuid('mentions').array(),
  toolCalls: jsonb('tool_calls').$type<unknown[]>(),
  attachments: jsonb('attachments').$type<unknown[]>(),
  parentId: uuid('parent_id'),
  sdkSessionId: uuid('sdk_session_id'),
  deliveryStatus: text('delivery_status').default('final').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
}, (table) => ({
  convCreatedIdx: index('idx_jchat_msg_conv_created').on(table.conversationId, table.createdAt)
    .where(sql`${table.deletedAt} IS NULL`),
  senderAgentIdx: index('idx_jchat_msg_sender_agent').on(table.senderId)
    .where(sql`${table.senderType} = 'agent'`),
  transcriptIdx: uniqueIndex('idx_jchat_messages_transcript_entry_unique')
    .on(table.conversationId, sql`(${table.metadata}->>'transcriptEntryId')`)
    .where(sql`${table.metadata}->>'source' = 'call'`),
  senderCheck: check('jchat_messages_sender_type_check',
    sql`${table.senderType} IN ('user', 'agent', 'system')`),
  deliveryCheck: check('jchat_messages_delivery_status_check',
    sql`${table.deliveryStatus} IN ('partial', 'final', 'error')`),
}));
