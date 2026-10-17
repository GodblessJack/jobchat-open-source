import { describe, it, expect } from 'vitest';
import { BackoffTracker, RECONNECT_BACKOFF_MS } from '@/ws/reconnect';

describe('BackoffTracker', () => {
  it('returns the documented sequence then caps at 30 s', () => {
    const b = new BackoffTracker();
    const seen: number[] = [];
    for (let i = 0; i < RECONNECT_BACKOFF_MS.length + 3; i++) {
      seen.push(b.next());
    }
    expect(seen.slice(0, RECONNECT_BACKOFF_MS.length)).toEqual([...RECONNECT_BACKOFF_MS]);
    // After exhaustion, it stays at 30 s
    for (let i = RECONNECT_BACKOFF_MS.length; i < seen.length; i++) {
      expect(seen[i]).toBe(30_000);
    }
  });

  it('reset() returns to the first delay', () => {
    const b = new BackoffTracker();
    b.next();
    b.next();
    b.next();
    b.reset();
    expect(b.next()).toBe(1000);
  });
});
