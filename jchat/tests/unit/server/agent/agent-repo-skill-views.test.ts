// jchat/tests/unit/server/agent/agent-repo-skill-views.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDb, mockSelect, mockChainError } from '../../../mock-db.js';

vi.mock('../../../../server/lib/db.js', () => ({ db: mockDb }));

import { getAgentSkillViews } from '../../../../server/agent/agent-repo.js';

describe('getAgentSkillViews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select = mockSelect([]);
  });

  it('humanises slugs to title-cased product-safe labels', async () => {
    mockDb.select = mockSelect([
      { skillName: 'article-illustrator', description: 'X', sortOrder: 0 },
      { skillName: 'elon-musk', description: null, sortOrder: 1 }
    ]);
    const result = await getAgentSkillViews('agent-1');
    expect(result).toEqual([
      { slug: 'article-illustrator', name: 'Article Illustrator', description: 'X', sortOrder: 0 },
      { slug: 'elon-musk', name: 'Elon Musk', description: null, sortOrder: 1 }
    ]);
  });

  it('strips redline tokens (agent / persona / skill / worker / mate) from slugs', async () => {
    mockDb.select = mockSelect([
      { skillName: 'persona-distillation', description: null, sortOrder: 0 },
      { skillName: 'agent-skill-helper', description: null, sortOrder: 1 }
    ]);
    const result = await getAgentSkillViews('agent-1');
    expect(result[0]?.name).toBe('Distillation');
    expect(result[1]?.name).toBe('Helper');
    for (const r of result) {
      expect(r.name.toLowerCase()).not.toMatch(/\b(agent|mate|skill|worker|persona)\b/);
    }
  });

  it('returns [] on error (logs internally)', async () => {
    mockDb.select = vi.fn(() => mockChainError(new Error('boom')));
    expect(await getAgentSkillViews('agent-1')).toEqual([]);
  });

  it('returns [] when agent has no enabled skills', async () => {
    mockDb.select = mockSelect([]);
    expect(await getAgentSkillViews('agent-1')).toEqual([]);
  });
});
