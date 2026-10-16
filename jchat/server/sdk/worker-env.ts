// jchat/server/sdk/worker-env.ts
//
// **Red line #2** (jobchat CLAUDE.md):
//   `workerEnv 禁止 `...process.env``. Only an explicit allowlist of env vars
//   may be forwarded to the SDK worker subprocess. This module is the single
//   source of truth for that allowlist — `worker-manager.ts` MUST call
//   `buildWorkerEnv()` and never spread `process.env` directly.

export const WORKER_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'CLAUDE_HOME',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'NODE_ENV',
  'JCHAT_SESSIONS_ROOT',
  'FILES_ROOT'
] as const;

export type WorkerEnvKey = (typeof WORKER_ENV_ALLOWLIST)[number];

const ALLOWLIST_SET: ReadonlySet<string> = new Set(WORKER_ENV_ALLOWLIST);

/**
 * Build the env passed to spawned SDK workers.
 *
 * Behavior:
 * - Copies ONLY allowlisted keys from `process.env`. Anything not on the list
 *   (e.g. `NODE_OPTIONS`, `NPM_CONFIG_*`, custom secrets) is dropped.
 * - `overrides` may override allowlisted keys; non-allowlisted overrides are
 *   silently dropped (defense in depth).
 *
 * @param overrides Optional per-spawn overrides (e.g. session-specific
 *                  `JCHAT_SESSIONS_ROOT`).
 */
export function buildWorkerEnv(overrides?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of WORKER_ENV_ALLOWLIST) {
    const v = process.env[key];
    if (v !== undefined) out[key] = v;
  }
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (!ALLOWLIST_SET.has(k)) continue;
      if (v === undefined) {
        delete out[k];
      } else {
        out[k] = v;
      }
    }
  }
  return out;
}
