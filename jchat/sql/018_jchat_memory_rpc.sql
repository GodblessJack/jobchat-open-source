-- 018_jchat_memory_rpc.sql
-- pgvector RPC for top-K cosine similarity recall.

CREATE OR REPLACE FUNCTION jchat_recall_memory(
  p_user_id  uuid,
  p_agent_id uuid,
  p_query    vector(1536),
  p_top_k    int
)
RETURNS TABLE(
  id          uuid,
  chunk_text  text,
  importance  real,
  distance    real
)
LANGUAGE sql
STABLE
AS $$
  SELECT id,
         chunk_text,
         importance,
         (embedding <=> p_query)::real AS distance
  FROM jchat_agent_memory
  WHERE user_id = p_user_id
    AND agent_id = p_agent_id
    AND embedding IS NOT NULL
  ORDER BY embedding <=> p_query
  LIMIT p_top_k;
$$;
