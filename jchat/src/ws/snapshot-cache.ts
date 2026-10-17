/**
 * Per-topic snapshot signature deduplication.
 *
 * The server sends a `signature` with every snapshot. If the same topic emits
 * the same signature twice, the second push is redundant and we can skip
 * delivering it to subscribers.
 */

export class SnapshotCache {
  private signatures = new Map<string, string>();

  /** Returns true if (topic, signature) is new and should be delivered. */
  isNew(topic: string, signature: string): boolean {
    const prev = this.signatures.get(topic);
    if (prev === signature) return false;
    this.signatures.set(topic, signature);
    return true;
  }

  /** Forget a topic's cached signature (call when unsubscribing or on reconnect). */
  forget(topic: string): void {
    this.signatures.delete(topic);
  }

  clear(): void {
    this.signatures.clear();
  }
}
