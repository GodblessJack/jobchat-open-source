/**
 * stream-registry.ts — in-memory registry of active agent reply streams.
 *
 * Keyed by (conversationId, agentId). Holds an `AbortController` per active
 * stream plus an optional `WorkerHandle` reference so cancellation can also
 * push an `abort` IPC to the worker subprocess.
 *
 * Usage:
 *   const ctrl = new AbortController();
 *   registerStream({ conversationId, agentId, abortController: ctrl });
 *   try { /* run stream * / } finally { unregisterStream(...); }
 *
 *   // From dispatcher:
 *   const ok = cancelStream(conversationId, agentId);
 */

import { randomUUID } from 'node:crypto';
import type { WorkerHandle } from '../sdk/worker-manager.js';

interface ActiveStream {
  streamId: string;
  abortController: AbortController;
  worker?: WorkerHandle | null;
  userId: string;
}

/** Map<conversationId, Map<agentId, ActiveStream>>. */
const activeStreams: Map<string, Map<string, ActiveStream>> = new Map();

export interface RegisterStreamArgs {
  userId: string;
  conversationId: string;
  agentId: string;
  abortController: AbortController;
  worker?: WorkerHandle | null;
}

export function registerStream(args: RegisterStreamArgs): string {
  let perConv = activeStreams.get(args.conversationId);
  if (!perConv) {
    perConv = new Map();
    activeStreams.set(args.conversationId, perConv);
  }
  // If a stream is already active for this agent, abort the previous one
  // before overwriting so the old orchestrator detects cancellation.
  const prev = perConv.get(args.agentId);
  if (prev) {
    try { prev.abortController.abort(); } catch { /* ignore */ }
    if (prev.worker) {
      try {
        void prev.worker.sendCommand({ type: 'abort' }).catch(() => { /* ignore */ });
      } catch { /* ignore */ }
    }
  }
  const streamId = randomUUID();
  perConv.set(args.agentId, {
    streamId,
    abortController: args.abortController,
    worker: args.worker ?? null,
    userId: args.userId
  });
  notifyChange();
  return streamId;
}

export function attachWorker(conversationId: string, agentId: string, worker: WorkerHandle): void {
  const perConv = activeStreams.get(conversationId);
  const entry = perConv?.get(agentId);
  if (entry) entry.worker = worker;
}

export function unregisterStream(conversationId: string, agentId: string, streamId: string): void {
  const perConv = activeStreams.get(conversationId);
  if (!perConv) return;
  const entry = perConv.get(agentId);
  // Only delete if the stored streamId matches — prevents an old
  // orchestrator's finally block from deleting a newer stream's entry.
  if (!entry || entry.streamId !== streamId) return;
  perConv.delete(agentId);
  if (perConv.size === 0) activeStreams.delete(conversationId);
  notifyChange();
}

/**
 * Cancel an active stream. Returns true if a stream existed and was aborted.
 *
 * Side effects:
 *  - calls `abortController.abort()` (the orchestrator's stream loop checks
 *    `signal.aborted` after each delta and exits)
 *  - best-effort fires `{type: 'abort'}` IPC to the worker so the SDK
 *    `query()` inner abortController is also cancelled
 *
 * The orchestrator's `finally` block will clean up the registry entry.
 */
export function cancelStream(conversationId: string, agentId: string): boolean {
  const perConv = activeStreams.get(conversationId);
  const entry = perConv?.get(agentId);
  if (!entry) return false;
  try { entry.abortController.abort(); } catch { /* ignore */ }
  if (entry.worker) {
    try {
      void entry.worker.sendCommand({ type: 'abort' }).catch(() => { /* ignore */ });
    } catch { /* ignore */ }
  }
  return true;
}

/**
 * Check if a stream is already active for a given (conversationId, agentId) pair.
 * Used by the orchestrator to prevent duplicate agent reply fan-out when
 * `message.send` is dispatched multiple times before the first reply completes.
 */
export function isStreamActive(conversationId: string, agentId: string): boolean {
  return activeStreams.get(conversationId)?.has(agentId) ?? false;
}

/** Test/diagnostics helper. */
export function activeStreamCount(): number {
  let n = 0;
  for (const m of activeStreams.values()) n += m.size;
  return n;
}

/**
 * Project the in-memory registry as `{ byAgentId: { <agentId>: 'running' } }`
 * for the `agent-status` topic. Powers the snapshot that drives the
 * "Alex is typing…" indicator + Stop button visibility.
 *
 * **Pass userId** to scope the projection to that user's streams. Without
 * it the snapshot leaked every other user's currently-running agents
 * (jchat agents are shared across users, so userA could enumerate
 * who else is talking to which agent right now).
 */
export function getAgentStatusProjection(userId?: string): { byAgentId: Record<string, 'running'> } {
  const byAgentId: Record<string, 'running'> = {};
  for (const perConv of activeStreams.values()) {
    for (const [agentId, entry] of perConv) {
      if (userId && entry.userId !== userId) continue;
      byAgentId[agentId] = 'running';
    }
  }
  return { byAgentId };
}

/**
 * Listener invoked whenever the registry changes (register/unregister).
 * Wired by `server/index.ts` to broadcast the `agent-status` topic so all
 * subscribed clients re-fetch the snapshot.
 */
let onChange: (() => void) | null = null;
export function setStreamRegistryChangeListener(fn: (() => void) | null): void {
  onChange = fn;
}
function notifyChange(): void {
  if (!onChange) return;
  try { onChange(); } catch { /* ignore — listener errors must not break the stream lifecycle */ }
}

/** Test helper — wipe registry between cases. */
export function _resetForTests(): void {
  activeStreams.clear();
  onChange = null;
}
