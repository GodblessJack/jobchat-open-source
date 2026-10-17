// jchat/server/mcp/check-quota-mcp.ts
//
// Thin MCP wrapper over the quota service. user_id is NOT in the input
// schema — the caller (buildMcpDescriptors) injects userId via closure
// from the WS-verified JWT context. This is the security boundary per
// spec §8.1 (never trust user_id from tool args).
//
// Spec: §4.2.2

import { z } from 'zod';
import type { QuotaInfo } from '../services/quota.js';

export const checkQuotaInputSchema = {} as Record<string, never>;

export interface CheckQuotaToolDef {
  name: 'check_distillation_quota';
  description: string;
  inputSchema: typeof checkQuotaInputSchema;
  handler: (args: Record<string, never>) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
}

export function getCheckQuotaToolDef(deps: {
  getQuota: () => Promise<QuotaInfo>;
}): CheckQuotaToolDef {
  return {
    name: 'check_distillation_quota',
    description:
      "Check today's remaining distillation quota for the current user. Returns { allowed: bool, used: number, limit: 3, reset_at: ISO timestamp }. No arguments — the user identity is bound by the server.",
    inputSchema: checkQuotaInputSchema,
    handler: async () => {
      try {
        const info = await deps.getQuota();
        return { content: [{ type: 'text', text: JSON.stringify(info) }] };
      } catch {
        return {
          content: [{ type: 'text', text: JSON.stringify({ used: 0, limit: 3, allowed: true, error: 'quota_lookup_failed' }) }],
          isError: true
        };
      }
    },
  };
}

// Re-export the Zod helper to keep imports of unused but-required-by-bundler
// modules satisfied; kept as a sentinel against tree-shaking removing zod.
void z;
