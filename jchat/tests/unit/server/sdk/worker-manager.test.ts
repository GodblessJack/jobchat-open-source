// jchat/tests/unit/server/sdk/worker-manager.test.ts
//
// TDD-style tests for the worker pool. We inject a fake spawner so we never
// actually fork a subprocess. The pool must:
//   - reuse a worker for the same (userId, agentId, conversationId) tuple
//     while it is alive
//   - evict idle workers after `idleMs`
//   - enforce per-user / per-conversation / global concurrency caps
//   - support manual release / dispose

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWorkerManager, type WorkerHandle } from '@/server/sdk/worker-manager';

interface FakeWorker extends WorkerHandle {
  killed: boolean;
}

function fakeSpawner() {
  const spawned: FakeWorker[] = [];
  let serial = 0;
  const spawn = vi.fn(async (): Promise<WorkerHandle> => {
    serial += 1;
    const id = `w${serial}`;
    const w: FakeWorker = {
      id,
      killed: false,
      socketPath: `/tmp/fake-${id}.sock`,
      pid: 1000 + serial,
      sendCommand: vi.fn(async () => ({ ok: true })),
      dispose: vi.fn(async () => {
        w.killed = true;
      })
    };
    spawned.push(w);
    return w;
  });
  return { spawn, spawned };
}

describe('worker-manager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reuses worker for the same (user, agent, conv) tuple', async () => {
    const { spawn, spawned } = fakeSpawner();
    const mgr = createWorkerManager({ spawn, idleMs: 60_000 });

    const w1 = await mgr.acquire({ userId: 'u1', agentId: 'a1', conversationId: 'c1' });
    const w2 = await mgr.acquire({ userId: 'u1', agentId: 'a1', conversationId: 'c1' });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(w1.id).toBe(w2.id);
    expect(spawned.length).toBe(1);
  });

  it('spawns a different worker for a different conversation', async () => {
    const { spawn } = fakeSpawner();
    const mgr = createWorkerManager({ spawn, idleMs: 60_000 });

    await mgr.acquire({ userId: 'u1', agentId: 'a1', conversationId: 'c1' });
    await mgr.acquire({ userId: 'u1', agentId: 'a1', conversationId: 'c2' });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('evicts idle workers after idleMs (LRU)', async () => {
    const { spawn, spawned } = fakeSpawner();
    const mgr = createWorkerManager({ spawn, idleMs: 10_000 });

    const w = await mgr.acquire({ userId: 'u1', agentId: 'a1', conversationId: 'c1' });
    mgr.release({ userId: 'u1', agentId: 'a1', conversationId: 'c1' });

    expect(w.id).toBe('w1');
    await vi.advanceTimersByTimeAsync(10_001);
    expect(spawned[0].killed).toBe(true);

    // Next acquire should spawn a fresh worker.
    await mgr.acquire({ userId: 'u1', agentId: 'a1', conversationId: 'c1' });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('does not evict an in-use (acquired but not released) worker', async () => {
    const { spawn, spawned } = fakeSpawner();
    const mgr = createWorkerManager({ spawn, idleMs: 5_000 });

    await mgr.acquire({ userId: 'u1', agentId: 'a1', conversationId: 'c1' });
    // Do NOT release.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spawned[0].killed).toBe(false);
  });

  it('enforces global concurrency limit', async () => {
    const { spawn } = fakeSpawner();
    const mgr = createWorkerManager({ spawn, idleMs: 60_000, globalLimit: 2 });

    await mgr.acquire({ userId: 'u1', agentId: 'a1', conversationId: 'c1' });
    await mgr.acquire({ userId: 'u1', agentId: 'a2', conversationId: 'c2' });

    await expect(
      mgr.acquire({ userId: 'u1', agentId: 'a3', conversationId: 'c3' })
    ).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' });

    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('enforces per-user concurrency limit', async () => {
    const { spawn } = fakeSpawner();
    const mgr = createWorkerManager({ spawn, idleMs: 60_000, perUserLimit: 1 });

    await mgr.acquire({ userId: 'u1', agentId: 'a1', conversationId: 'c1' });
    await expect(
      mgr.acquire({ userId: 'u1', agentId: 'a2', conversationId: 'c2' })
    ).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' });

    // Different user is allowed.
    await mgr.acquire({ userId: 'u2', agentId: 'a1', conversationId: 'c2' });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('enforces per-conversation concurrency limit', async () => {
    const { spawn } = fakeSpawner();
    const mgr = createWorkerManager({ spawn, idleMs: 60_000, perConversationLimit: 2 });

    await mgr.acquire({ userId: 'u1', agentId: 'a1', conversationId: 'c1' });
    await mgr.acquire({ userId: 'u1', agentId: 'a2', conversationId: 'c1' });
    await expect(
      mgr.acquire({ userId: 'u1', agentId: 'a3', conversationId: 'c1' })
    ).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' });
  });

  it('disposes all workers on shutdown', async () => {
    const { spawn, spawned } = fakeSpawner();
    const mgr = createWorkerManager({ spawn, idleMs: 60_000 });

    await mgr.acquire({ userId: 'u1', agentId: 'a1', conversationId: 'c1' });
    await mgr.acquire({ userId: 'u2', agentId: 'a1', conversationId: 'c2' });
    await mgr.shutdown();

    expect(spawned.every((w) => w.killed)).toBe(true);
  });

  it('removes worker from pool when its dispose() reports exit', async () => {
    const { spawn, spawned } = fakeSpawner();
    const mgr = createWorkerManager({ spawn, idleMs: 60_000 });

    await mgr.acquire({ userId: 'u1', agentId: 'a1', conversationId: 'c1' });
    await mgr.notifyWorkerExit('w1');
    // Re-acquire should spawn fresh
    await mgr.acquire({ userId: 'u1', agentId: 'a1', conversationId: 'c1' });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawned.length).toBe(2);
  });
});
