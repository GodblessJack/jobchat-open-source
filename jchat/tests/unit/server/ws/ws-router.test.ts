// jchat/tests/unit/server/ws/ws-router.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WsRouter, type WsLike, type SnapshotSource } from '@/server/ws/ws-router';
import { CommandDispatcher } from '@/server/ws/command-dispatcher';
import { HeartbeatTracker } from '@/server/ws/heartbeat';
import { JchatError, ErrorCodes } from '@shared/errors.js';
import type { ClientCommandName } from '@shared/protocol.js';

// ----- Test harness -----

interface FakeWs extends WsLike {
  sent: string[];
  closed: boolean;
  emit(event: 'message' | 'close' | 'error', data?: unknown): void;
}

function makeFakeWs(): FakeWs {
  const handlers: Record<string, Array<(data?: unknown) => void>> = {};
  const ws: FakeWs = {
    readyState: 1,
    sent: [],
    closed: false,
    send(data: string) {
      this.sent.push(data);
    },
    close() {
      this.closed = true;
    },
    on(event: string, cb: (data?: unknown) => void) {
      handlers[event] = handlers[event] || [];
      handlers[event].push(cb);
    },
    emit(event: string, data?: unknown) {
      const fns = handlers[event] || [];
      for (const fn of fns) fn(data);
    }
  } as FakeWs;
  return ws;
}

function lastEnvelope(ws: FakeWs): Record<string, unknown> {
  const last = ws.sent[ws.sent.length - 1];
  if (!last) throw new Error('no envelopes sent');
  return JSON.parse(last);
}

// Inert heartbeat: no auto-start, manual control.
function makeInertHeartbeat(): HeartbeatTracker<WsLike> {
  return new HeartbeatTracker<WsLike>({
    now: () => 0,
    setInterval: () => 0 as unknown as NodeJS.Timeout,
    clearInterval: () => {}
  });
}

describe('WsRouter', () => {
  let router: WsRouter;
  let contactsSource: SnapshotSource;
  let contactsLoadCount = 0;

  beforeEach(() => {
    contactsLoadCount = 0;
    contactsSource = {
      load(_userId: string, _topic: string) {
        contactsLoadCount++;
        // Return a stable shape so signature is deterministic
        return { agents: [{ id: 'a1', name: 'Alpha' }] };
      }
    };

    router = new WsRouter({ isJwtExpired: () => false,
      heartbeat: makeInertHeartbeat(),
      dispatcher: new CommandDispatcher(),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });
    router.registerSnapshotSource('contacts', contactsSource);
  });

  describe('subscribe', () => {
    it('replies with ack containing initial snapshot', async () => {
      const ws = makeFakeWs();
      router.attach(ws, { userId: 'u1', jwt: 'jwt' });

      ws.emit('message', JSON.stringify({ v: 1, type: 'subscribe', id: 'sub1', topic: 'contacts' }));
      // microtask flush
      await Promise.resolve();
      await Promise.resolve();

      const env = lastEnvelope(ws);
      expect(env.type).toBe('ack');
      expect(env.id).toBe('sub1');
      const result = env.result as { snapshot: { topic: string; signature: string; data: unknown } };
      expect(result.snapshot.topic).toBe('contacts');
      expect(typeof result.snapshot.signature).toBe('string');
      expect(result.snapshot.signature.length).toBeGreaterThan(0);
    });

    it('rejects unknown topic', async () => {
      const ws = makeFakeWs();
      router.attach(ws, { userId: 'u1', jwt: 'jwt' });

      ws.emit('message', JSON.stringify({ v: 1, type: 'subscribe', id: 'sub1', topic: 'nonsense' }));
      await Promise.resolve();
      await Promise.resolve();

      const env = lastEnvelope(ws);
      expect(env.type).toBe('error');
      expect(env.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
  });

  describe('snapshot signature dedup', () => {
    it('does not push a snapshot with the same signature twice to a client', async () => {
      const ws = makeFakeWs();
      router.attach(ws, { userId: 'u1', jwt: 'jwt' });

      // initial subscribe → ack with snapshot
      ws.emit('message', JSON.stringify({ v: 1, type: 'subscribe', id: 'sub1', topic: 'contacts' }));
      await Promise.resolve();
      await Promise.resolve();
      const beforeCount = ws.sent.length;

      // broadcast a change — but the source returns the same data → same signature
      await router.broadcastTopicChanged('contacts');

      expect(ws.sent.length).toBe(beforeCount); // no extra send
    });

    it('pushes a snapshot when signature changes', async () => {
      vi.useFakeTimers();
      let payloadVer = 1;
      const dynamicSource: SnapshotSource = { load: () => ({ ver: payloadVer }) };
      router.registerSnapshotSource('dyn', dynamicSource);

      const ws = makeFakeWs();
      router.attach(ws, { userId: 'u1', jwt: 'jwt' });
      ws.emit('message', JSON.stringify({ v: 1, type: 'subscribe', id: 'sub1', topic: 'dyn' }));
      await vi.advanceTimersByTimeAsync(0);
      const sentAfterSubscribe = ws.sent.length;

      payloadVer = 2;
      await router.broadcastTopicChanged('dyn');
      // Debounce (500ms trailing) delays the actual broadcast.
      await vi.advanceTimersByTimeAsync(600);

      expect(ws.sent.length).toBe(sentAfterSubscribe + 1);
      const env = JSON.parse(ws.sent[ws.sent.length - 1]!);
      expect(env.type).toBe('snapshot');
      expect(env.topic).toBe('dyn');
      vi.useRealTimers();
    });
  });

  describe('unsubscribe', () => {
    it('removes from topic and acks', async () => {
      const ws = makeFakeWs();
      router.attach(ws, { userId: 'u1', jwt: 'jwt' });

      ws.emit('message', JSON.stringify({ v: 1, type: 'subscribe', id: 'sub1', topic: 'contacts' }));
      await Promise.resolve();
      await Promise.resolve();

      ws.emit('message', JSON.stringify({ v: 1, type: 'unsubscribe', id: 'unsub1', topic: 'contacts' }));
      await Promise.resolve();
      const env = lastEnvelope(ws);
      expect(env.type).toBe('ack');
      expect(env.id).toBe('unsub1');

      // After unsubscribe, broadcasts should not reach this client
      const before = ws.sent.length;
      await router.broadcastTopicChanged('contacts');
      expect(ws.sent.length).toBe(before);
    });
  });

  describe('system.ping → system.pong', () => {
    it('replies pong immediately', async () => {
      const ws = makeFakeWs();
      router.attach(ws, { userId: 'u1', jwt: 'jwt' });
      ws.emit('message', JSON.stringify({ v: 1, type: 'system.ping' }));
      await Promise.resolve();
      const env = lastEnvelope(ws);
      expect(env.type).toBe('system.pong');
      expect(env.v).toBe(1);
    });
  });

  describe('command dispatch', () => {
    it('returns error envelope on validation failure (unknown command)', async () => {
      const ws = makeFakeWs();
      router.attach(ws, { userId: 'u1', jwt: 'jwt' });

      ws.emit(
        'message',
        JSON.stringify({ v: 1, type: 'command', id: 'cmd1', name: 'nonexistent.command' as ClientCommandName, payload: {} })
      );
      await Promise.resolve();
      await Promise.resolve();

      const env = lastEnvelope(ws);
      expect(env.type).toBe('error');
      expect(env.id).toBe('cmd1');
      expect(env.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('forwards JchatError from dispatcher into error envelope', async () => {
      const dispatcher = new CommandDispatcher();
      // Override dispatch to throw a known error
      vi.spyOn(dispatcher, 'dispatch').mockRejectedValue(
        new JchatError(ErrorCodes.AUTH_FORBIDDEN, 'nope')
      );
      const r = new WsRouter({ isJwtExpired: () => false,  heartbeat: makeInertHeartbeat(), dispatcher });
      r.registerSnapshotSource('contacts', contactsSource);

      const ws = makeFakeWs();
      r.attach(ws, { userId: 'u1', jwt: 'jwt' });
      ws.emit(
        'message',
        JSON.stringify({ v: 1, type: 'command', id: 'cmd1', name: 'conversation.open', payload: { conversationId: 'c1' } })
      );
      await Promise.resolve();
      await Promise.resolve();

      const env = lastEnvelope(ws);
      expect(env.type).toBe('error');
      expect(env.id).toBe('cmd1');
      expect(env.code).toBe(ErrorCodes.AUTH_FORBIDDEN);
    });

    it('returns ack with result on success', async () => {
      const dispatcher = new CommandDispatcher();
      vi.spyOn(dispatcher, 'dispatch').mockResolvedValue({ ok: true });
      const r = new WsRouter({ isJwtExpired: () => false,  heartbeat: makeInertHeartbeat(), dispatcher });

      const ws = makeFakeWs();
      r.attach(ws, { userId: 'u1', jwt: 'jwt' });
      ws.emit(
        'message',
        JSON.stringify({ v: 1, type: 'command', id: 'cmd1', name: 'conversation.open', payload: { conversationId: 'c1' } })
      );
      await Promise.resolve();
      await Promise.resolve();

      const env = lastEnvelope(ws);
      expect(env.type).toBe('ack');
      expect(env.id).toBe('cmd1');
      expect(env.result).toEqual({ ok: true });
    });
  });

  describe('multi-client fan-out', () => {
    it('input.sync_draft fans out to other tabs of same user, not to sender', async () => {
      const dispatcher = new CommandDispatcher();
      const r = new WsRouter({ isJwtExpired: () => false,  heartbeat: makeInertHeartbeat(), dispatcher });

      const tabA = makeFakeWs();
      const tabB = makeFakeWs();
      r.attach(tabA, { userId: 'u1', jwt: 'jwt' });
      r.attach(tabB, { userId: 'u1', jwt: 'jwt' });

      tabA.emit(
        'message',
        JSON.stringify({
          v: 1,
          type: 'command',
          id: 'd1',
          name: 'input.sync_draft',
          payload: { conversationId: 'c1', text: 'hello' }
        })
      );
      // Multiple microtask flushes — ack send is after `await dispatcher.dispatch`
      // which itself awaits the inner handler. Loop until tabA has sent something
      // to avoid relying on a fixed flush count.
      for (let i = 0; i < 20 && tabA.sent.length === 0; i++) {
        await Promise.resolve();
      }

      // Sender gets ack only
      const ackA = JSON.parse(tabA.sent[0]!);
      expect(ackA.type).toBe('ack');
      expect(tabA.sent.length).toBe(1);

      // Other tab gets the broadcast
      expect(tabB.sent.length).toBe(1);
      const env = JSON.parse(tabB.sent[0]!);
      expect(env.type).toBe('input_sync_broadcast');
      expect(env.conversationId).toBe('c1');
      expect(env.text).toBe('hello');
    });
  });

  describe('detach on close', () => {
    it('removes client from topic and user index', async () => {
      const ws = makeFakeWs();
      router.attach(ws, { userId: 'u1', jwt: 'jwt' });
      ws.emit('message', JSON.stringify({ v: 1, type: 'subscribe', id: 's', topic: 'contacts' }));
      await Promise.resolve();
      await Promise.resolve();

      expect(router.size()).toBe(1);
      ws.emit('close');
      expect(router.size()).toBe(0);

      // Broadcast should not throw and should not try to send to closed ws
      await router.broadcastTopicChanged('contacts');
      expect(ws.sent.length).toBe(1); // only the original ack
    });
  });
});

describe('snapshot signature is content-addressed', () => {
  it('produces the same signature for equivalent objects regardless of key order', async () => {
    let captured1 = '';
    let captured2 = '';

    const r1 = new WsRouter({ isJwtExpired: () => false,  heartbeat: makeInertHeartbeat() });
    r1.registerSnapshotSource('t', { load: () => ({ a: 1, b: 2 }) });
    const ws1 = makeFakeWs();
    r1.attach(ws1, { userId: 'u1', jwt: 'j' });
    ws1.emit('message', JSON.stringify({ v: 1, type: 'subscribe', id: 's1', topic: 't' }));
    await Promise.resolve();
    await Promise.resolve();
    captured1 = (JSON.parse(ws1.sent[0]!).result as { snapshot: { signature: string } }).snapshot.signature;

    const r2 = new WsRouter({ isJwtExpired: () => false,  heartbeat: makeInertHeartbeat() });
    r2.registerSnapshotSource('t', { load: () => ({ b: 2, a: 1 }) });
    const ws2 = makeFakeWs();
    r2.attach(ws2, { userId: 'u2', jwt: 'j' });
    ws2.emit('message', JSON.stringify({ v: 1, type: 'subscribe', id: 's1', topic: 't' }));
    await Promise.resolve();
    await Promise.resolve();
    captured2 = (JSON.parse(ws2.sent[0]!).result as { snapshot: { signature: string } }).snapshot.signature;

    expect(captured1).toBe(captured2);
  });
});
