import { pgTable, uuid, text, timestamp, index, uniqueIndex, integer, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const jchatConversations = pgTable('jchat_conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  type: text('type').notNull(),
  title: text('title'),
  activeSession: uuid('active_session'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userUpdatedIdx: index('idx_jchat_conv_user_updated').on(table.userId, sql`${table.updatedAt} DESC`)
    .where(sql`${table.deletedAt} IS NULL`),
  oneDmPerUser: uniqueIndex('idx_one_dm_per_user').on(table.userId)
    .where(sql`${table.type} = 'dm'`),
  typeCheck: check('jchat_conversations_type_check', sql`${table.type} IN ('dm', 'group')`),
}));

export const jchatConversationMembers = pgTable('jchat_conversation_members', {
  conversationId: uuid('conversation_id').notNull()
    .references(() => jchatConversations.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').notNull(),
  role: text('role').default('member').notNull(),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  position: integer('position').default(0).notNull(),
}, (table) => ({
  pk: uniqueIndex('jchat_conv_members_pk').on(table.conversationId, table.agentId),
  agentIdx: index('idx_jchat_conv_members_agent').on(table.agentId),
  positionIdx: index('idx_jchat_conv_members_position').on(table.conversationId, table.position),
  roleCheck: check('jchat_conv_members_role_check', sql`${table.role} IN ('member', 'moderator')`),
}));
