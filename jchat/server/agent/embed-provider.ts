// jchat/server/agent/embed-provider.ts
//
// Embedding provider factory.
//
// - 'openai' mode: POSTs to <baseUrl>/v1/embeddings with the configured model
//   and returns the first embedding vector. Compatible with the OpenAI
//   public API and any drop-in replacement that implements the same shape.
// - 'stub-zero-vector' mode: returns a 1536-dim zero vector. Used in dev /
//   test / when no API key is available. Logs a warning so memory recall
//   inaccuracy is visible in the logs.
//
// The factory auto-falls-back to stub mode whenever provider='openai' but
// no apiKey is supplied — keeps the server bootable in dev without burning
// quota on accidental real calls.

import { logger } from '../logger.js';
import { config } from '../config.js';

export interface EmbedProvider {
  embed(text: string): Promise<number[]>;
}

export interface EmbedProviderOpts {
  provider: 'openai' | 'stub-zero-vector';
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

function stubProvider(reason?: string): EmbedProvider {
  if (reason) {
    logger.warn(
      { reason },
      'embed-provider falling back to stub-zero-vector — memory recall WILL be inaccurate'
    );
  }
  return {
    embed: async () => new Array(config.embeddingDimension).fill(0)
  };
}

export function createEmbedProvider(opts: EmbedProviderOpts): EmbedProvider {
  if (opts.provider === 'stub-zero-vector') {
    return stubProvider();
  }
  if (!opts.apiKey) {
    return stubProvider('OPENAI_API_KEY missing');
  }

  const base = (opts.baseUrl || 'https://api.openai.com').replace(/\/$/, '');
  const url = base + '/v1/embeddings';
  const apiKey = opts.apiKey;
  const model = opts.model;

  return {
    async embed(text: string): Promise<number[]> {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model, input: text })
      });
      if (!r.ok) {
        logger.error({ status: r.status }, 'embedding api failed');
        throw new Error(`embedding api ${r.status}`);
      }
      const j = (await r.json()) as { data?: Array<{ embedding: number[] }> };
      const vec = j?.data?.[0]?.embedding;
      if (!vec || !Array.isArray(vec)) {
        throw new Error('embedding api: malformed response');
      }
      return vec;
    }
  };
}
