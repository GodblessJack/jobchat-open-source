-- 019_jchat_search_rpc.sql
-- FTS RPC with ts_headline-generated snippets, scoped to the calling user's
-- conversations. PostgREST cannot reach ts_headline directly, so we route
-- snippet generation through a SECURITY INVOKER function.

CREATE OR REPLACE FUNCTION jchat_search_messages(
  p_user_id uuid,
  p_query   text,
  p_limit   int DEFAULT 20
)
RETURNS TABLE(
  id              uuid,
  conversation_id uuid,
  snippet         text,
  rank            real,
  created_at      timestamptz
)
LANGUAGE sql
STABLE
AS $$
  WITH q AS (
    SELECT websearch_to_tsquery('simple', p_query) AS tsq
  )
  SELECT
    m.id,
    m.conversation_id,
    ts_headline(
      'simple',
      coalesce(m.content, ''),
      (SELECT tsq FROM q),
      'StartSel=<mark>,StopSel=</mark>,MaxFragments=2,MaxWords=20,MinWords=5'
    ) AS snippet,
    ts_rank(m.content_tsv, (SELECT tsq FROM q))::real AS rank,
    m.created_at
  FROM jchat_messages m
  JOIN jchat_conversations c ON c.id = m.conversation_id
  WHERE c.user_id = p_user_id
    AND m.deleted_at IS NULL
    AND m.content_tsv @@ (SELECT tsq FROM q)
  ORDER BY rank DESC, m.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;
