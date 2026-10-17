import { pgTable, uuid, text, timestamp, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { localUsers } from './users';

/**
 * Token-rotation tracking for local JWT refresh flow.
 *
 * Each refresh token belongs to a "family". When a token is rotated
 * (refreshed), the old jti is marked as replaced_by the new one.
 * If a stolen token is reused after rotation → THEFT_DETECTED on
 * the whole family, all active tokens invalidated.
 *
 * Queries use raw SQL in local-auth.ts; this schema exists so that
 * drizzle-kit push preserves the table and its indexes.
 */
export const refreshTokenFamilies = pgTable('refresh_token_families', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => localUsers.id, { onDelete: 'cascade' }),
  familyId: text('family_id').notNull(),
  jti: text('jti').notNull(),
  status: text('status').default('ACTIVE').notNull(),
  replacedBy: text('replaced_by'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  familyJtiUniq: uniqueIndex('idx_refresh_families_family_jti_uniq').on(table.familyId, table.jti),
  userIdIdx: index('idx_refresh_families_user').on(table.userId),
  activeIdx: index('idx_refresh_families_active')
    .on(table.expiresAt)
    .where(sql`${table.status} = 'ACTIVE'`),
  statusCheck: check('refresh_token_families_status_check',
    sql`${table.status} IN ('ACTIVE', 'LOGOUT', 'THEFT_DETECTED')`),
}));
