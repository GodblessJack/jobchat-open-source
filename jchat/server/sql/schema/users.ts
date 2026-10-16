import { pgTable, uuid, text, integer, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  linkedinId: text('linkedin_id').unique(),
  fullName: text('full_name'),
  avatarUrl: text('avatar_url'),
  headline: text('headline'),
  email: text('email').unique(),
  education: text('education'),
  experienceYears: text('experience_years'),
  currentTitle: text('current_title'),
  phone: text('phone'),
  basicInfo: text('basic_info'),
  preferences: text('preferences'),
  memory: text('memory'),
  profileVersion: integer('profile_version').default(0),
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const localUsers = pgTable('local_users', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: text('username').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  failedAttempts: integer('failed_attempts').default(0).notNull(),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
}, (table) => ({
  usernameCheck: check('local_users_username_check', sql`${table.username} ~ '^[a-zA-Z0-9_-]{3,30}$'`),
}));

export const jchatUserProfile = pgTable('jchat_user_profile', {
  userId: uuid('user_id').primaryKey(),
  displayName: text('display_name'),
  profileMarkdown: text('profile_markdown'),
  timezone: text('timezone'),
  locale: text('locale'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
