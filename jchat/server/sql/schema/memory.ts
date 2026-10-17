import { pgTable, uuid, text, real, timestamp, customType } from 'drizzle-orm/pg-core';
import { users } from './users';
import { agents } from './agents';
import { jchatConversations } from './conversations';
import { jchatMessages } from './messages';

/**
 * pgvector column type for embedding vectors.
 *
 * Drizzle has no native vector type, so we define a customType that
 * maps to `vector(1536)` (OpenAI text-embedding-3-small dims).
 *
 * Runtime queries against this column use raw SQL (`sql` template)
 * because Drizzle's query builder cannot construct pgvector distance
 * operators (`<->`, `<=>`, `<#>`).  The column IS in the schema so
 * that `drizzle-kit push` creates it correctly and the TypeScript
 * type knows the column exists.
 */
export const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(val: number[]): string {
    return `[${val.join(',')}]`;
  },
});

export const jchatAgentMemory = pgTable('jchat_agent_memory', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  sourceConversationId: uuid('source_conversation_id').references(() => jchatConversations.id, { onDelete: 'set null' }),
  sourceMessageId: uuid('source_message_id').references(() => jchatMessages.id, { onDelete: 'set null' }),
  chunkText: text('chunk_text').notNull(),
  embedding: vector1536('embedding'),
  importance: real('importance').default(0.5).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
