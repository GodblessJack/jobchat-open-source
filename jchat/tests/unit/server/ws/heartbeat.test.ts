// jchat/tests/unit/server/ws/heartbeat.test.ts

import { describe, it, expect, vi } from 'vitest';
import { HeartbeatTracker, type HeartbeatTrackable } from '@/server/ws/heartbeat';

function fakeWs(): HeartbeatTrackable & { closed: boolean; closeCode?: number } {
  return {
    closed: false,
    closeCode: undefined,
    close(code?: number) {
      this.closed = true;
      this.closeCode = code;
    }
  };
}

describe('HeartbeatTracker', () => {
  it('does not close fresh connections', () => {
    let now = 1_000_000;
    const tracker = new HeartbeatTracker({ now: () => now, staleAfterMs: 25_000, scanIntervalMs: 5000 });
    const ws = fakeWs();
    tracker.register(ws);

    now += 10_000;
    const closed = tracker.sweep();
    expect(closed.length).toBe(0);
    expect(ws.closed).toBe(false);
    expect(tracker.size()).toBe(1);
  });

  it('closes a stale connection past staleAfterMs', () => {
    let now = 1_000_000;
    const tracker = new HeartbeatTracker({ now: () => now, staleAfterMs: 25_000 });
    const ws = fakeWs();
    tracker.register(ws);

    now += 30_000; // > 25s since register
    const closed = tracker.sweep();
    expect(closed).toContain(ws);
    expect(ws.closed).toBe(true);
    expect(ws.closeCode).toBe(1011);
    expect(tracker.size()).toBe(0);
  });

  it('touch() resets the lastSeen timer', () => {
    let now = 1_000_000;
    const tracker = new HeartbeatTracker({ now: () => now, staleAfterMs: 25_000 });
    const ws = fakeWs();
    tracker.register(ws);

    now += 20_000;
    tracker.touch(ws);
    now += 20_000; // 20s since touch, NOT 40s since register
    const closed = tracker.sweep();
    expect(closed.length).toBe(0);
    expect(ws.closed).toBe(false);
  });

  it('start() schedules sweeps via injected setInterval', () => {
    const setIntervalMock = vi.fn();
    const clearIntervalMock = vi.fn();
    const tracker = new HeartbeatTracker({
      now: () => 0,
      scanIntervalMs: 5000,
      setInterval: setIntervalMock,
      clearInterval: clearIntervalMock
    });
    tracker.start();
    expect(setIntervalMock).toHaveBeenCalledTimes(1);
    expect(setIntervalMock.mock.calls[0]?.[1]).toBe(5000);
    // Idempotent
    tracker.start();
    expect(setIntervalMock).toHaveBeenCalledTimes(1);
  });

  it('unregister stops tracking', () => {
    let now = 1_000_000;
    const tracker = new HeartbeatTracker({ now: () => now, staleAfterMs: 25_000 });
    const ws = fakeWs();
    tracker.register(ws);
    tracker.unregister(ws);

    now += 60_000;
    const closed = tracker.sweep();
    expect(closed.length).toBe(0);
    expect(ws.closed).toBe(false);
  });

  it('sweep handles multiple connections at different ages', () => {
    let now = 1_000_000;
    const tracker = new HeartbeatTracker({ now: () => now, staleAfterMs: 25_000 });
    const a = fakeWs();
    const b = fakeWs();
    const c = fakeWs();
    tracker.register(a);
    tracker.register(b);

    now += 10_000;
    tracker.register(c);

    now += 20_000; // a,b are 30s old; c is 20s old
    const closed = tracker.sweep();
    expect(closed.length).toBe(2);
    expect(closed).toContain(a);
    expect(closed).toContain(b);
    expect(c.closed).toBe(false);
    expect(tracker.size()).toBe(1);
  });
});
