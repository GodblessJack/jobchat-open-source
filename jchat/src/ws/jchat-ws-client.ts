/**
 * JchatWsClient — single durable WebSocket connection to the jchat server.
 *
 * Spec references:
 *  - §5.3 (heartbeat 15 s, stale 25 s, exponential backoff 1/2/4/8/16/30 s)
 *  - §6.x (envelope, commands, events, error codes)
 *  - §8.2 (reconnect, re-subscribe)
 *
 * Public surface:
 *  - `subscribe(topic)`              → returns unsubscribe()
 *  - `command(name, payload)`        → returns Promise<result>
 *  - `onSnapshot(topic, handler)`    → topic-scoped snapshot callback
 *  - `onDelta(handler)`              → message delta stream
 *  - `onPresence(handler)`           → presence events
 *  - `onEvent(type, handler)`        → generic catch-all for tool_call / thinking / permission / input_sync / error
 *  - `onConnectionChange(handler)`   → 'open' | 'closed' | 'reconnecting'
 *  - `setJwt(jwt)`                   → re-issue auth (forces reconnect)
 *  - `close()`                       → permanent close (unsubscribe all)
 */

import {
  PROTOCOL_VERSION,
  type ClientCommandName,
  type ClientEnvelope,
  type ServerEnvelope,
  type SnapshotEvent,
  type DeltaEvent,
  type ToolCallEvent,
  type ThinkingDeltaEvent,
  type PresenceChangedEvent,
  type InputSyncBroadcastEvent,
  type PermissionRequestEvent
} from '@shared/protocol';
import { ErrorCodes, type ErrorCode } from '@shared/errors';
import { BackoffTracker } from './reconnect';
import { SnapshotCache } from './snapshot-cache';

export const HEARTBEAT_INTERVAL_MS = 15_000;
export const STALE_CONNECTION_MS = 25_000;
export const COMMAND_TIMEOUT_MS = 30_000;

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'reconnecting';

export interface JchatWsClientOptions {
  url: string;
  jwt?: string | null;
  /** Test seam — defaults to global WebSocket. */
  websocketImpl?: typeof WebSocket;
  /** Test seam — defaults to setTimeout. */
  setTimeoutImpl?: typeof setTimeout;
  /** Test seam — defaults to clearTimeout. */
  clearTimeoutImpl?: typeof clearTimeout;
  /** Test seam — defaults to setInterval. */
  setIntervalImpl?: typeof setInterval;
  /** Test seam — defaults to clearInterval. */
  clearIntervalImpl?: typeof clearInterval;
  /** Test seam — defaults to crypto.randomUUID. */
  newId?: () => string;
}

type SnapshotHandler = (snapshot: SnapshotEvent) => void;
type DeltaHandler = (event: DeltaEvent) => void;
type PresenceHandler = (event: PresenceChangedEvent) => void;
type ToolCallHandler = (event: ToolCallEvent) => void;
type ThinkingHandler = (event: ThinkingDeltaEvent) => void;
type InputSyncHandler = (event: InputSyncBroadcastEvent) => void;
type PermissionHandler = (event: PermissionRequestEvent) => void;
type ConnectionHandler = (status: ConnectionStatus) => void;
type ErrorHandler = (err: { id?: string; code: string; message: string; details?: unknown }) => void;

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | number;
}

export class JchatCommandError extends Error {
  public readonly code: string;
  public readonly details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'JchatCommandError';
    this.code = code;
    this.details = details;
  }
}

function defaultNewId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class JchatWsClient {
  private readonly url: string;
  private jwt: string | null;
  private readonly WS: typeof WebSocket;
  private readonly _setTimeout: typeof setTimeout;
  private readonly _clearTimeout: typeof clearTimeout;
  private readonly _setInterval: typeof setInterval;
  private readonly _clearInterval: typeof clearInterval;
  private readonly _newId: () => string;

  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'idle';
  private backoff = new BackoffTracker();
  private heartbeatTimer: ReturnType<typeof setInterval> | number | null = null;
  private staleTimer: ReturnType<typeof setTimeout> | number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | number | null = null;
  private destroyed = false;

  private readonly snapshots = new SnapshotCache();
  private readonly subscribedTopics = new Set<string>();
  private readonly pending = new Map<string, PendingCommand>();

  // handlers
  private readonly snapshotHandlers = new Map<string, Set<SnapshotHandler>>();
  private readonly deltaHandlers = new Set<DeltaHandler>();
  private readonly presenceHandlers = new Set<PresenceHandler>();
  private readonly toolCallHandlers = new Set<ToolCallHandler>();
  private readonly thinkingHandlers = new Set<ThinkingHandler>();
  private readonly inputSyncHandlers = new Set<InputSyncHandler>();
  private readonly permissionHandlers = new Set<PermissionHandler>();
  private readonly connectionHandlers = new Set<ConnectionHandler>();
  private readonly errorHandlers = new Set<ErrorHandler>();

  constructor(options: JchatWsClientOptions) {
    this.url = options.url;
    this.jwt = options.jwt ?? null;
    this.WS = options.websocketImpl ?? (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket;
    // CRITICAL: setTimeout/setInterval require `this === window` in browsers.
    // Assigning them as instance fields strips the binding, causing "Illegal
    // invocation" when invoked as `this._setTimeout(...)`. Bind to globalThis.
    const g = globalThis as typeof globalThis;
    this._setTimeout = options.setTimeoutImpl ?? setTimeout.bind(g);
    this._clearTimeout = options.clearTimeoutImpl ?? clearTimeout.bind(g);
    this._setInterval = options.setIntervalImpl ?? setInterval.bind(g);
    this._clearInterval = options.clearIntervalImpl ?? clearInterval.bind(g);
    this._newId = options.newId ?? defaultNewId;
  }

  // -------- public API --------

  start(): void {
    if (this.destroyed) return;
    this.connect();
  }

  setJwt(jwt: string | null): void {
    this.jwt = jwt;
    // Reject every pending command before closing — otherwise the caller
    // would wait up to COMMAND_TIMEOUT_MS for a token that no longer applies
    // to the new connection (the new socket uses a fresh id space).
    this.rejectAllPending('JWT changed mid-flight');
    // Force a reconnect so the new JWT is presented in the URL.
    if (this.ws) {
      try { this.ws.close(); } catch { /* noop */ }
    } else if (!this.destroyed) {
      this.connect();
    }
  }

  /** Reject every in-flight command. Called on socket close / JWT swap. */
  private rejectAllPending(reason: string): void {
    if (this.pending.size === 0) return;
    for (const [id, p] of this.pending) {
      this._clearTimeout(p.timer);
      p.reject(new JchatCommandError(ErrorCodes.INTERNAL_ERROR, reason));
      this.pending.delete(id);
    }
  }

  /** Subscribe to a topic. Returns an unsubscribe function. */
  subscribe(topic: string): () => void {
    this.subscribedTopics.add(topic);
    if (this.status === 'open') {
      void this.sendSubscribe(topic);
    }
    return () => {
      if (!this.subscribedTopics.has(topic)) return;
      this.subscribedTopics.delete(topic);
      this.snapshots.forget(topic);
      if (this.status === 'open') {
        void this.sendUnsubscribe(topic);
      }
    };
  }

  /** Send a c2s command and resolve with ack `result`. */
  command<T = unknown>(name: ClientCommandName, payload?: unknown): Promise<T> {
    if (this.destroyed) {
      return Promise.reject(new JchatCommandError(ErrorCodes.INTERNAL_ERROR, 'Client destroyed'));
    }
    const id = this._newId();
    const env: ClientEnvelope = { v: PROTOCOL_VERSION, type: 'command', id, name, payload };
    return new Promise<T>((resolve, reject) => {
      const timer = this._setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new JchatCommandError(ErrorCodes.INTERNAL_ERROR, `Command ${name} timed out`));
        }
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        this.sendRaw(env);
      } catch (err) {
        if (this.pending.delete(id)) {
          this._clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });
  }

  // -------- subscriptions --------

  onSnapshot(topic: string, handler: SnapshotHandler): () => void {
    let set = this.snapshotHandlers.get(topic);
    if (!set) {
      set = new Set();
      this.snapshotHandlers.set(topic, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
      if (set && set.size === 0) this.snapshotHandlers.delete(topic);
    };
  }

  onDelta(handler: DeltaHandler): () => void {
    this.deltaHandlers.add(handler);
    return () => { this.deltaHandlers.delete(handler); };
  }

  onPresence(handler: PresenceHandler): () => void {
    this.presenceHandlers.add(handler);
    return () => { this.presenceHandlers.delete(handler); };
  }

  onToolCall(handler: ToolCallHandler): () => void {
    this.toolCallHandlers.add(handler);
    return () => { this.toolCallHandlers.delete(handler); };
  }

  onThinking(handler: ThinkingHandler): () => void {
    this.thinkingHandlers.add(handler);
    return () => { this.thinkingHandlers.delete(handler); };
  }

  onInputSync(handler: InputSyncHandler): () => void {
    this.inputSyncHandlers.add(handler);
    return () => { this.inputSyncHandlers.delete(handler); };
  }

  onPermissionRequest(handler: PermissionHandler): () => void {
    this.permissionHandlers.add(handler);
    return () => { this.permissionHandlers.delete(handler); };
  }

  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => { this.connectionHandlers.delete(handler); };
  }

  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => { this.errorHandlers.delete(handler); };
  }

  /** Permanent close — does not auto-reconnect. */
  close(): void {
    this.destroyed = true;
    this.clearTimers();
    if (this.ws) {
      try { this.ws.close(); } catch { /* noop */ }
      this.ws = null;
    }
    for (const [id, pending] of this.pending.entries()) {
      this._clearTimeout(pending.timer);
      pending.reject(new JchatCommandError(ErrorCodes.INTERNAL_ERROR, 'Client closed'));
      this.pending.delete(id);
    }
    this.setStatus('closed');
  }

  /** Current connection status. */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  // -------- internals --------

  private buildUrl(): string {
    if (!this.jwt) return this.url;
    const sep = this.url.includes('?') ? '&' : '?';
    return `${this.url}${sep}token=${encodeURIComponent(this.jwt)}`;
  }

  private connect(): void {
    if (this.destroyed) return;
    if (this.status === 'connecting' || this.status === 'open') return;
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new this.WS(this.buildUrl());
    } catch (err) {
      this.emitError({
        code: ErrorCodes.INTERNAL_ERROR,
        message: `WS construct failed: ${(err as Error).message}`
      });
      this.setStatus('reconnecting');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', () => this.handleOpen());
    ws.addEventListener('message', ev => this.handleMessage(ev as MessageEvent));
    ws.addEventListener('close', () => this.handleClose());
    ws.addEventListener('error', () => {
      // Browsers do not give detail on WS errors; rely on `close` for retry.
    });
  }

  private handleOpen(): void {
    this.backoff.reset();
    this.setStatus('open');
    this.startHeartbeat();
    this.armStaleTimer();
    // Clear snapshot signatures so re-subscribed topics always deliver a
    // fresh snapshot — prevents stale data when the server reuses signatures
    // across connections.
    this.snapshots.clear();
    // Re-subscribe to all topics
    for (const topic of this.subscribedTopics) {
      void this.sendSubscribe(topic);
    }
  }

  private handleMessage(ev: MessageEvent): void {
    this.armStaleTimer();
    let parsed: ServerEnvelope;
    try {
      parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
    } catch {
      return;
    }
    if (!parsed || parsed.v !== PROTOCOL_VERSION) return;

    switch (parsed.type) {
      case 'system.pong':
        return;
      case 'ack': {
        const pending = this.pending.get(parsed.id);
        if (pending) {
          this._clearTimeout(pending.timer);
          this.pending.delete(parsed.id);
          pending.resolve(parsed.result);
        }
        return;
      }
      case 'error': {
        const errPayload = { id: parsed.id, code: parsed.code, message: parsed.message, details: parsed.details };
        if (parsed.id) {
          const pending = this.pending.get(parsed.id);
          if (pending) {
            this._clearTimeout(pending.timer);
            this.pending.delete(parsed.id);
            pending.reject(new JchatCommandError(parsed.code, parsed.message, parsed.details));
          }
        }
        // Always notify error handlers so global hooks can react (e.g. AUTH_INVALID).
        this.emitError(errPayload);
        return;
      }
      case 'snapshot': {
        const handlers = this.snapshotHandlers.get(parsed.topic);
        if (handlers && this.snapshots.isNew(parsed.topic, parsed.signature)) {
          for (const h of handlers) {
            try { h(parsed); } catch (e) { reportHandlerError(e); }
          }
        }
        return;
      }
      case 'delta': {
        for (const h of this.deltaHandlers) {
          try { h(parsed); } catch (e) { reportHandlerError(e); }
        }
        return;
      }
      case 'tool_call': {
        for (const h of this.toolCallHandlers) {
          try { h(parsed); } catch (e) { reportHandlerError(e); }
        }
        return;
      }
      case 'thinking_delta': {
        for (const h of this.thinkingHandlers) {
          try { h(parsed); } catch (e) { reportHandlerError(e); }
        }
        return;
      }
      case 'presence_changed': {
        for (const h of this.presenceHandlers) {
          try { h(parsed); } catch (e) { reportHandlerError(e); }
        }
        return;
      }
      case 'input_sync_broadcast': {
        for (const h of this.inputSyncHandlers) {
          try { h(parsed); } catch (e) { reportHandlerError(e); }
        }
        return;
      }
      case 'permission_request': {
        for (const h of this.permissionHandlers) {
          try { h(parsed); } catch (e) { reportHandlerError(e); }
        }
        return;
      }
      default:
        return;
    }
  }

  private handleClose(): void {
    this.clearTimers();
    this.ws = null;
    // Reject anything in flight rather than letting it hang for
    // COMMAND_TIMEOUT_MS. After reconnect the caller (UI) will retry from
    // a fresh state — the server doesn't carry pending state across upgrades.
    this.rejectAllPending('WebSocket closed');
    if (this.destroyed) return;
    this.setStatus('reconnecting');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectTimer !== null) return;
    const delay = this.backoff.next();
    this.reconnectTimer = this._setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer !== null) return;
    this.heartbeatTimer = this._setInterval(() => {
      try {
        this.sendRaw({ v: PROTOCOL_VERSION, type: 'system.ping' });
      } catch {
        // socket already broken — close handler will reconnect
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private armStaleTimer(): void {
    if (this.staleTimer !== null) {
      this._clearTimeout(this.staleTimer);
    }
    this.staleTimer = this._setTimeout(() => {
      // No traffic in STALE_CONNECTION_MS — force reconnect.
      if (this.ws) {
        try { this.ws.close(); } catch { /* noop */ }
      }
    }, STALE_CONNECTION_MS);
  }

  private clearTimers(): void {
    if (this.heartbeatTimer !== null) {
      this._clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.staleTimer !== null) {
      this._clearTimeout(this.staleTimer);
      this.staleTimer = null;
    }
    if (this.reconnectTimer !== null) {
      this._clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const h of this.connectionHandlers) {
      try { h(next); } catch (e) { reportHandlerError(e); }
    }
  }

  private async sendSubscribe(topic: string): Promise<void> {
    const id = this._newId();
    const env: ClientEnvelope = { v: PROTOCOL_VERSION, type: 'subscribe', id, topic };
    try {
      this.sendRaw(env);
    } catch (err) {
      // Socket closed between subscribe() status check and sendRaw — the
      // reconnection path will re-subscribe. Don't let this become an
      // unhandled promise rejection from the async function.
      this.emitError({
        code: ErrorCodes.INTERNAL_ERROR,
        message: `subscribe(${topic}) send failed: ${(err as Error).message}`
      });
      return;
    }
    // Note: subscribe ack returns the initial snapshot, but we also dedup via
    // SnapshotCache in handleMessage when the server pushes via `snapshot`
    // events. The ack path is handled here so it is delivered through the
    // same snapshot pipeline.
    await new Promise<void>((resolve, reject) => {
      const timer = this._setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new JchatCommandError(ErrorCodes.INTERNAL_ERROR, `subscribe(${topic}) timed out`));
        }
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, {
        timer,
        resolve: result => {
          // ack carries `{ snapshot: { topic, signature, data } }`
          const r = result as { snapshot?: { topic: string; signature: string; data: unknown } };
          if (r?.snapshot && this.snapshots.isNew(r.snapshot.topic, r.snapshot.signature)) {
            const handlers = this.snapshotHandlers.get(r.snapshot.topic);
            if (handlers) {
              const synthetic: SnapshotEvent = {
                v: PROTOCOL_VERSION,
                type: 'snapshot',
                topic: r.snapshot.topic,
                signature: r.snapshot.signature,
                data: r.snapshot.data
              };
              for (const h of handlers) {
                try { h(synthetic); } catch (e) { reportHandlerError(e); }
              }
            }
          }
          resolve();
        },
        reject
      });
    }).catch(err => {
      // Surface the error but don't throw — re-subscribe is best-effort.
      this.emitError({
        code: (err as JchatCommandError).code ?? ErrorCodes.INTERNAL_ERROR,
        message: (err as Error).message
      });
    });
  }

  private async sendUnsubscribe(topic: string): Promise<void> {
    const id = this._newId();
    const env: ClientEnvelope = { v: PROTOCOL_VERSION, type: 'unsubscribe', id, topic };
    try {
      this.sendRaw(env);
    } catch {
      // socket already broken
    }
    // Don't wait for ack — best-effort.
  }

  private sendRaw(env: ClientEnvelope): void {
    if (!this.ws || this.ws.readyState !== this.WS.OPEN) {
      throw new JchatCommandError(ErrorCodes.INTERNAL_ERROR, 'WebSocket not open');
    }
    this.ws.send(JSON.stringify(env));
  }

  private emitError(payload: { id?: string; code: string; message: string; details?: unknown }): void {
    for (const h of this.errorHandlers) {
      try { h(payload); } catch (e) { reportHandlerError(e); }
    }
  }
}

function reportHandlerError(err: unknown): void {

  console.error('[jchat-ws-client] handler threw', err);
}

/**
 * Helper: classify an error code as auth-invalid for the auth gate.
 */
export function isAuthInvalidCode(code: string | undefined): code is ErrorCode {
  return code === ErrorCodes.AUTH_INVALID || code === ErrorCodes.AUTH_FORBIDDEN;
}
