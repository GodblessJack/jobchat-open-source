-- 029_notify_triggers.sql
--
-- PostgreSQL LISTEN/NOTIFY triggers that replace Supabase Realtime.
-- These fire on INSERT / UPDATE / DELETE and broadcast the change via
-- pg_notify, which the server's local-notify.ts listener picks up.
--
-- Messages:     channel "message_change"
-- Conversations: channel "conversation_change"

-- ===== jchat_messages =====

CREATE OR REPLACE FUNCTION notify_message_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('message_change',
    json_build_object(
      'conversation_id', COALESCE(NEW.conversation_id, OLD.conversation_id),
      'message_id', COALESCE(NEW.id, OLD.id),
      'op', TG_OP
    )::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_notify_message_change ON jchat_messages;
CREATE TRIGGER tr_notify_message_change
  AFTER INSERT OR UPDATE OR DELETE ON jchat_messages
  FOR EACH ROW EXECUTE FUNCTION notify_message_change();

-- ===== jchat_conversations =====

CREATE OR REPLACE FUNCTION notify_conversation_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('conversation_change',
    json_build_object(
      'conversation_id', COALESCE(NEW.id, OLD.id),
      'user_id', COALESCE(NEW.user_id, OLD.user_id),
      'op', TG_OP
    )::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_notify_conversation_change ON jchat_conversations;
CREATE TRIGGER tr_notify_conversation_change
  AFTER INSERT OR UPDATE OR DELETE ON jchat_conversations
  FOR EACH ROW EXECUTE FUNCTION notify_conversation_change();
