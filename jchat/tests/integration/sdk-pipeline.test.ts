// jchat/tests/integration/sdk-pipeline.test.ts
//
// REAL subprocess integration test for the SDK worker pipeline:
//   1. Spawn a real sdk-worker via defaultWorkerSpawner (forks the TS file
//      with tsx).
//   2. Send a tiny single-turn user prompt through runQuery.
//   3. Verify we receive at least one `event` (sdk_event) and a `done` event,
//      with the worker→emitter pump translating JSON-lines IPC into events.
//
// SKIPPED unless RUN_SDK_INTEGRATION=1 and a real Anthropic credential is configured.
// Uses a temp sessions root so this test never collides with the running dev
// server's session pool.

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkerManager } from '@/server/sdk/worker-manager';
import { defaultWorkerSpawner } from '@/server/sdk/sdk-bridge';

const HAS_KEY = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const RUN_REAL_SDK = process.env.RUN_SDK_INTEGRATION === '1' && HAS_KEY;

describe.skipIf(!RUN_REAL_SDK)('sdk-pipeline (real worker)', () => {
  let sessionsRoot = '';
  let skillsRoot = '';

  beforeAll(async () => {
    sessionsRoot = await mkdtemp(path.join(os.tmpdir(), 'jchat-sdk-pipeline-sess-'));
    skillsRoot = await mkdtemp(path.join(os.tmpdir(), 'jchat-sdk-pipeline-skills-'));
    // Write a sentinel skill so skill-loader has something valid to symlink
    // (tests the full path even though we don't request it).
    const dummySkill = path.join(skillsRoot, 'dummy-skill');
    await mkdir(dummySkill, { recursive: true });
    await writeFile(path.join(dummySkill, 'SKILL.md'), '# dummy', 'utf8');
  });

  afterAll(async () => {
    await rm(sessionsRoot, { recursive: true, force: true }).catch(() => undefined);
    await rm(skillsRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it('spawns a worker and streams sdk events for a single-turn query', async () => {
    const spawner = defaultWorkerSpawner({
      sessionsRoot,
      skillsRoot,
      resolveActiveSkills: async () => []
    });
    const mgr = createWorkerManager({
      spawn: spawner,
      // Long enough that the test owns the worker's lifetime.
      idleMs: 60_000
    });

    const key = { userId: 'test-user', agentId: 'test-agent', conversationId: 'test-conv' };

    try {
      // Use the bridge.runQuery path (which calls mgr.acquire under the hood
      // via the singleton). For an isolated test we'd ideally inject our
      // mgr; instead, exercise the spawner directly + call sendCommand and
      // wire a one-off subscriber to verify the pump.
      const handle = await mgr.acquire(key);
      const messages: Array<Record<string, unknown>> = [];
      // SpawnedWorker exposes `subscribe`; cast to access it.
      const sub = (handle as unknown as {
        subscribe: (h: (m: Record<string, unknown>) => void) => () => void;
      }).subscribe;
      expect(typeof sub).toBe('function');

      const unsubscribe = sub((m) => {
        messages.push(m);
      });

      // Build the SDK single-turn user message.
      await handle.sendCommand({
        type: 'query_start',
        prompt: {
          type: 'user',
          message: { role: 'user', content: 'Reply with the single word: pong' },
          parent_tool_use_id: null,
          session_id: ''
        },
        options: {
          systemPrompt: 'You are a test fixture. Reply with exactly one word.',
          includePartialMessages: true,
          permissionMode: 'bypassPermissions',
          settingSources: ['project']
        },
        singleTurn: true
      });

      // Wait until either query_done or query_error arrives.
      const timeoutMs = 45_000;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const last = messages[messages.length - 1];
        if (last && (last.type === 'query_done' || last.type === 'query_error')) break;
        await new Promise((r) => setTimeout(r, 100));
      }

      unsubscribe();

      // We must have received at least the ready msg + some sdk_event(s) +
      // a terminal lifecycle marker.
      const types = messages.map((m) => m.type);
      const sdkEventCount = types.filter((t) => t === 'sdk_event').length;
      const done = types.includes('query_done');
      const errored = types.includes('query_error');

      // Helpful failure context.
      const errMsg = errored
        ? (messages.find((m) => m.type === 'query_error') as { error?: string }).error
        : '';

      expect(sdkEventCount, `expected sdk_events; got types=${JSON.stringify(types)} err=${errMsg}`).toBeGreaterThan(0);
      expect(done, `query did not complete cleanly; err=${errMsg}`).toBe(true);

      // Look for at least one assistant text content arriving via either
      // stream_event/text_delta or a full assistant message.
      let sawText = false;
      for (const m of messages) {
        if (m.type !== 'sdk_event') continue;
        const ev = (m as { event?: { type?: string; delta?: { type?: string; text?: string }; message?: { content?: Array<{ type: string; text?: string }> } } }).event;
        if (!ev) continue;
        if (ev.type === 'stream_event' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          sawText = true;
          break;
        }
        if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
          if (ev.message!.content.some((c) => c.type === 'text' && (c.text ?? '').length > 0)) {
            sawText = true;
            break;
          }
        }
      }
      expect(sawText, 'expected at least one text content from the SDK').toBe(true);
    } finally {
      await mgr.shutdown().catch(() => undefined);
    }
  });
});
