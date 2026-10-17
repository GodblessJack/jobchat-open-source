// jchat/tests/unit/server/distillation-launcher.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('../../../server/sdk/sdk-bridge.js', () => ({
  runQuery: vi.fn(),
  getWorkerManager: vi.fn(() => ({ release: vi.fn() })),
}));
vi.mock('../../../server/mcp/index.js', () => ({
  buildMcpDescriptors: vi.fn(() => []),
}));
vi.mock('../../../server/agent/persona-builder.js', () => ({
  buildPersonaPrompt: vi.fn().mockResolvedValue(['stub system prompt']),
}));

import { runQuery } from '../../../server/sdk/sdk-bridge.js';
import { buildMcpDescriptors } from '../../../server/mcp/index.js';
import { launchDistillation } from '../../../server/distillation/launcher.js';
import {
  createRun,
  getRun,
  __resetForTests,
} from '../../../server/distillation/run-registry.js';

const JACK_AGENT_ID = '00000000-0000-0000-0000-000000000001';

describe('distillation launcher', () => {
  beforeEach(() => {
    __resetForTests();
    vi.clearAllMocks();
  });

  it('on contact-created hook firing, marks the run done', async () => {
    let capturedHook: ((r: { agent_id: string; slug_resolved: string; avatar_url: string | null; name: string }) => void) | undefined;
    (buildMcpDescriptors as any).mockImplementation((opts: any) => {
      capturedHook = opts.onContactCreated;
      return [];
    });
    const emitter = new EventEmitter();
    (runQuery as any).mockResolvedValue(emitter);

    const runId = createRun('user-1', 'https://x.com/naval');
    await launchDistillation({ runId, userId: 'user-1', xUrl: 'https://x.com/naval' });

    capturedHook!({ agent_id: 'a-1', slug_resolved: 'naval', avatar_url: 'http://x/a.png', name: 'Naval Ravikant' });
    emitter.emit('done');

    const run = getRun(runId);
    expect(run?.status).toBe('done');
    if (run?.status === 'done') {
      expect(run.result.agent_id).toBe('a-1');
      expect(run.result.slug).toBe('naval');
      expect(run.result.name).toBe('Naval Ravikant');
    }
  });

  it('emitter "done" without create_contact firing → marks error NO_CONTACT_CREATED', async () => {
    (buildMcpDescriptors as any).mockReturnValue([]);
    const emitter = new EventEmitter();
    (runQuery as any).mockResolvedValue(emitter);

    const runId = createRun('user-1', 'https://x.com/naval');
    await launchDistillation({ runId, userId: 'user-1', xUrl: 'https://x.com/naval' });

    emitter.emit('done');

    const run = getRun(runId);
    expect(run?.status).toBe('error');
    if (run?.status === 'error') expect(run.code).toBe('NO_CONTACT_CREATED');
  });

  it('emitter "error" → marks run error with the message', async () => {
    (buildMcpDescriptors as any).mockReturnValue([]);
    const emitter = new EventEmitter();
    (runQuery as any).mockResolvedValue(emitter);

    const runId = createRun('user-1', 'https://x.com/naval');
    await launchDistillation({ runId, userId: 'user-1', xUrl: 'https://x.com/naval' });

    emitter.emit('error', new Error('SDK_TIMEOUT'));

    const run = getRun(runId);
    expect(run?.status).toBe('error');
    if (run?.status === 'error') {
      expect(run.code).toBe('SDK_ERROR');
      expect(run.message).toContain('SDK_TIMEOUT');
    }
  });

  it('uses Jack agent_id and a synthetic conversationId starting with "distill-"', async () => {
    let capturedOpts: any;
    (buildMcpDescriptors as any).mockImplementation((o: any) => {
      capturedOpts = o;
      return [];
    });
    const emitter = new EventEmitter();
    (runQuery as any).mockResolvedValue(emitter);

    const runId = createRun('user-1', 'https://x.com/naval');
    await launchDistillation({ runId, userId: 'user-1', xUrl: 'https://x.com/naval' });
    emitter.emit('done');

    expect(capturedOpts.userId).toBe('user-1');
    expect(capturedOpts.agentId).toBe(JACK_AGENT_ID);
    expect(String(capturedOpts.conversationId)).toMatch(/^distill-/);
  });
});
