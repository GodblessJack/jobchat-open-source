// jchat/server/ws/heartbeat.ts
//
// Server-side heartbeat tracker.
//
// Spec §8.2:
//   - Client pings every 15s; server replies pong immediately.
//   - Server runs a sweep every 5s and closes any connection whose last-seen
//     timestamp is older than `staleAfterMs` (default 25s = 25000).
//
// This module is transport-agnostic: it works on any object that exposes
// `close()`. The actual `ws.send('system.pong')` is performed by the router
// when it sees a `system.ping` envelope — keeping I/O out of this module
// makes it trivially testable with fake timers.

export interface HeartbeatTrackable {
  close(code?: number, reason?: string): void;
}

export interface HeartbeatOptions {
  /** How often to scan for stale connections (ms). Default 5000. */
  scanIntervalMs?: number;
  /** Max age of last-seen before a connection is considered stale. Default 25000. */
  staleAfterMs?: number;
  /** Injectable clock — pure for testing. Default `Date.now`. */
  now?: () => number;
  /** Injectable timer — pure for testing. Default `setInterval`. */
  setInterval?: (cb: () => void, ms: number) => NodeJS.Timeout | number;
  /** Injectable timer cancel. Default `clearInterval`. */
  clearInterval?: (handle: NodeJS.Timeout | number) => void;
}

interface Entry<T extends HeartbeatTrackable> {
  ws: T;
  lastSeenMs: number;
}

export class HeartbeatTracker<T extends HeartbeatTrackable = HeartbeatTrackable> {
  private readonly entries = new Map<T, Entry<T>>();
  private readonly scanIntervalMs: number;
  private readonly staleAfterMs: number;
  private readonly now: () => number;
  private readonly setIntervalImpl: (cb: () => void, ms: number) => NodeJS.Timeout | number;
  private readonly clearIntervalImpl: (handle: NodeJS.Timeout | number) => void;
  private timer: NodeJS.Timeout | number | null = null;

  constructor(opts: HeartbeatOptions = {}) {
    this.scanIntervalMs = opts.scanIntervalMs ?? 5000;
    this.staleAfterMs = opts.staleAfterMs ?? 25000;
    this.now = opts.now ?? Date.now;
    this.setIntervalImpl = opts.setInterval ?? ((cb, ms) => setInterval(cb, ms));
    this.clearIntervalImpl = opts.clearInterval ?? ((h) => clearInterval(h as NodeJS.Timeout));
  }

  /** Register a new connection. Call on `wss` upgrade. */
  register(ws: T): void {
    this.entries.set(ws, { ws, lastSeenMs: this.now() });
  }

  /** Unregister on `ws.close`. */
  unregister(ws: T): void {
    this.entries.delete(ws);
  }

  /** Bump last-seen on any incoming frame (ping or otherwise). */
  touch(ws: T): void {
    const entry = this.entries.get(ws);
    if (entry) entry.lastSeenMs = this.now();
  }

  /** Start the periodic sweep. Idempotent. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = this.setIntervalImpl(() => this.sweep(), this.scanIntervalMs);
    if (typeof (this.timer as NodeJS.Timeout)?.unref === 'function') {
      (this.timer as NodeJS.Timeout).unref();
    }
  }

  /** Stop the periodic sweep. Idempotent. */
  stop(): void {
    if (this.timer === null) return;
    this.clearIntervalImpl(this.timer);
    this.timer = null;
  }

  /** Number of currently tracked connections. */
  size(): number {
    return this.entries.size;
  }

  /**
   * Run one sweep. Closes stale connections (>= staleAfterMs since last touch)
   * and returns the list of connections that were closed (useful for tests).
   */
  sweep(): T[] {
    const cutoff = this.now() - this.staleAfterMs;
    const closed: T[] = [];
    for (const entry of this.entries.values()) {
      if (entry.lastSeenMs <= cutoff) {
        try {
          entry.ws.close(1011, 'stale-connection');
        } catch {
          // ignore — close failures still mean we evict
        }
        this.entries.delete(entry.ws);
        closed.push(entry.ws);
      }
    }
    return closed;
  }
}
