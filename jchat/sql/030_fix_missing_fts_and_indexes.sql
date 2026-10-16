-- 030_fix_missing_fts_and_indexes.sql
-- Fix schema drift: content_tsv column + GIN indexes missing from DB
-- because drizzle-kit push created the table without migration-012 objects.
--
-- These objects are defined in 012_jchat_messages.sql but never applied:
--   1. content_tsv GENERATED ALWAYS column
--   2. idx_jchat_msg_tsv GIN index (FTS on content_tsv)
--   3. idx_jchat_msg_mentions GIN index (array contains queries)
--   4. idx_jchat_memory_user_agent (missing from schema for recall RPC)

-- ===== 1. content_tsv GENERATED ALWAYS column =====
-- The column is intentionally NOT in the Drizzle schema (can't model GENERATED
-- ALWAYS), so we add it via raw SQL.  All existing rows are automatically
-- backfilled because it is STORED.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'jchat_messages'
      AND column_name = 'content_tsv'
  ) THEN
    ALTER TABLE jchat_messages
      ADD COLUMN content_tsv tsvector
        GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, '')))
        STORED;
  END IF;
END $$;

-- ===== 2. GIN index on content_tsv for FTS =====
CREATE INDEX IF NOT EXISTS idx_jchat_msg_tsv
  ON jchat_messages USING GIN (content_tsv);

-- ===== 3. GIN index on mentions for array-contains queries =====
CREATE INDEX IF NOT EXISTS idx_jchat_msg_mentions
  ON jchat_messages USING GIN (mentions);

-- ===== 4. Composite partial index for jchat_recall_memory RPC =====
-- The RPC queries: WHERE user_id = X AND agent_id = Y AND embedding IS NOT NULL
-- Without this index, every recall does a sequential scan over jchat_agent_memory.
CREATE INDEX IF NOT EXISTS idx_jchat_memory_user_agent
  ON jchat_agent_memory (user_id, agent_id)
  WHERE embedding IS NOT NULL;
