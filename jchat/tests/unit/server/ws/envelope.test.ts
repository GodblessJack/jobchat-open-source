// jchat/tests/unit/server/ws/envelope.test.ts

import { describe, it, expect } from 'vitest';
import {
  parseEnvelope,
  serializeEnvelope,
  isClientEnvelope,
  isServerEnvelope
} from '@/server/ws/envelope';
import type { ServerEnvelope } from '@shared/protocol.js';

describe('envelope', () => {
  describe('parseEnvelope', () => {
    it('parses a valid command envelope', () => {
      const text = JSON.stringify({
        v: 1,
        type: 'command',
        id: 'req-1',
        name: 'conversation.open',
        payload: { conversationId: 'c1' }
      });
      const r = parseEnvelope(text);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.envelope.type).toBe('command');
        expect((r.envelope as { id: string }).id).toBe('req-1');
      }
    });

    it('parses subscribe / unsubscribe / system.ping', () => {
      for (const env of [
        { v: 1, type: 'subscribe', id: 's1', topic: 'contacts' },
        { v: 1, type: 'unsubscribe', id: 'u1', topic: 'contacts' },
        { v: 1, type: 'system.ping' }
      ]) {
        const r = parseEnvelope(JSON.stringify(env));
        expect(r.ok, `should parse ${env.type}`).toBe(true);
      }
    });

    it('rejects non-JSON', () => {
      const r = parseEnvelope('not json');
      expect(r).toEqual({ ok: false, reason: 'not-json', raw: 'not json' });
    });

    it('rejects non-object JSON', () => {
      const r = parseEnvelope('42');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('not-object');
    });

    it('rejects wrong protocol version', () => {
      const r = parseEnvelope(JSON.stringify({ v: 2, type: 'command', id: 'x', name: 'noop' }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('not-client-envelope');
    });

    it('rejects unknown client type', () => {
      const r = parseEnvelope(JSON.stringify({ v: 1, type: 'ack', id: 'x' }));
      expect(r.ok).toBe(false);
    });
  });

  describe('serializeEnvelope', () => {
    it('round-trips a server ack', () => {
      const env: ServerEnvelope = { v: 1, type: 'ack', id: 'r1', result: { ok: true } };
      const s = serializeEnvelope(env);
      expect(JSON.parse(s)).toEqual(env);
    });

    it('round-trips a snapshot event', () => {
      const env: ServerEnvelope = {
        v: 1,
        type: 'snapshot',
        topic: 'conversation:abc',
        signature: 'sig',
        data: { messages: [] }
      };
      const s = serializeEnvelope(env);
      const back = JSON.parse(s);
      expect(back).toEqual(env);
      expect(isServerEnvelope(back)).toBe(true);
    });
  });

  describe('guards re-export', () => {
    it('exports isClientEnvelope/isServerEnvelope from shared', () => {
      expect(typeof isClientEnvelope).toBe('function');
      expect(typeof isServerEnvelope).toBe('function');
      expect(isClientEnvelope({ v: 1, type: 'system.ping' })).toBe(true);
      expect(isClientEnvelope({ v: 1, type: 'ack', id: 'x' })).toBe(false);
    });
  });
});
