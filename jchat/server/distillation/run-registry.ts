// jchat/server/distillation/run-registry.ts
//
// Process-memory state for active and recently-completed distillation runs.
// Spec §3.3: server restart clears the map; that is acceptable for MVP+
// because the SDK session dies with the process and the user will see the
// contact in the list when refresh.
//
// Plan: Task 2

import { randomUUID } from 'node:crypto';

export interface RunRunning {
  status: 'running';
  runId: string;
  userId: string;
  xUrl: string;
  startedAt: number; // ms epoch
}

export interface RunDone {
  status: 'done';
  runId: string;
  userId: string;
  xUrl: string;
  startedAt: number;
  completedAt: number;
  result: {
    agent_id: string;
    name: string;
    avatar_url: string | null;
    slug: string;
  };
}

export interface RunError {
  status: 'error';
  runId: string;
  userId: string;
  xUrl: string;
  startedAt: number;
  completedAt: number;
  code: string;
  message: string;
}

export type RunState = RunRunning | RunDone | RunError;

const COMPLETED_TTL_MS = 5 * 60 * 1000;

const _runs = new Map<string, RunState>();

export const registry = {
  gcSync(): void {
    const now = Date.now();
    for (const [id, run] of _runs) {
      if (run.status === 'running') continue;
      if (now - run.completedAt > COMPLETED_TTL_MS) _runs.delete(id);
    }
  },
};

// Lazy GC: runs on every read mutation. Cheap; max ~3 entries per user / day.
function gc(): void {
  registry.gcSync();
}

export function createRun(userId: string, xUrl: string): string {
  gc();
  const runId = randomUUID();
  _runs.set(runId, { status: 'running', runId, userId, xUrl, startedAt: Date.now() });
  return runId;
}

export function getRun(runId: string): RunState | undefined {
  gc();
  return _runs.get(runId);
}

export function hasRunningForUser(userId: string): boolean {
  gc();
  for (const r of _runs.values()) {
    if (r.userId === userId && r.status === 'running') return true;
  }
  return false;
}

export function markDone(runId: string, result: RunDone['result']): void {
  const run = _runs.get(runId);
  if (!run || run.status !== 'running') return;
  _runs.set(runId, {
    status: 'done',
    runId: run.runId,
    userId: run.userId,
    xUrl: run.xUrl,
    startedAt: run.startedAt,
    completedAt: Date.now(),
    result,
  });
}

export function markError(runId: string, code: string, message: string): void {
  const run = _runs.get(runId);
  if (!run || run.status !== 'running') return;
  _runs.set(runId, {
    status: 'error',
    runId: run.runId,
    userId: run.userId,
    xUrl: run.xUrl,
    startedAt: run.startedAt,
    completedAt: Date.now(),
    code,
    message,
  });
}

/** Test-only. Clears all in-memory state. */
export function __resetForTests(): void {
  _runs.clear();
}
