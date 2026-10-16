import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registry,
  createRun,
  getRun,
  markDone,
  markError,
  hasRunningForUser,
  __resetForTests
} from '../../../server/distillation/run-registry.js';

describe('distillation run-registry', () => {
  beforeEach(() => {
    __resetForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T10:00:00Z'));
  });

  it('createRun returns a fresh runId in running state', () => {
    const id = createRun('user-1', 'https://x.com/naval');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const run = getRun(id);
    expect(run?.status).toBe('running');
    expect(run?.userId).toBe('user-1');
    expect(run?.xUrl).toBe('https://x.com/naval');
  });

  it('hasRunningForUser is true only while there is an active run', () => {
    expect(hasRunningForUser('user-1')).toBe(false);
    const id = createRun('user-1', 'https://x.com/naval');
    expect(hasRunningForUser('user-1')).toBe(true);
    expect(hasRunningForUser('user-2')).toBe(false);
    markDone(id, { agent_id: 'a1', name: 'Naval', avatar_url: null, slug: 'naval' });
    expect(hasRunningForUser('user-1')).toBe(false);
  });

  it('markDone transitions to done with result', () => {
    const id = createRun('user-1', 'https://x.com/naval');
    markDone(id, { agent_id: 'a1', name: 'Naval', avatar_url: 'http://x/a.png', slug: 'naval' });
    const run = getRun(id);
    expect(run?.status).toBe('done');
    if (run?.status === 'done') {
      expect(run.result.agent_id).toBe('a1');
    }
  });

  it('markError transitions to error', () => {
    const id = createRun('user-1', 'https://x.com/naval');
    markError(id, 'X_UNREACHABLE', 'Could not fetch X profile');
    const run = getRun(id);
    expect(run?.status).toBe('error');
    if (run?.status === 'error') {
      expect(run.code).toBe('X_UNREACHABLE');
    }
  });

  it('completed runs are evicted after 5 minutes', () => {
    const id = createRun('user-1', 'https://x.com/naval');
    markDone(id, { agent_id: 'a1', name: 'Naval', avatar_url: null, slug: 'naval' });
    expect(getRun(id)?.status).toBe('done');
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    registry.gcSync();
    expect(getRun(id)).toBeUndefined();
  });

  it('running runs are NOT evicted even after 5 minutes', () => {
    const id = createRun('user-1', 'https://x.com/naval');
    vi.advanceTimersByTime(10 * 60 * 1000);
    registry.gcSync();
    expect(getRun(id)?.status).toBe('running');
  });
});
