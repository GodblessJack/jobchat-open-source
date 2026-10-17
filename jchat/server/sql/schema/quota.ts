import { pgTable, uuid, date, integer, timestamp, primaryKey, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const distillationQuota = pgTable('distillation_quota', {
  userId: uuid('user_id').notNull(),
  date: date('date').notNull(),
  count: integer('count').default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.date] }),
  countCheck: check('distillation_quota_count_check', sql`${table.count} >= 0 AND ${table.count} <= 100`),
}));
