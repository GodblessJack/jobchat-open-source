/**
 * Exponential backoff helper for WS reconnection.
 *
 * Step sequence: [1, 2, 4, 8, 16, 30] seconds — matches §5.3 / §8.2 of spec.
 */

export const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;

export class BackoffTracker {
  private attempt = 0;

  /** Get the delay (ms) for the next reconnect attempt and advance the counter. */
  next(): number {
    const idx = Math.min(this.attempt, RECONNECT_BACKOFF_MS.length - 1);
    const delay = RECONNECT_BACKOFF_MS[idx];
    this.attempt += 1;
    return delay;
  }

  /** Reset after a successful connection. */
  reset(): void {
    this.attempt = 0;
  }

  /** Current attempt counter (0 = no attempts made). */
  get count(): number {
    return this.attempt;
  }
}
