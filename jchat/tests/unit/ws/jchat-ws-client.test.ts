/**
 * JchatWsClient unit tests. Use a fake WebSocket + fake timers to verify:
 *   - heartbeat fires every 15 s
 *   - reconnect uses exponential backoff
 *   - subscriptions are re-sent after reconnect
 *   - command(name, payload) resolves on ack and rejects on error envelope
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JchatWsClient, JchatCommandError, HEARTBEAT_INTERVAL_MS } from '@/ws/jchat-ws-client';
import { PROTOCOL_VERSION } from '@shared/protocol';
import { RECONNECT_BACKOFF_MS } from '@/ws/reconnect';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;
  static CONNECTING = 0;

  public readyState = FakeWebSocket.CONNECTING;
  public sent: string[] = [];
  private listeners: Record<string, Set<(ev: unknown) => void>> = {
    open: new Set(),
    message: new Set(),
    close: new Set(),
    error: new Set()
  };
  // Mirror static for instance access
  public OPEN = FakeWebSocket.OPEN;
  public CLOSED = FakeWebSocket.CLOSED;
  public CONNECTING = FakeWebSocket.CONNECTING;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    this.listeners[type]?.add(fn);
  }

  removeEventListener(type: string, fn: (ev: unknown) => void): void {
    this.listeners[type]?.delete(fn);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    for (const fn of this.listeners.close) fn({});
  }

  // helpers for tests
  triggerOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    for (const fn of this.listeners.open) fn({});
  }

  triggerMessage(data: unknown): void {
    for (const fn of this.listeners.message) fn({ data: JSON.stringify(data) });
  }

  triggerError(): void {
    for (const fn of this.listeners.error) fn({});
  }
}

describe('JchatWsClient', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeClient(jwt: string | null = 'jwt-1') {
    let counter = 0;
    const client = new JchatWsClient({
      url: 'ws://localhost/ws',
      jwt,
      websocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      newId: () => `id-${++counter}`
    });
    return client;
  }

  it('opens a websocket and emits "open" status', () => {
    const client = makeClient();
    const seen: string[] = [];
    client.onConnectionChange(s => seen.push(s));
    client.start();

    expect(FakeWebSocket.instances.length).toBe(1);
    expect(FakeWebSocket.instances[0].url).toContain('token=jwt-1');

    FakeWebSocket.instances[0].triggerOpen();
    expect(seen).toEqual(['connecting', 'open']);
  });

  it('sends heartbeat every HEARTBEAT_INTERVAL_MS while open', () => {
    const client = makeClient();
    client.start();
    const ws = FakeWebSocket.instances[0];
    ws.triggerOpen();
    // Drain initial sends
    ws.sent = [];
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    const sentCount = ws.sent.filter(s => s.includes('"system.ping"')).length;
    expect(sentCount).toBe(1);

    // Server replies with pong (resets stale timer); advance to next heartbeat
    ws.triggerMessage({ v: PROTOCOL_VERSION, type: 'system.pong' });
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(ws.sent.filter(s => s.includes('"system.ping"')).length).toBe(2);

    ws.triggerMessage({ v: PROTOCOL_VERSION, type: 'system.pong' });
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(ws.sent.filter(s => s.includes('"system.ping"')).length).toBe(3);
  });

  it('reconnects with exponential backoff after close', () => {
    const client = makeClient();
    client.start();
    expect(FakeWebSocket.instances.length).toBe(1);
    FakeWebSocket.instances[0].triggerOpen();
    FakeWebSocket.instances[0].close();

    // First reconnect after 1000 ms
    expect(FakeWebSocket.instances.length).toBe(1);
    vi.advanceTimersByTime(RECONNECT_BACKOFF_MS[0]);
    expect(FakeWebSocket.instances.length).toBe(2);

    // Without opening, close again — second backoff is 2000 ms
    FakeWebSocket.instances[1].close();
    vi.advanceTimersByTime(RECONNECT_BACKOFF_MS[1] - 1);
    expect(FakeWebSocket.instances.length).toBe(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances.length).toBe(3);
  });

  it('re-sends subscriptions on reconnect', () => {
    const client = makeClient();
    client.start();
    const ws1 = FakeWebSocket.instances[0];
    ws1.triggerOpen();
    client.subscribe('contacts');
    // Subscribe sent
    expect(ws1.sent.some(s => s.includes('"subscribe"') && s.includes('"contacts"'))).toBe(true);

    // Drop connection
    ws1.close();
    vi.advanceTimersByTime(RECONNECT_BACKOFF_MS[0]);
    const ws2 = FakeWebSocket.instances[1];
    ws2.triggerOpen();
    // Re-subscribed
    expect(ws2.sent.some(s => s.includes('"subscribe"') && s.includes('"contacts"'))).toBe(true);
  });

  it('command() resolves on matching ack', async () => {
    const client = makeClient();
    client.start();
    const ws = FakeWebSocket.instances[0];
    ws.triggerOpen();

    const promise = client.command<{ messageId: string }>('message.send', {
      conversationId: 'c1',
      content: 'hi'
    });

    // First send is a 'subscribe'? No — we did not subscribe. So sent[0] is the command.
    const env = JSON.parse(ws.sent[0]);
    expect(env.type).toBe('command');
    expect(env.name).toBe('message.send');

    ws.triggerMessage({ v: PROTOCOL_VERSION, type: 'ack', id: env.id, result: { messageId: 'm-7' } });
    await expect(promise).resolves.toEqual({ messageId: 'm-7' });
  });

  it('command() rejects with JchatCommandError on error envelope', async () => {
    const client = makeClient();
    client.start();
    const ws = FakeWebSocket.instances[0];
    ws.triggerOpen();

    const promise = client.command('message.send', { conversationId: 'c1', content: '' });
    const env = JSON.parse(ws.sent[0]);

    ws.triggerMessage({
      v: PROTOCOL_VERSION,
      type: 'error',
      id: env.id,
      code: 'VALIDATION_ERROR',
      message: 'content empty'
    });

    await expect(promise).rejects.toBeInstanceOf(JchatCommandError);
    await expect(promise).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('routes snapshot events to topic-scoped handlers and dedupes by signature', () => {
    const client = makeClient();
    client.start();
    const ws = FakeWebSocket.instances[0];
    ws.triggerOpen();

    const seen: unknown[] = [];
    client.onSnapshot('contacts', s => seen.push(s.data));

    ws.triggerMessage({ v: PROTOCOL_VERSION, type: 'snapshot', topic: 'contacts', signature: 'sig-1', data: { agents: ['a'] } });
    ws.triggerMessage({ v: PROTOCOL_VERSION, type: 'snapshot', topic: 'contacts', signature: 'sig-1', data: { agents: ['a', 'b'] } });
    ws.triggerMessage({ v: PROTOCOL_VERSION, type: 'snapshot', topic: 'contacts', signature: 'sig-2', data: { agents: ['c'] } });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ agents: ['a'] });
    expect(seen[1]).toEqual({ agents: ['c'] });
  });

  it('routes delta events to onDelta subscribers', () => {
    const client = makeClient();
    client.start();
    const ws = FakeWebSocket.instances[0];
    ws.triggerOpen();

    const chunks: string[] = [];
    client.onDelta(d => chunks.push(d.textChunk));

    ws.triggerMessage({
      v: PROTOCOL_VERSION,
      type: 'delta',
      conversationId: 'c1',
      messageId: 'm1',
      agentId: 'a1',
      textChunk: 'Hello '
    });
    ws.triggerMessage({
      v: PROTOCOL_VERSION,
      type: 'delta',
      conversationId: 'c1',
      messageId: 'm1',
      agentId: 'a1',
      textChunk: 'world'
    });

    expect(chunks).toEqual(['Hello ', 'world']);
  });

  it('emitError fires for AUTH_INVALID error envelopes', () => {
    const client = makeClient();
    client.start();
    const ws = FakeWebSocket.instances[0];
    ws.triggerOpen();

    const errs: { code: string }[] = [];
    client.onError(e => errs.push({ code: e.code }));

    ws.triggerMessage({ v: PROTOCOL_VERSION, type: 'error', code: 'AUTH_INVALID', message: 'jwt expired' });

    expect(errs).toEqual([{ code: 'AUTH_INVALID' }]);
  });
});
