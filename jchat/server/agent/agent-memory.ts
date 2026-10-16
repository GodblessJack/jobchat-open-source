// jchat/server/agent/agent-memory.ts
//
// pgvector-backed Agent memory.
//
// - recallMemory(userId, agentId, queryText, topK) — embeds the query and
//   calls the `jchat_recall_memory` RPC (sql/018) to fetch top-K nearest
//   chunks for that (user, agent). Returns [] on error so callers can
//   degrade gracefully (memory is best-effort context, never load-bearing).
//
// - addMemory({...}) — embeds the chunk, INSERTs into `jchat_agent_memory`.
//   v1 only Agent reply text goes through this path (spec §7.1 privacy
//   protection). Fire-and-forget callers MUST `.catch()` to avoid
//   crashing the parent process.
//
// All writes use the service-role client; the RLS policy `memory_owner`
// (sql/016) is bypassed because the server is the trust boundary.

import { db } from '../lib/db.js';
import { sql } from 'drizzle-orm';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { createEmbedProvider, type EmbedProvider } from './embed-provider.js';
import type { Uuid } from '@shared/domain.js';

export interface RecallResult {
  id: Uuid;
  chunk_text: string;
  importance: number;
  distance: number;
}

let _embedder: EmbedProvider | null = null;

/** Lazy singleton so config / env reads happen at first use, not at import. */
function embedder(): EmbedProvider {
  if (_embedder) return _embedder;
  _embedder = createEmbedProvider({
    provider: config.openaiApiKey ? 'openai' : 'stub-zero-vector',
    model: config.embeddingModel,
    apiKey: config.openaiApiKey || undefined,
    baseUrl: config.openaiBaseUrl
  });
  return _embedder;
}

/** TEST HOOK — replace the embedder for unit tests. Production code never calls this. */
export function __setEmbedderForTest(p: EmbedProvider | null): void {
  _embedder = p;
}

export async function embedText(text: string): Promise<number[]> {
  return embedder().embed(text);
}

/**
 * Recall top-K most similar memory chunks for (user, agent) given a query.
 * Returns [] on failure (logged) — callers treat this as "no memory".
 */
export async function recallMemory(
  userId: Uuid,
  agentId: Uuid,
  queryText: string,
  topK = config.memoryTopK
): Promise<RecallResult[]> {
  let queryVec: number[];
  try {
    queryVec = await embedder().embed(queryText);
  } catch (err) {
    logger.warn({ err, userId, agentId }, 'recallMemory embed failed');
    return [];
  }

  // Validate embedding dimension before the ::vector cast to prevent silent
  // failures when the model outputs a different dimension than the column expects.
  if (queryVec.length !== config.embeddingDimension) {
    logger.error(
      { actualDim: queryVec.length, expectedDim: config.embeddingDimension, userId, agentId },
      'recallMemory embedding dimension mismatch — check JCHAT_EMBEDDING_DIM and pgvector column'
    );
    return [];
  }

  try {
    // Format the vector as a pgvector literal: '[1,2,3,...]'
    const vecLiteral = `[${queryVec.join(',')}]`;
    const result = await db.execute(sql`
      SELECT * FROM jchat_recall_memory(
        p_user_id => ${userId},
        p_agent_id => ${agentId},
        p_query => ${vecLiteral}::vector,
        p_top_k => ${topK}
      )
    `);
    const data = result.rows as unknown as RecallResult[];
    return data ?? [];
  } catch (err) {
    logger.warn({ err, userId, agentId }, 'recallMemory RPC failed');
    return [];
  }
}

export interface AddMemoryOpts {
  userId: Uuid;
  agentId: Uuid;
  sourceConversationId?: Uuid | null;
  sourceMessageId?: Uuid | null;
  chunkText: string;
  importance?: number;
}

/**
 * Persist a memory chunk. Errors are logged but NOT thrown — caller
 * (typically extractMemoryAsync) is fire-and-forget and the failure
 * must not surface to the user. Skips empty chunks.
 */
export async function addMemory(opts: AddMemoryOpts): Promise<void> {
  const text = (opts.chunkText || '').trim();
  if (!text) return;
  let embedding: number[];
  try {
    embedding = await embedder().embed(text);
  } catch (err) {
    logger.warn({ err, userId: opts.userId, agentId: opts.agentId }, 'addMemory embed failed');
    return;
  }

  // Validate embedding dimension before the ::vector cast to prevent silent
  // failures when the model outputs a different dimension than the column expects.
  if (embedding.length !== config.embeddingDimension) {
    logger.error(
      { actualDim: embedding.length, expectedDim: config.embeddingDimension, userId: opts.userId, agentId: opts.agentId },
      'addMemory embedding dimension mismatch — check JCHAT_EMBEDDING_DIM and pgvector column'
    );
    return;
  }

  // INSERT with raw SQL since the embedding column is pgvector type
  // which is not in the Drizzle schema.
  try {
    const vecLiteral = `[${embedding.join(',')}]`;
    await db.execute(sql`
      INSERT INTO jchat_agent_memory (user_id, agent_id, source_conversation_id, source_message_id, chunk_text, embedding, importance)
      VALUES (${opts.userId}, ${opts.agentId}, ${opts.sourceConversationId ?? null}, ${opts.sourceMessageId ?? null}, ${text}, ${vecLiteral}::vector, ${opts.importance ?? 0.5})
    `);
  } catch (err) {
    logger.error({ err, userId: opts.userId, agentId: opts.agentId }, 'addMemory insert failed');
  }
}
