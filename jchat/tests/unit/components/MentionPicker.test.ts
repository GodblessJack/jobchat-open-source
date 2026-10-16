import { describe, it, expect } from 'vitest';
import { filterCandidates, type MentionCandidate } from '@/components/group/MentionPicker';

const sample: MentionCandidate[] = [
  { agentId: 'a1', name: 'Alex', description: 'Rednote Assistant' },
  { agentId: 'a2', name: 'Elon', description: 'AI 研究员' },
  { agentId: 'a3', name: 'Lisa', description: '面试专家' },
  { agentId: 'a4', name: 'Sam', description: 'Interview Coach' }
];

describe('MentionPicker.filterCandidates', () => {
  it('returns the first 10 candidates when the query is empty', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      agentId: `id-${i}`,
      name: `Name${i}`,
      description: ''
    }));
    expect(filterCandidates(eleven, '').length).toBe(10);
  });

  it('matches case-insensitively on name', () => {
    expect(filterCandidates(sample, 'el').map(c => c.agentId)).toEqual(['a2']);
    expect(filterCandidates(sample, 'EL').map(c => c.agentId)).toEqual(['a2']);
  });

  it('returns empty when no candidate matches', () => {
    expect(filterCandidates(sample, 'zzz')).toEqual([]);
  });

  it('caps results at 10 even with a matching query', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      agentId: `id-${i}`,
      name: `Match${i}`,
      description: ''
    }));
    expect(filterCandidates(many, 'match').length).toBe(10);
  });

});
