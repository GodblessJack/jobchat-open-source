-- jchat/sql/032_drop_members_active_session.sql
-- jchat_conversation_members.active_session was added alongside
-- jchat_conversations.active_session but never wired to any code path.
-- All active_session logic operates on the conversations table.
-- Drop the dead column to prevent confusion.

ALTER TABLE jchat_conversation_members DROP COLUMN IF EXISTS active_session;
