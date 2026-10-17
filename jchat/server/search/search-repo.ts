// jchat/server/search/search-repo.ts
//
// Postgres FTS over jchat_messages.content_tsv. Uses websearch_to_tsquery
// for natural query syntax + ts_rank for relevance + ts_headline for the
// snippet. v1 uses the `simple` config (multi-language friendly); v2 will
// upgrade to pg_jieba for Chinese segmentation (spec §3.3).

import type { Uuid } from '@shared/domain.js';
import { db } from '../lib/db.js';
import { sql } from 'drizzle-orm';
import { logger } from '../logger.js';

export interface SearchHit {
  messageId: Uuid;
  conversationId: Uuid;
  snippet: string;
  rank: number;
  ts: number;
}

/**
 * FTS for messages owned by the given user. Snippets are produced server-side
 * via ts_headline; if the RPC is missing (older migrations), falls back to a
 * plain content slice.
 */
export async function searchMessages(
  userId: Uuid,
  query: string,
  limit = 20
): Promise<SearchHit[]> {
  if (!query || !query.trim()) return [];

  // Preferred path: call the SQL function `jchat_search_messages`.
  try {
    const result = await db.execute(sql`
      SELECT * FROM jchat_search_messages(
        p_user_id => ${userId},
        p_query => ${query},
        p_limit => ${Math.min(limit, 100)}
      )
    `);

    const data = result.rows as Array<{ id: string; conversation_id: string; snippet: string; rank: number; created_at: string }>;
    if (Array.isArray(data) && data.length > 0) {
      return data.map((r) => ({
        messageId: r.id,
        conversationId: r.conversation_id,
        snippet: r.snippet ?? '',
        rank: r.rank,
        ts: new Date(r.created_at).getTime()
      }));
    }
  } catch (err) {
    logger.warn({ err }, 'jchat_search_messages RPC unavailable, falling back to textSearch');
  }

  // Fallback path: use websearch_to_tsquery directly.
  let ftsResults: SearchHit[] = [];
  try {
    const result = await db.execute(sql`
      SELECT m.id, m.conversation_id, m.content, m.created_at
      FROM jchat_messages m
      INNER JOIN jchat_conversations c ON m.conversation_id = c.id
      WHERE c.user_id = ${userId}
        AND m.deleted_at IS NULL
        AND m.content_tsv @@ websearch_to_tsquery('simple', ${query})
      LIMIT ${limit}
    `);

    const rows = result.rows as Array<{
      id: string;
      conversation_id: string;
      content: string | null;
      created_at: string;
    }>;

    ftsResults = rows.map((r) => ({
      messageId: r.id,
      conversationId: r.conversation_id,
      snippet: (r.content ?? '').slice(0, 240),
      rank: 0,
      ts: new Date(r.created_at).getTime()
    }));
  } catch (tsErr) {
    logger.error({ err: tsErr }, 'searchMessages fallback failed');
  }

  if (ftsResults.length > 0) return ftsResults;

  // LIKE fallback: the `simple` FTS config tokenizes CJK text into compound
  // tokens that websearch_to_tsquery can't match.  Fall back to a plain
  // ILIKE scan so Chinese search works until pg_jieba is deployed.
  try {
    // Use position() instead of ILIKE to avoid LIKE wildcard escaping issues.
    const result = await db.execute(sql`
      SELECT m.id, m.conversation_id, m.content, m.created_at
      FROM jchat_messages m
      INNER JOIN jchat_conversations c ON m.conversation_id = c.id
      WHERE c.user_id = ${userId}
        AND m.deleted_at IS NULL
        AND position(lower(${query}) in lower(m.content)) > 0
      LIMIT ${limit}
    `);
    const rows = result.rows as Array<{
      id: string; conversation_id: string; content: string | null; created_at: string;
    }>;
    return rows.map((r) => ({
      messageId: r.id,
      conversationId: r.conversation_id,
      snippet: (r.content ?? '').slice(0, 240),
      rank: 0,
      ts: new Date(r.created_at).getTime()
    }));
  } catch (likeErr) {
    logger.error({ err: likeErr }, 'searchMessages LIKE fallback failed');
    return [];
  }
}
