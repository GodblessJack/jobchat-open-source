import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDb, mockSelect, mockChainError } from '../../../mock-db.js';

vi.mock('../../../../server/lib/db.js', () => ({ db: mockDb }));

import { getActiveSkillsForAgent, type ActiveSkill } from '../../../../server/agent/agent-repo.js';

describe('getActiveSkillsForAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select = mockSelect([]);
  });

  it('returns ActiveSkill[] with name and inline_content', async () => {
    mockDb.select = mockSelect([
      { skillName: 'contact-recommender', inlineContent: null },
      { skillName: 'naval', inlineContent: '---\nname: naval\n---\n# Identity' },
    ]);

    const result = await getActiveSkillsForAgent('agent-uuid');

    expect(result).toEqual<ActiveSkill[]>([
      { name: 'contact-recommender', inline_content: null },
      { name: 'naval', inline_content: '---\nname: naval\n---\n# Identity' },
    ]);
  });

  it('returns empty array on error', async () => {
    // The source code catches errors and returns []
    mockDb.select = vi.fn(() => mockChainError(new Error('fail')));

    const result = await getActiveSkillsForAgent('agent-uuid');
    expect(result).toEqual([]);
  });

  it('returns empty array when data is empty', async () => {
    mockDb.select = mockSelect([]);
    expect(await getActiveSkillsForAgent('agent-uuid')).toEqual([]);
  });
});
