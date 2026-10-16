// jchat/tests/unit/server/conversation/group-dispatch.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../mock-db.js';

// ===== mock dependencies BEFORE importing the SUT =====

vi.mock('../../../../server/lib/db.js', () => ({ db: mockDb }));

// Override config env values for deterministic test behavior.
vi.mock('../../../../server/config.js', () => ({
  config: {
    concurrentAgentsPerConv: 20,
    concurrentAgentsPerUser: 20,
    globalWorkerLimit: 60,
  }
}));

vi.mock('../../../../server/conversation/conversation-repo.js', () => ({
  getConversationMembers: vi.fn(async () => [])
}));

vi.mock('../../../../server/conversation/messages-repo.js', () => ({
  appendMessage: vi.fn(async (input: { conversationId: string }) => ({
    id: 'msg-' + Math.random().toString(36).slice(2),
    conversationId: input.conversationId,
    senderType: 'user',
    senderId: 'u',
    content: '',
    deliveryStatus: 'final',
    createdAt: new Date().toISOString()
  })),
  appendToolCall: vi.fn(async () => {}),
  updateMessageContent: vi.fn(async () => {}),
  updateMessageStatus: vi.fn(async () => {})
}));

import * as convRepo from '@/server/conversation/conversation-repo.js';
import {
  __resetConcurrencyForTest,
  dispatchUserMessage,
  enforceConcurrency,
  getConcurrencySnapshot,
  releaseSlot
} from '@/server/conversation/group-dispatch.js';

const USER = '00000000-0000-0000-0000-000000000099';
const CONV = '00000000-0000-0000-0000-0000000000aa';
const ZHANG = '11111111-1111-1111-1111-111111111111';
const LI = '22222222-2222-2222-2222-222222222222';
const ELON = '33333333-3333-3333-3333-333333333333';

const memberRows = [
  { conversationId: CONV, agentId: ZHANG, role: 'member' as const, joinedAt: '', position: 0 },
  { conversationId: CONV, agentId: LI,    role: 'member' as const, joinedAt: '', position: 1 },
  { conversationId: CONV, agentId: ELON,  role: 'member' as const, joinedAt: '', position: 2 }
];
const nameLookup = async () =>
  new Map([
    [ZHANG, '张三'],
    [LI, '李四'],
    [ELON, 'Elon']
  ]);

beforeEach(() => {
  vi.mocked(convRepo.getConversationMembers).mockResolvedValue(memberRows);
  __resetConcurrencyForTest();
});
afterEach(() => vi.clearAllMocks());

describe('dispatchUserMessage — mention -> targets (steps 3-5)', () => {
  it('no @ -> no agents targeted (empty dispatch)', async () => {
    const r = await dispatchUserMessage(
      { userId: USER, conversationId: CONV, payload: { content: 'just thinking' } },
      nameLookup
    );
    expect(r.targetAgentIds).toEqual([]);
  });

  it('single @ resolves to that one agent only', async () => {
    const r = await dispatchUserMessage(
      { userId: USER, conversationId: CONV, payload: { content: '@张三 hi' } },
      nameLookup
    );
    expect(r.targetAgentIds).toEqual([ZHANG]);
  });

  it('multi-mention deduped & members-list-ordered', async () => {
    const r = await dispatchUserMessage(
      { userId: USER, conversationId: CONV, payload: { content: '@李四 @张三 ping' } },
      nameLookup
    );
    expect(r.targetAgentIds).toEqual([ZHANG, LI]);
  });

  it('@nonmember unrecognised → no agents targeted', async () => {
    // @王五 is not a member, parseMentions returns {mentions:[], isExplicitAll:false} → no dispatch.
    const r = await dispatchUserMessage(
      { userId: USER, conversationId: CONV, payload: { content: '@王五 hi' } },
      nameLookup
    );
    expect(r.targetAgentIds).toEqual([]);
  });

  it('rejects empty content with no attachments', async () => {
    await expect(
      dispatchUserMessage(
        { userId: USER, conversationId: CONV, payload: { content: '' } },
        nameLookup
      )
    ).rejects.toThrow();
  });

  it('passes mentions to appendMessage', async () => {
    const messages = await import('@/server/conversation/messages-repo.js');
    const spy = vi.mocked(messages.appendMessage);
    spy.mockClear();
    await dispatchUserMessage(
      { userId: USER, conversationId: CONV, payload: { content: '@张三 hi' } },
      nameLookup
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].mentions).toEqual([ZHANG]);
    expect(spy.mock.calls[0]![0].senderType).toBe('user');
  });

  it('@all stores full member IDs in mentions column for DB traceability', async () => {
    const messages = await import('@/server/conversation/messages-repo.js');
    const spy = vi.mocked(messages.appendMessage);
    spy.mockClear();
    await dispatchUserMessage(
      { userId: USER, conversationId: CONV, payload: { content: '@all 大家好' } },
      nameLookup
    );
    expect(spy).toHaveBeenCalledTimes(1);
    // @all stores the full member ID list (not empty array) for unambiguous DB audit.
    expect(spy.mock.calls[0]![0].mentions).toEqual([ZHANG, LI, ELON]);
  });
});

describe('enforceConcurrency — limit gating (steps 6-7)', () => {
  it('admits all when under limits', () => {
    const d = enforceConcurrency({ userId: USER, conversationId: CONV, targetAgentIds: [ZHANG, LI] });
    expect(d.admitted).toEqual([ZHANG, LI]);
    expect(d.queued).toEqual([]);
    const snap = getConcurrencySnapshot();
    expect(snap.global).toBe(2);
    expect(snap.perUser[USER]).toBe(2);
    expect(snap.perConversation[CONV]).toBe(2);
  });

  it('queues over per-user limit (default 20 — matches groupMemberLimit so a max group can fan out)', () => {
    // Pre-fill the user counter to the per-user cap by admitting against a
    // different conv first. The cap was raised from 5 to 20 alongside the
    // round-table redesign so a max-sized group (groupMemberLimit=20) can
    // fully serial-fan-out for a single user.
    const otherConv = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const fillerAgents = Array.from({ length: 20 }, (_, i) => `a${i + 1}`);
    enforceConcurrency({
      userId: USER,
      conversationId: otherConv,
      targetAgentIds: fillerAgents
    });
    const d = enforceConcurrency({ userId: USER, conversationId: CONV, targetAgentIds: [ZHANG] });
    expect(d.admitted).toEqual([]);
    expect(d.queued).toEqual([ZHANG]);
    expect(d.reason).toMatch(/per-user/);
  });

  it('releaseSlot() decrements counters', () => {
    enforceConcurrency({ userId: USER, conversationId: CONV, targetAgentIds: [ZHANG] });
    expect(getConcurrencySnapshot().global).toBe(1);
    releaseSlot(USER, CONV);
    expect(getConcurrencySnapshot().global).toBe(0);
    expect(getConcurrencySnapshot().perUser[USER] ?? 0).toBe(0);
  });

  it('queues over per-conversation limit (default 20)', () => {
    const otherUserA = 'a0000000-0000-0000-0000-000000000001';
    const otherUserB = 'a0000000-0000-0000-0000-000000000002';
    // Saturate the conversation counter via two other users — each contributes
    // a chunk that stays under their per-user limit. Together they fill the
    // per-conv cap (20).
    const half = 10;
    enforceConcurrency({
      userId: otherUserA,
      conversationId: CONV,
      targetAgentIds: Array.from({ length: half }, (_, i) => `za${i + 1}`)
    });
    enforceConcurrency({
      userId: otherUserB,
      conversationId: CONV,
      targetAgentIds: Array.from({ length: half }, (_, i) => `zb${i + 1}`)
    });
    expect(getConcurrencySnapshot().perConversation[CONV]).toBe(20);
    const d = enforceConcurrency({ userId: USER, conversationId: CONV, targetAgentIds: [ZHANG] });
    expect(d.admitted).toEqual([]);
    expect(d.queued).toEqual([ZHANG]);
    expect(d.reason).toMatch(/per-conv/);
  });
});

describe('round-table dispatch decision', () => {
  it('no @ in group → no agents targeted', async () => {
    const nameLookupLocal = async (ids: string[]) =>
      new Map(ids.map(id => {
        const namesByAgentId: Record<string, string> = {
          [ZHANG]: '张三',
          [LI]: '李四',
          [ELON]: 'Elon'
        };
        return [id, namesByAgentId[id] ?? id] as [string, string];
      }));

    const result = await dispatchUserMessage(
      { userId: USER, conversationId: CONV, payload: { content: 'hello team' } },
      nameLookupLocal
    );
    expect(result.targetAgentIds).toEqual([]); // no mention → no reply
  });

  it('@Alice in group → only Alice targeted', async () => {
    // Map ZHANG as "Alice" for this test to match the plan snippet literally.
    const nameLookupLocal = async (ids: string[]) =>
      new Map(ids.map(id => {
        const namesByAgentId: Record<string, string> = {
          [ZHANG]: 'Alice',
          [LI]: '李四',
          [ELON]: 'Elon'
        };
        return [id, namesByAgentId[id] ?? id] as [string, string];
      }));
    vi.mocked(convRepo.getConversationMembers).mockResolvedValue(memberRows);

    const result = await dispatchUserMessage(
      { userId: USER, conversationId: CONV, payload: { content: '@Alice 你看看' } },
      nameLookupLocal
    );
    expect(result.targetAgentIds).toEqual([ZHANG]);
  });

  it('@all in group → all members (isExplicitAll triggers fan-out)', async () => {
    const nameLookupLocal = async (ids: string[]) =>
      new Map(ids.map(id => {
        const namesByAgentId: Record<string, string> = {
          [ZHANG]: '张三',
          [LI]: '李四',
          [ELON]: 'Elon'
        };
        return [id, namesByAgentId[id] ?? id] as [string, string];
      }));

    const result = await dispatchUserMessage(
      { userId: USER, conversationId: CONV, payload: { content: '@all 看一下' } },
      nameLookupLocal
    );
    expect(result.targetAgentIds).toEqual([ZHANG, LI, ELON]);
  });
});
