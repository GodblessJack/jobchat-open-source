-- 032_conversation_updated_at_trigger.sql
--
-- Add a BEFORE UPDATE trigger on jchat_conversations that auto-sets
-- updated_at = NOW() on every UPDATE. DEFAULT now() only fires on INSERT,
-- but four mutation paths (archiveConversation, deleteConversation,
-- addMember, removeMember) were not manually setting updatedAt, causing
-- stale sort order in the conversation sidebar (idx_jchat_conv_user_updated).

CREATE OR REPLACE FUNCTION jchat_conversations_bump_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_jchat_conversations_updated_at ON jchat_conversations;
CREATE TRIGGER trg_jchat_conversations_updated_at
  BEFORE UPDATE ON jchat_conversations
  FOR EACH ROW
  EXECUTE FUNCTION jchat_conversations_bump_updated_at();
