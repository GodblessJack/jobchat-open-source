// jchat/server/sdk/worker-manager.ts
//
// Pool of SDK worker subprocesses. Acquires/reuses a worker per
// (userId, agentId, conversationId) tuple. Idle workers are evicted after
// `idleMs` (default 10 min). Enforces global / per-user / per-conversation
// concurrency caps (spec §7.1 step [6]).
//
// **Spawning is injected** (`opts.spawn`) so this module is testable without
// forking a real subprocess. The default spawner lives in `sdk-bridge.ts`.

import { JchatError } from '@shared/errors';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { slack } from '../lib/slack-notify.js';

// ======================================================================
// Types
// ======================================================================

/** Tuple identifying which worker should be reused. */
export interface WorkerKey {
  userId: string;
  agentId: string;
  conversationId: string;
}

/** Handle to a running worker subprocess. */
export interface WorkerHandle {
  /** Stable id (e.g. socket id). Used by `notifyWorkerExit`. */
  id: string;
  /** Unix socket path the worker is listening on. */
  socketPath: string;
  /** OS pid (best-effort; may be undefined for in-process tests). */
  pid?: number;
  /** Send a JSON-lines command to the worker; returns the response. */
  sendCommand: (msg: Record<string, unknown>) => Promise<unknown>;
  /** Cleanly shut down the worker process and unlink the socket. */
  dispose: () => Promise<void>;
}

export type WorkerSpawner = (key: WorkerKey) => Promise<WorkerHandle>;

export interface WorkerManagerOpts {
  spawn: WorkerSpawner;
  /** Idle eviction threshold in ms. Default 10 min. */
  idleMs?: number;
  /** Maximum concurrent workers globally. Default `config.globalWorkerLimit`. */
  globalLimit?: number;
  /** Maximum concurrent workers per user. Default `config.concurrentAgentsPerUser`. */
  perUserLimit?: number;
  /** Maximum concurrent workers per conversation. Default `config.concurrentAgentsPerConv`. */
  perConversationLimit?: number;
}

// ======================================================================
// Internal pool entry
// ======================================================================

interface PoolEntry {
  key: WorkerKey;
  handle: WorkerHandle;
  /** Refcount of acquire() minus release(). > 0 means in use. */
  inUseCount: number;
  /** Last release wall-clock ms. Used for LRU eviction. */
  lastReleasedAt: number | null;
  evictTimer: NodeJS.Timeout | null;
}

function poolKey(k: WorkerKey): string {
  return `${k.userId}${k.agentId}${k.conversationId}`;
}

// ======================================================================
// Manager
// ======================================================================

export interface WorkerManager {
  acquire: (key: WorkerKey) => Promise<WorkerHandle>;
  release: (key: WorkerKey) => void;
  notifyWorkerExit: (workerId: string) => Promise<void>;
  shutdown: () => Promise<void>;
  /** Test/diagnostics helper. */
  size: () => number;
}

export function createWorkerManager(opts: WorkerManagerOpts): WorkerManager {
  const {
    spawn,
    idleMs = config.workerIdleMs,
    globalLimit = config.globalWorkerLimit,
    perUserLimit = config.concurrentAgentsPerUser,
    perConversationLimit = config.concurrentAgentsPerConv
  } = opts;

  const pool = new Map<string, PoolEntry>();
  const byId = new Map<string, PoolEntry>();
  const inflight = new Map<string, Promise<WorkerHandle>>();
  let shuttingDown = false;

  function countByPredicate(pred: (e: PoolEntry) => boolean): number {
    let n = 0;
    for (const e of pool.values()) if (pred(e)) n += 1;
    return n;
  }

  function scheduleEviction(entry: PoolEntry): void {
    if (entry.evictTimer) clearTimeout(entry.evictTimer);
    entry.evictTimer = setTimeout(() => {
      // Re-check inUseCount in case acquire raced.
      if (entry.inUseCount > 0) return;
      logger.debug({ workerId: entry.handle.id }, 'evicting idle worker');
      pool.delete(poolKey(entry.key));
      byId.delete(entry.handle.id);
      void entry.handle.dispose().catch((e) =>
        logger.warn({ workerId: entry.handle.id, err: (e as Error).message }, 'worker dispose failed during eviction')
      );
    }, idleMs);
    // Keep timers from pinning the event loop in tests/long-running daemons.
    entry.evictTimer.unref?.();
  }

  async function acquire(key: WorkerKey): Promise<WorkerHandle> {
    if (shuttingDown) {
      throw new JchatError('WORKER_UNAVAILABLE', 'worker manager is shutting down');
    }

    const k = poolKey(key);
    const existing = pool.get(k);
    if (existing) {
      existing.inUseCount += 1;
      if (existing.evictTimer) {
        clearTimeout(existing.evictTimer);
        existing.evictTimer = null;
      }
      return existing.handle;
    }

    // Deduplicate concurrent spawns for the same key: if another acquire
    // is already spawning this (userId, agentId, conversationId) tuple,
    // await the pending promise rather than spawning a second worker.
    const pending = inflight.get(k);
    if (pending) {
      const handle = await pending;
      const entry = pool.get(k);
      if (entry) entry.inUseCount += 1;
      return handle;
    }

    // Concurrency caps before spawning.
    if (pool.size >= globalLimit) {
      throw new JchatError('WORKER_UNAVAILABLE', `global worker limit (${globalLimit}) reached`);
    }
    const userCount = countByPredicate((e) => e.key.userId === key.userId);
    if (userCount >= perUserLimit) {
      throw new JchatError('WORKER_UNAVAILABLE', `per-user worker limit (${perUserLimit}) reached`);
    }
    const convCount = countByPredicate((e) => e.key.conversationId === key.conversationId);
    if (convCount >= perConversationLimit) {
      throw new JchatError(
        'WORKER_UNAVAILABLE',
        `per-conversation worker limit (${perConversationLimit}) reached`
      );
    }

    const spawnPromise = (async () => {
      let handle: WorkerHandle;
      try {
        handle = await spawn(key);
      } catch (err) {
        slack.error(
          'Worker spawn failed',
          `SDK worker subprocess failed to start for agent ${key.agentId}`,
          {
            userId: key.userId,
            agentId: key.agentId,
            conversationId: key.conversationId,
            error: (err as Error).message
          }
        );
        throw err;
      }
      const entry: PoolEntry = {
        key,
        handle,
        inUseCount: 1,
        lastReleasedAt: null,
        evictTimer: null
      };
      pool.set(k, entry);
      byId.set(handle.id, entry);
      return handle;
    })();

    inflight.set(k, spawnPromise);
    try {
      return await spawnPromise;
    } finally {
      inflight.delete(k);
    }
  }

  function release(key: WorkerKey): void {
    const e = pool.get(poolKey(key));
    if (!e) return;
    if (e.inUseCount > 0) e.inUseCount -= 1;
    if (e.inUseCount === 0) {
      e.lastReleasedAt = Date.now();
      scheduleEviction(e);
    }
  }

  async function notifyWorkerExit(workerId: string): Promise<void> {
    const e = byId.get(workerId);
    if (!e) return;
    if (e.evictTimer) clearTimeout(e.evictTimer);
    // Dispose the handle (kill child process, close socket, unlink socket file)
    // before removing from the pool. Matches the pattern in scheduleEviction.
    await e.handle.dispose().catch(() => { /* ignore — worker already dead */ });
    pool.delete(poolKey(e.key));
    byId.delete(workerId);
  }

  async function shutdown(): Promise<void> {
    shuttingDown = true;
    const entries = [...pool.values()];
    pool.clear();
    byId.clear();
    await Promise.allSettled(
      entries.map(async (e) => {
        if (e.evictTimer) clearTimeout(e.evictTimer);
        try {
          await e.handle.dispose();
        } catch (err) {
          logger.warn({ workerId: e.handle.id, err: (err as Error).message }, 'worker dispose failed during shutdown');
        }
      })
    );
  }

  return {
    acquire,
    release,
    notifyWorkerExit,
    shutdown,
    size: () => pool.size
  };
}
