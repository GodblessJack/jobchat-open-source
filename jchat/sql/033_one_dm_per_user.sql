-- 033_one_dm_per_user.sql
--
-- Prevent duplicate DM conversations for the same user.  The
-- findOrCreateDm() SELECT-then-INSERT retry loop (conversation-repo.ts)
-- was written assuming the DB would reject duplicate DMs, but no such
-- constraint existed — concurrent callers silently created duplicate
-- conversation rows.
--
-- A partial unique index on (user_id) WHERE type = 'dm' closes the
-- TOCTOU gap: the second INSERT hits the unique violation, the retry
-- loop catches it, re-queries findExistingDm, and returns the first
-- caller's row.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_one_dm_per_user
  ON jchat_conversations (user_id)
  WHERE type = 'dm';
