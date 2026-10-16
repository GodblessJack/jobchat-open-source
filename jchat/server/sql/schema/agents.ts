import { pgTable, uuid, text, boolean, integer, timestamp, jsonb, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const agents = pgTable('agents', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  role: text('role'),
  avatarUrl: text('avatar_url'),
  personaDescription: text('persona_description'),
  initialMessage: text('initial_message'),
  isDefault: boolean('is_default').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  ownerUserId: uuid('owner_user_id'),
  sourceType: text('source_type'),
  sourceUrl: text('source_url'),
  slug: text('slug'),
  identity: jsonb('identity').$type<Record<string, unknown>>(),
  bootstrapMd: text('bootstrap_md'),
}, (table) => ({
  ownerIdx: index('agents_owner_idx').on(table.ownerUserId).where(sql`${table.ownerUserId} IS NOT NULL`),
  ownerSlugUniq: uniqueIndex('agents_owner_slug_uniq').on(table.ownerUserId, table.slug)
    .where(sql`${table.ownerUserId} IS NOT NULL AND ${table.slug} IS NOT NULL`),
  personaNonempty: check('agents_persona_nonempty', sql`${table.personaDescription} IS NOT NULL AND length(${table.personaDescription}) >= 50`),
}));

export const userAgents = pgTable('user_agents', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  customInstructions: text('custom_instructions'),
  isRemovable: boolean('is_removable').default(true),
  lastReadAt: timestamp('last_read_at', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  userAgentUniq: uniqueIndex('user_agents_user_agent_uniq').on(table.userId, table.agentId)
    .where(sql`${table.deletedAt} IS NULL`),
  userIdIdx: index('idx_user_agents_user_id').on(table.userId),
  agentIdIdx: index('idx_user_agents_agent_id').on(table.agentId),
}));

export const agentSkills = pgTable('agent_skills', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  skillName: text('skill_name').notNull(),
  description: text('description'),
  enabled: boolean('enabled').default(true),
  sortOrder: integer('sort_order').default(0),
  inlineContent: text('inline_content'),
  category: text('category'),          // governance metadata (admin UI grouping only, not runtime branching)
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  agentSkillUniq: uniqueIndex('agent_skills_agent_skill_uniq').on(table.agentId, table.skillName),
  agentIdIdx: index('idx_agent_skills_agent_id').on(table.agentId),
}));
