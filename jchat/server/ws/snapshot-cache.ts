// jchat/server/ws/snapshot-cache.ts
//
// Per-client snapshot signature cache. Used for dedup: when a topic's data
// changes we compute sha256(JSON.stringify(data)) and compare against the
// signature we last sent on this socket. If unchanged we skip the send.
//
// Spec §6.2:
//   "subscribe ack 携带【首份】snapshot；之后该 topic 的所有更新通过 §6.3 的独立
//    `snapshot` event 推送"
//
// This module owns:
//   - signature computation (`computeSignature`)
//   - per-client topic→signature map (`SnapshotCache`)
//
// It does NOT do any I/O. The router reads/writes the cache around `ws.send`.

import { createHash } from 'node:crypto';
import { JchatError, ErrorCodes } from '@shared/errors.js';

/** Stable JSON stringify so object key order doesn't perturb the hash. */
function stableStringify(value: unknown, seen: WeakSet<object> = new WeakSet()): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (seen.has(value as object)) {
    throw new JchatError(ErrorCodes.INTERNAL_ERROR, 'Circular reference detected in snapshot data');
  }
  seen.add(value as object);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v, seen)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const result = '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k], seen)).join(',') + '}';
  seen.delete(value as object);
  return result;
}

/** Compute the canonical signature string for a snapshot data payload. */
export function computeSignature(data: unknown): string {
  return createHash('sha256').update(stableStringify(data)).digest('hex');
}

/**
 * Per-client signature cache. One instance per WS connection.
 *
 * Methods:
 *   - `shouldSend(topic, signature)` → true if signature differs from last sent.
 *     The check is read-only; call `record` after a successful send.
 *   - `record(topic, signature)` → mark signature as last sent.
 *   - `forget(topic)` → remove on unsubscribe.
 *   - `clear()` → reset all (e.g. on disconnect).
 */
export class SnapshotCache {
  private readonly map = new Map<string, string>();

  shouldSend(topic: string, signature: string): boolean {
    return this.map.get(topic) !== signature;
  }

  record(topic: string, signature: string): void {
    this.map.set(topic, signature);
  }

  forget(topic: string): void {
    this.map.delete(topic);
  }

  has(topic: string): boolean {
    return this.map.has(topic);
  }

  size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}
