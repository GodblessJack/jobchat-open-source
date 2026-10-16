// jchat/server/ws/ws-router.ts
//
// Main WS router. One instance per server process. Owns:
//   - per-client state (auth context, snapshot signature cache, subscriptions)
//   - subscription book: topic → Set<client>
//   - signature dedup: only re-sends snapshots when data actually changed
//   - command dispatch via `CommandDispatcher`
//   - heartbeat handling (`system.ping` → `system.pong`, plus stale eviction)
//   - graceful close
//
// This module is transport-agnostic with respect to the `ws` library:
// it accepts anything that exposes `send`, `close`, and `on('message'|'close')`.
// `server/index.ts` wires it to `WebSocketServer`.

import { randomUUID } from 'node:crypto';
import { JchatError, ErrorCodes, toErrorPayload } from '@shared/errors.js';
import type { ClientEnvelope, ServerEnvelope } from '@shared/protocol.js';
import { parseEnvelope, serializeEnvelope } from './envelope.js';
import { SnapshotCache, computeSignature } from './snapshot-cache.js';
import { HeartbeatTracker } from './heartbeat.js';
import { CommandDispatcher, type WsAuthContext } from './command-dispatcher.js';
import { isJwtExpired } from '../auth/jwt-verify.js';

// ----- WS abstraction (subset of `ws.WebSocket` we use) -----
//
// Keeping this narrow lets unit tests pass a plain object instead of pulling
// in a real socket. The runtime `WebSocket` from `ws` satisfies it.

export interface WsLike {
  readyState?: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: () => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
}

export interface SnapshotSource {
  /**
   * Compute the current snapshot data for a given (userId, topic). Returns
   * `null` if the user is not authorized for that topic (router will reply
   * `AUTH_FORBIDDEN`).
   *
   * Implementations live in sibling repos (contacts/conversation/etc.) and
   * are wired in via `WsRouter.registerSnapshotSource`. We DO NOT hard-code
   * snapshot logic here — the router is a generic broker.
   */
  load(userId: string, topic: string): Promise<unknown> | unknown;
}

interface ClientState {
  ws: WsLike;
  clientId: string;
  auth: WsAuthContext;
  cache: SnapshotCache;
  subscriptions: Set<string>;
}

export interface WsRouterOptions {
  heartbeat?: HeartbeatTracker<WsLike>;
  dispatcher?: CommandDispatcher;
  /**
   * Optional logger. Falls back to console-like no-op silence so this module
   * stays usable in unit tests.
   */
  log?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
  /**
   * Mid-session token-expiry probe. Defaults to {@link isJwtExpired} which
   * inspects the JWT `exp` claim locally. Tests inject `() => false` so they
   * can use placeholder JWT strings without forging a valid signature.
   */
  isJwtExpired?: (jwt: string) => boolean;
}

export class WsRouter {
  private readonly clients = new Map<WsLike, ClientState>();
  /** topic → set of clients subscribed. */
  private readonly topicIndex = new Map<string, Set<WsLike>>();
  /** userId → set of clients (used for fan-out to other tabs of same user). */
  private readonly usersIndex = new Map<string, Set<WsLike>>();
  private readonly snapshotSources = new Map<string, SnapshotSource>();
  private readonly dispatcher: CommandDispatcher;
  private readonly heartbeat: HeartbeatTracker<WsLike>;
  private readonly log: NonNullable<WsRouterOptions['log']>;
  private readonly jwtExpiryCheck: (jwt: string) => boolean;

  constructor(opts: WsRouterOptions = {}) {
    this.dispatcher = opts.dispatcher ?? new CommandDispatcher();
    this.heartbeat = opts.heartbeat ?? new HeartbeatTracker<WsLike>();
    this.log = opts.log ?? { info: () => {}, warn: () => {}, error: () => {} };
    this.jwtExpiryCheck = opts.isJwtExpired ?? isJwtExpired;
  }

  // ---------- Public API ----------

  /**
   * Register a snapshot source for a topic prefix.
   *
   * - Static topics like `'contacts'` or `'presence'` register the exact name.
   * - Parameterized topics like `'conversation:<id>'` register the prefix
   *   (`'conversation'` — everything before the first colon). Matching is
   *   prefix-based with `':'` as the separator.
   */
  registerSnapshotSource(topicPrefix: string, source: SnapshotSource): void {
    this.snapshotSources.set(topicPrefix, source);
  }

  /** Attach a freshly upgraded WS connection. */
  attach(ws: WsLike, auth: WsAuthContext): void {
    const clientId = randomUUID();
    const state: ClientState = {
      ws,
      clientId,
      auth,
      cache: new SnapshotCache(),
      subscriptions: new Set()
    };
    this.clients.set(ws, state);
    let usersSet = this.usersIndex.get(auth.userId);
    if (!usersSet) {
      usersSet = new Set();
      this.usersIndex.set(auth.userId, usersSet);
    }
    usersSet.add(ws);
    this.heartbeat.register(ws);

    ws.on('message', (data) => {
      this.heartbeat.touch(ws);
      this.handleMessage(state, data).catch((err) => {
        this.log.error({ err }, 'unhandled WS message error');
      });
    });
    ws.on('close', () => this.detach(ws));
    ws.on('error', (err) => {
      this.log.warn({ err: err.message }, 'WS error');
    });
  }

  /** Detach a closed connection. Idempotent. */
  detach(ws: WsLike): void {
    const state = this.clients.get(ws);
    if (!state) return;
    for (const topic of state.subscriptions) {
      this.removeFromTopic(topic, ws);
    }
    state.cache.clear();
    this.clients.delete(ws);
    const usersSet = this.usersIndex.get(state.auth.userId);
    if (usersSet) {
      usersSet.delete(ws);
      if (usersSet.size === 0) this.usersIndex.delete(state.auth.userId);
    }
    this.heartbeat.unregister(ws);
  }

  /**
   * Broadcast that a topic's data changed. The router recomputes the
   * snapshot for each subscribed client, deduplicates by signature, and
   * sends only when the signature differs.
   *
   * Snapshot data may differ per user (e.g. contacts list is user-scoped),
   * so we re-load per client.
   *
   * Debounced per-topic: rapid-fire calls (e.g. during agent streaming with
   * PG NOTIFY + explicit broadcast double-path) are coalesced into at most
   * one push per DEBOUNCE_MS window. The debounce is trailing-edge — the
   * last call always fires.
   */
  private readonly pendingBroadcasts = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly BROADCAST_DEBOUNCE_MS = 500;

  async broadcastTopicChanged(topic: string): Promise<void> {
    // Debounce: if a broadcast is already pending for this topic, reset the timer.
    const existing = this.pendingBroadcasts.get(topic);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    this.pendingBroadcasts.set(topic, setTimeout(() => {
      this.pendingBroadcasts.delete(topic);
      this.flushBroadcast(topic).catch((err) => {
        this.log.error({ err, topic }, 'flushBroadcast failed');
      });
    }, WsRouter.BROADCAST_DEBOUNCE_MS));
  }

  private async flushBroadcast(topic: string): Promise<void> {
    const subs = this.topicIndex.get(topic);
    if (!subs || subs.size === 0) return;
    for (const ws of subs) {
      const state = this.clients.get(ws);
      if (!state) continue;
      try {
        await this.pushSnapshot(state, topic);
      } catch (err) {
        this.log.warn({ err, topic, clientId: state.clientId }, 'snapshot push failed');
      }
    }
  }

  /**
   * Send an arbitrary server event to all WS connections of a given userId
   * (fan-out for multi-tab sync, presence, etc.).
   */
  sendToUser(userId: string, event: ServerEnvelope, exceptWs?: WsLike): void {
    const set = this.usersIndex.get(userId);
    if (!set) return;
    const text = serializeEnvelope(event);
    for (const ws of set) {
      if (exceptWs && ws === exceptWs) continue;
      this.safeSend(ws, text);
    }
  }

  /** Send a server event to one specific WS. */
  sendToWs(ws: WsLike, event: ServerEnvelope): void {
    this.safeSend(ws, serializeEnvelope(event));
  }

  /** All clients of a user, for tests / introspection. */
  getUserClients(userId: string): WsLike[] {
    return [...(this.usersIndex.get(userId) ?? [])];
  }

  /** Total connected clients. */
  size(): number {
    return this.clients.size;
  }

  /** Stop heartbeat sweeps and close all WSes. */
  shutdown(reason = 'server-shutdown'): void {
    this.heartbeat.stop();
    for (const t of this.pendingBroadcasts.values()) clearTimeout(t);
    this.pendingBroadcasts.clear();
    for (const ws of [...this.clients.keys()]) {
      try { ws.close(1001, reason); } catch { /* ignore */ }
      this.detach(ws);
    }
  }

  /** Start heartbeat sweep loop. */
  start(): void {
    this.heartbeat.start();
  }

  // ---------- Internals ----------

  private async handleMessage(state: ClientState, data: unknown): Promise<void> {
    // Liveness guard: the message callback closure captures ClientState by
    // reference. If the client was detached (e.g. JWT expiry) but in-flight
    // frames from the same TCP read batch arrive, we must no-op to prevent
    // the stale state from re-inserting into topicIndex.
    if (!this.clients.has(state.ws)) return;

    const text = typeof data === 'string' ? data : data instanceof Buffer ? data.toString('utf8') : null;
    if (text === null) {
      this.replyError(state.ws, undefined, new JchatError(ErrorCodes.VALIDATION_ERROR, 'expected text frame'));
      return;
    }

    const parsed = parseEnvelope(text);
    if (!parsed.ok) {
      this.replyError(state.ws, undefined, new JchatError(ErrorCodes.VALIDATION_ERROR, `invalid envelope: ${parsed.reason}`));
      return;
    }
    const env: ClientEnvelope = parsed.envelope;

    switch (env.type) {
      case 'system.ping':
        this.sendToWs(state.ws, { v: 1, type: 'system.pong' });
        return;

      case 'subscribe':
        await this.handleSubscribe(state, env);
        return;

      case 'unsubscribe':
        this.handleUnsubscribe(state, env);
        return;

      case 'command':
        await this.handleCommand(state, env);
        return;

      default: {
        // Exhaustiveness — TS will catch missing cases at compile time.
        const _exhaustive: never = env;
        void _exhaustive;
      }
    }
  }

  private async handleSubscribe(
    state: ClientState,
    env: Extract<ClientEnvelope, { type: 'subscribe' }>
  ): Promise<void> {
    const topic = env.topic;
    if (!topic || typeof topic !== 'string') {
      this.replyError(state.ws, env.id, new JchatError(ErrorCodes.VALIDATION_ERROR, 'subscribe.topic required'));
      return;
    }

    try {
      const data = await this.loadSnapshotData(state.auth.userId, topic);
      // Re-check liveness after async gap — detach may have run during await.
      if (!this.clients.has(state.ws)) return;
      const signature = computeSignature(data);
      // Only add subscription on success — if loadSnapshotData throws
      // (unknown topic, AUTH_FORBIDDEN), the client should not be marked
      // subscribed. Otherwise future broadcasts waste cycles pushing to a
      // client that was already told the subscription failed.
      state.subscriptions.add(topic);
      this.addToTopic(topic, state.ws);
      state.cache.record(topic, signature);
      // Subscribe ack carries the first snapshot per spec §6.2.
      this.sendToWs(state.ws, {
        v: 1,
        type: 'ack',
        id: env.id,
        result: { snapshot: { topic, signature, data } }
      });
    } catch (err) {
      this.replyError(state.ws, env.id, err);
    }
  }

  private handleUnsubscribe(
    state: ClientState,
    env: Extract<ClientEnvelope, { type: 'unsubscribe' }>
  ): void {
    const topic = env.topic;
    if (!topic || typeof topic !== 'string') {
      this.replyError(state.ws, env.id, new JchatError(ErrorCodes.VALIDATION_ERROR, 'unsubscribe.topic required'));
      return;
    }
    state.subscriptions.delete(topic);
    this.removeFromTopic(topic, state.ws);
    state.cache.forget(topic);
    this.sendToWs(state.ws, { v: 1, type: 'ack', id: env.id, result: { ok: true } });
  }

  private async handleCommand(
    state: ClientState,
    env: Extract<ClientEnvelope, { type: 'command' }>
  ): Promise<void> {
    // Mid-session expiry check. Upgrade-time verifyJchatJwt already proved
    // the signature; we just check the `exp` claim locally here so we
    // refuse commands once the token would have been rotated client-side.
    // Avoids calling Supabase Auth on every command (50-200ms latency).
    if (this.jwtExpiryCheck(state.auth.jwt)) {
      this.replyError(state.ws, env.id, new JchatError(ErrorCodes.AUTH_INVALID, 'token expired — reconnect'));
      try { state.ws.close(1008, 'auth-expired'); } catch { /* ignore */ }
      this.detach(state.ws);
      return;
    }
    try {
      const result = await this.dispatcher.dispatch(env.name, env.payload, {
        auth: state.auth,
        clientId: state.clientId,
        log: this.log
      });
      this.sendToWs(state.ws, { v: 1, type: 'ack', id: env.id, result });

      // Side-effect for input.sync_draft: fan out to other tabs of same user.
      if (env.name === 'input.sync_draft' && result && typeof result === 'object' && 'payload' in result) {
        const { payload } = result as { payload: { conversationId: string; text: string } };
        this.sendToUser(
          state.auth.userId,
          {
            v: 1,
            type: 'input_sync_broadcast',
            conversationId: payload.conversationId,
            text: payload.text,
            fromTab: state.clientId
          },
          state.ws
        );
      }
    } catch (err) {
      this.replyError(state.ws, env.id, err);
    }
  }

  /**
   * Push a snapshot to one specific client for one topic, but only if the
   * signature differs from what we last sent. Returns `true` if sent.
   */
  private async pushSnapshot(state: ClientState, topic: string): Promise<boolean> {
    const data = await this.loadSnapshotData(state.auth.userId, topic);
    const signature = computeSignature(data);
    if (!state.cache.shouldSend(topic, signature)) return false;
    state.cache.record(topic, signature);
    this.sendToWs(state.ws, { v: 1, type: 'snapshot', topic, signature, data });
    return true;
  }

  private async loadSnapshotData(userId: string, topic: string): Promise<unknown> {
    const source = this.resolveSnapshotSource(topic);
    if (!source) {
      throw new JchatError(ErrorCodes.VALIDATION_ERROR, `unknown topic: ${topic}`);
    }
    const data = await source.load(userId, topic);
    if (data === null) {
      throw new JchatError(ErrorCodes.AUTH_FORBIDDEN, `forbidden topic: ${topic}`);
    }
    return data;
  }

  private resolveSnapshotSource(topic: string): SnapshotSource | undefined {
    // Try exact match first (e.g. 'contacts', 'presence').
    const exact = this.snapshotSources.get(topic);
    if (exact) return exact;
    // Fall back to prefix match: 'conversation:<id>' → 'conversation'.
    const colon = topic.indexOf(':');
    if (colon > 0) {
      return this.snapshotSources.get(topic.slice(0, colon));
    }
    return undefined;
  }

  private addToTopic(topic: string, ws: WsLike): void {
    let set = this.topicIndex.get(topic);
    if (!set) {
      set = new Set();
      this.topicIndex.set(topic, set);
    }
    set.add(ws);
  }

  private removeFromTopic(topic: string, ws: WsLike): void {
    const set = this.topicIndex.get(topic);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.topicIndex.delete(topic);
  }

  private replyError(ws: WsLike, id: string | undefined, err: unknown): void {
    const payload = toErrorPayload(err);
    this.sendToWs(ws, { v: 1, type: 'error', id, code: payload.code, message: payload.message, details: payload.details });
  }

  private safeSend(ws: WsLike, text: string): void {
    try {
      // ws.readyState === 1 means OPEN per `ws` lib. If the field is missing
      // (test stubs), assume it's open.
      if (ws.readyState !== undefined && ws.readyState !== 1) return;
      ws.send(text);
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'safeSend failed');
    }
  }
}
