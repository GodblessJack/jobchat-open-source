import { pgTable, uuid, text, timestamp, index, check, integer, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { jchatConversations } from './conversations';
import { agents } from './agents';
import { users } from './users';

export const jchatSdkSessions = pgTable('jchat_sdk_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').references(() => jchatConversations.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  workspacePath: text('workspace_path').notNull(),
  status: text('status').notNull(),
  workerPid: integer('worker_pid'),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  errorMsg: text('error_msg'),
}, (table) => ({
  activeIdx: index('idx_jchat_sdk_active').on(table.conversationId, table.status),
  agentRunningIdx: index('idx_jchat_sdk_agent_running').on(table.agentId, table.status)
    .where(sql`${table.status} = 'running'`),
  runningLastActiveIdx: index('idx_jchat_sdk_running_last_active').on(table.status, table.lastActiveAt)
    .where(sql`${table.status} = 'running'`),
  statusCheck: check('jchat_sdk_sessions_status_check',
    sql`${table.status} IN ('idle','starting','running','cancelled','failed','ended')`),
}));

export const jchatMeetingSessions = pgTable('jchat_meeting_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  conversationId: uuid('conversation_id').notNull().references(() => jchatConversations.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
}, (table) => ({
  userStartedIdx: index('idx_jchat_meeting_sessions_user_started').on(table.userId, table.startedAt.desc()),
  conversationIdx: index('idx_jchat_meeting_sessions_conversation').on(table.conversationId),
  statusStartedIdx: index('idx_jchat_meeting_sessions_status_started').on(table.status, table.startedAt)
    .where(sql`${table.status} = 'ongoing'`),
  statusCheck: check('jchat_meeting_sessions_status_check',
    sql`${table.status} IN ('ongoing','completed','error')`),
}));
