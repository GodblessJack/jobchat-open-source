// jchat/server/lib/supabase-admin.ts
//
// Service-role Supabase admin client. Used by server-side code to bypass RLS
// (the server is the trusted boundary; client requests are authorized
// upstream via JWT verification before any admin-call is dispatched).
//
// NOTE: This is the minimal stub written by the agent/conversation module
// owner. Subagent A may merge a richer version (retry, logging, etc.); the
// `supabaseAdmin` export name and `.from()/.rpc()` signatures match the
// canonical Supabase-js shape so consumers do not change.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

let _client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (_client) return _client;
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    throw new Error(
      'getSupabaseAdmin(): SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required'
    );
  }
  _client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return _client;
}

// Lazy proxy so importers can `import { supabaseAdmin } from ...`
// without triggering env validation at module load time (helps in tests).
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    const c = getSupabaseAdmin() as unknown as Record<string | symbol, unknown>;
    const v = c[prop];
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(c) : v;
  }
});
