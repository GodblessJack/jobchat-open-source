import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDb } from '../../../mock-db.js';

vi.mock('../../../../server/lib/db.js', () => ({ db: mockDb }));

// Mock enforceConcurrency to always admit all agents (bypasses config/env dependency).
vi.mock('../../../../server/conversation/group-dispatch.js', () => ({
  enforceConcurrency: vi.fn((opts: any) => ({
    admitted: opts.targetAgentIds,
    queued: [],
  })),
  __resetConcurrencyForTest: vi.fn(),
  dispatchUserMessage: vi.fn(),
  getConcurrencySnapshot: vi.fn(() => ({ global: 0, perUser: {}, perConversation: {} })),
  releaseSlot: vi.fn(),
  extractMemoryAsync: vi.fn(),
}));

import * as orchestrator from '../../../../server/conversation/agent-reply-orchestrator.js';
import { buildSdkUserPrompt } from '../../../../server/conversation/agent-reply-orchestrator.js';
import { __resetConcurrencyForTest } from '../../../../server/conversation/group-dispatch.js';

// We import the module under test and stub `runOneAgentReply` via `_impl`
// (the indirection object that kickoffAgentReplies calls through, which allows
// vi.spyOn to intercept without fighting ES-module live-binding rules).
// The stub returns a promise that resolves after a controllable delay so we
// can prove serial vs parallel behaviour.

describe('kickoffAgentReplies serial fan-out', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset concurrency counters so leftover slot increments from a prior test
    // (mock doesn't call releaseSlot) don't bleed into the next test and cause
    // agents to be queued instead of admitted.
    __resetConcurrencyForTest();
  });

  it('awaits each agent before starting the next (serial within one round)', async () => {
    const calls: { agent: string; phase: 'start' | 'end' }[] = [];
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    vi.spyOn(orchestrator._impl, 'runOneAgentReply').mockImplementation(
      async (opts: any) => {
        calls.push({ agent: opts.agentId, phase: 'start' });
        await delay(20);
        calls.push({ agent: opts.agentId, phase: 'end' });
      }
    );

    // enforceConcurrency is wired internally — assume admitted = all 3 for
    // this case (limits are configurable; tests inject a stub if needed).
    orchestrator.kickoffAgentReplies({
      userId: 'u1',
      conversationId: 'c1',
      parentUserMessageId: 'm0',
      targetAgentIds: ['A', 'B', 'C']
    });

    // Wait long enough for all 3 to complete serially:
    // A (20ms) + 200ms stagger + B (20ms) + 200ms stagger + C (20ms) + slop
    await delay(600);

    // Expected serial trace: A.start, A.end, B.start, B.end, C.start, C.end
    expect(calls).toEqual([
      { agent: 'A', phase: 'start' },
      { agent: 'A', phase: 'end' },
      { agent: 'B', phase: 'start' },
      { agent: 'B', phase: 'end' },
      { agent: 'C', phase: 'start' },
      { agent: 'C', phase: 'end' }
    ]);
  });

  it('round-table 2nd speaker sees the prior agent reply in prompt context', async () => {
    // History at the moment Agent B starts (Agent A has just persisted its reply):
    //   [user "what should we pick?", assistant "I think Postgres because..."]
    // userText is the same user message (passed in via opts.userMessageText
    // when kickoffAgentReplies fires Agent B).
    const history = [
      { role: 'user' as const, content: 'what should we pick?' },
      { role: 'assistant' as const, content: 'I think Postgres because of JSONB.' }
    ];
    const prompt = buildSdkUserPrompt(history, 'what should we pick?');
    // The prior agent's reply MUST appear in "Conversation so far" — this is
    // the broken contract codex flagged when slice(0, -1) was unconditional.
    expect(prompt).toContain('I think Postgres because of JSONB.');
    // The framing still separates history from the current message.
    expect(prompt).toMatch(/## Conversation so far/);
    expect(prompt).toMatch(/## Current message/);
  });

  it('DM-style prompt drops the trailing user row to avoid duplicate framing', async () => {
    // History at the moment Agent A starts in a DM (or as the FIRST speaker
    // in a group): the last row IS the user's current message.
    const history = [
      { role: 'assistant' as const, content: 'older assistant turn' },
      { role: 'user' as const, content: 'hi there' }
    ];
    const prompt = buildSdkUserPrompt(history, 'hi there');
    // The older assistant turn stays in context; the trailing user row is
    // dropped because it would just duplicate `userText` below.
    expect(prompt).toContain('older assistant turn');
    // "hi there" should appear exactly once — under "## Current message".
    const occurrences = (prompt.match(/hi there/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('empty history yields the bare userText (no Conversation so far block)', () => {
    expect(buildSdkUserPrompt([], 'first turn')).toBe('first turn');
  });

  it('continues to the next agent when one throws (error isolation)', async () => {
    const order: string[] = [];
    vi.spyOn(orchestrator._impl, 'runOneAgentReply').mockImplementation(
      async (opts: any) => {
        order.push(opts.agentId);
        if (opts.agentId === 'B') throw new Error('boom');
      }
    );
    orchestrator.kickoffAgentReplies({
      userId: 'u1',
      conversationId: 'c1',
      parentUserMessageId: 'm0',
      targetAgentIds: ['A', 'B', 'C']
    });
    // Stagger is 200ms between agents: A(instant) + 200ms + B(instant) + 200ms + C(instant) = ~400ms
    await new Promise((r) => setTimeout(r, 500));
    expect(order).toEqual(['A', 'B', 'C']);
  });
});
