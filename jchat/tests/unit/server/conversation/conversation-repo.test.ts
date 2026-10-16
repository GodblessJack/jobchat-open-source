// jchat/tests/unit/server/conversation/conversation-repo.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockChain } from '../../../mock-db.js';

const USER = '00000000-0000-0000-0000-000000000099';
const AGENT_A = '11111111-1111-1111-1111-111111111111';
const AGENT_B = '22222222-2222-2222-2222-222222222222';

interface ConvRow {
  id: string; userId: string; type: 'dm' | 'group'; title: string | null;
  archivedAt: Date | null; deletedAt: Date | null; createdAt: Date; updatedAt: Date;
}
interface MemberRow {
  conversationId: string; agentId: string; role: 'member' | 'moderator';
  joinedAt: Date; position: number;
}

const fakeDb = { conversations: [] as ConvRow[], members: [] as MemberRow[] };
let nextConvId = 1;

function resetDb() { fakeDb.conversations = []; fakeDb.members = []; nextConvId = 1; }

function makeDate(iso: string) { return new Date(iso); }

// Mutable function references — reassigned in beforeEach per test.
// vi.mock is hoisted, so we use var.
var mockSelectFn: any = vi.fn(() => mockChain([]));
var mockInsertFn: any = vi.fn(() => ({ values: vi.fn(() => mockChain([{}])), onConflictDoUpdate: vi.fn(() => ({ set: vi.fn(() => mockChain(undefined)) })) }));
var mockUpdateFn: any = vi.fn(() => mockChain(undefined));
var mockExecuteFn: any = vi.fn(() => mockChain({ rows: [] }));

// Wrapper functions dereference the var on each call, so beforeEach reassignments work.
function wrapSelect(a: any) { return mockSelectFn(a); }
function wrapInsert(a: any) { return mockInsertFn(a); }
function wrapUpdate(a: any) { return mockUpdateFn(a); }
function wrapExecute(a: any) { return mockExecuteFn(a); }

vi.mock('../../../../server/lib/db.js', () => ({
  db: {
    select: wrapSelect,
    insert: wrapInsert,
    update: wrapUpdate,
    delete: () => mockChain(undefined),
    execute: wrapExecute,
    transaction: (cb: any) => cb({
      select: wrapSelect,
      insert: wrapInsert,
      update: wrapUpdate,
      delete: () => mockChain(undefined),
      execute: wrapExecute,
    }),
  }
}));

import { findOrCreateDm } from '../../../../server/conversation/conversation-repo.js';

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  mockSelectFn = vi.fn(() => mockChain([]));
  mockInsertFn = vi.fn(() => ({ values: vi.fn(() => mockChain([{}])), onConflictDoUpdate: vi.fn(() => ({ set: vi.fn(() => mockChain(undefined)) })) }));
  mockUpdateFn = vi.fn(() => mockChain(undefined));
  mockExecuteFn = vi.fn(() => mockChain({ rows: [] }));
});

afterEach(() => vi.clearAllMocks());

describe('findOrCreateDm', () => {
  it('creates a new DM when no existing one matches', async () => {
    let selectCall = 0;
    mockSelectFn = vi.fn(() => {
      selectCall++;
      if (selectCall === 1) return mockChain([]); // No existing DMs
      if (selectCall === 2) return mockChain([{ id: AGENT_A }]); // Agent exists verification
      if (selectCall === 3) return mockChain([]); // No direct user_agents visibility row
      if (selectCall === 4) return mockChain([{ id: AGENT_A }]); // Shared-agent visibility
      return mockChain([]); // loadMembers returns empty
    });

    mockInsertFn = vi.fn((_table: any) => {
      return {
        values: vi.fn((row: any) => {
          if (row.userId) {
            const id = `conv-${nextConvId++}`;
            fakeDb.conversations.push({
              id, userId: row.userId, type: row.type || 'dm', title: row.title ?? null,
              archivedAt: null, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
            });
            return {
              returning: vi.fn(() => mockChain([{
                id, userId: row.userId, type: row.type || 'dm', title: row.title ?? null,
                archivedAt: null, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
              }])),
            };
          }
          const rows = Array.isArray(row) ? row : [row];
          for (const m of rows) {
            fakeDb.members.push({
              conversationId: m.conversationId, agentId: m.agentId,
              role: m.role || 'member', joinedAt: new Date(), position: m.position ?? 0,
            });
          }
          return mockChain(rows);
        }),
        onConflictDoUpdate: vi.fn(() => ({ set: vi.fn(() => mockChain(undefined)) })),
      };
    });

    const conv = await findOrCreateDm(USER, AGENT_A);
    expect(conv.id).toBeTruthy();
    expect(conv.type).toBe('dm');
    expect(conv.userId).toBe(USER);
  });

  it('returns the existing DM when a matching one exists', async () => {
    let selectCall = 0;
    mockSelectFn = vi.fn(() => {
      selectCall++;
      if (selectCall === 1) {
        return mockChain([{
          id: 'conv-existing', userId: USER, type: 'dm', title: null,
          archivedAt: null, deletedAt: null,
          createdAt: makeDate('2026-04-01T00:00:00Z'), updatedAt: makeDate('2026-04-26T00:00:00Z'),
        }])();
      }
      return mockChain([{
        conversationId: 'conv-existing', agentId: AGENT_A, role: 'member',
        joinedAt: makeDate('2026-04-01T00:00:00Z'), position: 0,
      }])();
    });

    const conv = await findOrCreateDm(USER, AGENT_A);
    expect(conv.id).toBe('conv-existing');
  });

  it('does NOT match a DM that has a different agent', async () => {
    let selectCall = 0;
    mockSelectFn = vi.fn(() => {
      selectCall++;
      if (selectCall === 1) {
        return mockChain([{
          id: 'conv-other-agent', userId: USER, type: 'dm', title: null,
          archivedAt: null, deletedAt: null,
          createdAt: makeDate('2026-04-01T00:00:00Z'), updatedAt: makeDate('2026-04-26T00:00:00Z'),
        }])();
      }
      if (selectCall === 2) {
        return mockChain([{
          conversationId: 'conv-other-agent', agentId: AGENT_B, role: 'member',
          joinedAt: makeDate('2026-04-01T00:00:00Z'), position: 0,
        }])();
      }
      if (selectCall === 3) return mockChain([{ id: AGENT_A }])(); // Agent exists verification
      if (selectCall === 4) return mockChain([])(); // No direct user_agents visibility row
      if (selectCall === 5) return mockChain([{ id: AGENT_A }])(); // Shared-agent visibility
      return mockChain([])();
    });

    mockInsertFn = vi.fn((_table: any) => {
      return {
        values: vi.fn((row: any) => {
          if (row.userId) {
            const id = `conv-${nextConvId++}`;
            return {
              returning: vi.fn(() => mockChain([{
                id, userId: row.userId, type: 'dm', title: row.title ?? null,
                archivedAt: null, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
              }])),
            };
          }
          return mockChain(Array.isArray(row) ? row : [row]);
        }),
        onConflictDoUpdate: vi.fn(() => ({ set: vi.fn(() => mockChain(undefined)) })),
      };
    });

    const conv = await findOrCreateDm(USER, AGENT_A);
    expect(conv.id).not.toBe('conv-other-agent');
  });

  it('returns the most recently updated match when legacy duplicates exist', async () => {
    let selectCall = 0;
    mockSelectFn = vi.fn(() => {
      selectCall++;
      if (selectCall === 1) {
        return mockChain([
          {
            id: 'conv-newer', userId: USER, type: 'dm', title: null,
            archivedAt: null, deletedAt: null,
            createdAt: makeDate('2026-04-02T00:00:00Z'), updatedAt: makeDate('2026-04-26T00:00:00Z'),
          },
          {
            id: 'conv-old', userId: USER, type: 'dm', title: null,
            archivedAt: null, deletedAt: null,
            createdAt: makeDate('2026-04-01T00:00:00Z'), updatedAt: makeDate('2026-04-10T00:00:00Z'),
          },
        ])();
      }
      return mockChain([
        { conversationId: 'conv-newer', agentId: AGENT_A, role: 'member', joinedAt: makeDate('2026-04-02T00:00:00Z'), position: 0 },
        { conversationId: 'conv-old', agentId: AGENT_A, role: 'member', joinedAt: makeDate('2026-04-01T00:00:00Z'), position: 0 },
      ])();
    });

    const conv = await findOrCreateDm(USER, AGENT_A);
    expect(conv.id).toBe('conv-newer');
  });
});
