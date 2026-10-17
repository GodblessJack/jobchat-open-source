import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDb, mockSelect } from '../../../mock-db.js';

vi.mock('../../../../server/lib/db.js', () => ({ db: mockDb }));

import { getAgent } from '../../../../server/agent/agent-repo.js';

describe('getAgent — identity & bootstrap_md', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select = mockSelect([]);
  });

  it('returns identity jsonb and bootstrap_md when present', async () => {
    // getAgent makes 2 select calls:
    // 1. select agent from agents table
    // 2. select skills from agent_skills table (inside getActiveSkillsForAgent)
    let callIdx = 0;
    mockDb.select = vi.fn(() => {
      callIdx++;
      if (callIdx === 1) {
        return mockSelect([{
          id: 'a1', name: 'Feynman', role: null, avatarUrl: null,
          personaDescription: null, initialMessage: null, isDefault: false,
          identity: { emoji: '🔬', self_address: '我' },
          bootstrapMd: null,
        }])();
      }
      return mockSelect([])();
    });

    const detail = await getAgent('a1');
    expect(detail?.identity).toEqual({ emoji: '🔬', self_address: '我' });
    expect(detail?.bootstrapMd).toBeNull();
  });
});
