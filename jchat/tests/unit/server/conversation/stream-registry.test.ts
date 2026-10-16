// @ts-nocheck
// jchat/tests/unit/server/conversation/stream-registry.test.ts
//
// Unit coverage for the stream-registry module + cancelAgentReply export
// from agent-reply-orchestrator. Validates:
//  - register / cancel / unregister lifecycle
//  - cancelStream returns false when no active stream exists
//  - cancelStream both fires AbortController.abort() and worker IPC abort
//  - orchestrator's `cancelAgentReply` is a wrapper that reaches the registry

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  registerStream,
  attachWorker,
  unregisterStream,
  cancelStream,
  activeStreamCount,
  _resetForTests
} from '@/server/conversation/stream-registry.js';

const CONV = 'conv-A';
const AGENT = 'agent-X';

describe('stream-registry', () => {
  afterEach(() => {
    _resetForTests();
  });

  it('registers and unregisters cleanly', () => {
    expect(activeStreamCount()).toBe(0);
    const streamId = registerStream({ userId: 'user-1', conversationId: CONV, agentId: AGENT, abortController: new AbortController() });
    expect(activeStreamCount()).toBe(1);
    unregisterStream(CONV, AGENT, streamId);
    expect(activeStreamCount()).toBe(0);
  });

  it('cancelStream returns false when no entry', () => {
    expect(cancelStream(CONV, AGENT)).toBe(false);
  });

  it('cancelStream aborts the controller', () => {
    const ctrl = new AbortController();
    const _s = registerStream({ userId: 'user-1', conversationId: CONV, agentId: AGENT, abortController: ctrl });
    expect(ctrl.signal.aborted).toBe(false);
    expect(cancelStream(CONV, AGENT)).toBe(true);
    expect(ctrl.signal.aborted).toBe(true);
  });

  it('attachWorker + cancelStream sends abort IPC to worker', () => {
    const ctrl = new AbortController();
    const _s = registerStream({ userId: 'user-1', conversationId: CONV, agentId: AGENT, abortController: ctrl });
    const sendCommand = vi.fn(async () => ({ ok: true }));
    const fakeWorker = {
      id: 'w1',
      socketPath: '/tmp/x.sock',
      sendCommand,
      dispose: async () => undefined
    };
    attachWorker(CONV, AGENT, fakeWorker);
    cancelStream(CONV, AGENT);
    expect(ctrl.signal.aborted).toBe(true);
    expect(sendCommand).toHaveBeenCalledWith({ type: 'abort' });
  });

  it('isolates streams per (conv, agent) pair', () => {
    const a = new AbortController();
    const b = new AbortController();
    const streamA = registerStream({ userId: 'user-1', conversationId: CONV, agentId: 'agent-A', abortController: a });
    const streamB = registerStream({ userId: 'user-1', conversationId: CONV, agentId: 'agent-B', abortController: b });
    expect(activeStreamCount()).toBe(2);

    expect(cancelStream(CONV, 'agent-A')).toBe(true);
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);

    unregisterStream(CONV, 'agent-A', streamA);
    unregisterStream(CONV, 'agent-B', streamB);
    expect(activeStreamCount()).toBe(0);
  });
});

describe('agent-reply-orchestrator.cancelAgentReply', () => {
  afterEach(() => {
    _resetForTests();
    vi.resetModules();
  });

  it('reaches the registry and aborts the controller', async () => {
    // Import after resetModules in afterEach to avoid stale singleton state.
    const orch = await import('@/server/conversation/agent-reply-orchestrator.js');
    const ctrl = new AbortController();
    const streamId = registerStream({ userId: 'user-1', conversationId: CONV, agentId: AGENT, abortController: ctrl });

    expect(orch.cancelAgentReply(CONV, AGENT)).toBe(true);
    expect(ctrl.signal.aborted).toBe(true);

    // Until the orchestrator's `finally` runs unregisterStream, the entry is
    // still in the registry; cancel-on-already-cancelled is a no-op that still
    // returns true (idempotent from the dispatcher's POV).
    expect(orch.cancelAgentReply(CONV, AGENT)).toBe(true);
    // After explicit unregister, cancel returns false.
    unregisterStream(CONV, AGENT, streamId);
    expect(orch.cancelAgentReply(CONV, AGENT)).toBe(false);
  });
});
