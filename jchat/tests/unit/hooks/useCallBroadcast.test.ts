// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCallBroadcast } from '../../../src/hooks/useCallBroadcast';
import { useUiStore } from '../../../src/store/ui';

// jsdom 25 does not implement BroadcastChannel — polyfill with a simple
// in-process EventEmitter-based implementation so the hook's BC branch is
// exercised (as opposed to the localStorage fallback).
class BroadcastChannelPolyfill {
  static readonly _listeners = new Map<string, Set<BroadcastChannelPolyfill>>();

  private _name: string;
  onmessage: ((e: { data: unknown }) => void) | null = null;

  constructor(name: string) {
    this._name = name;
    const set = BroadcastChannelPolyfill._listeners.get(name) ?? new Set();
    set.add(this);
    BroadcastChannelPolyfill._listeners.set(name, set);
  }

  postMessage(data: unknown) {
    const set = BroadcastChannelPolyfill._listeners.get(this._name);
    if (!set) return;
    for (const ch of set) {
      if (ch !== this && ch.onmessage) {
        ch.onmessage({ data });
      }
    }
  }

  close() {
    const set = BroadcastChannelPolyfill._listeners.get(this._name);
    set?.delete(this);
  }
}

// Install polyfill on the global so the hook can use it.
if (typeof globalThis.BroadcastChannel === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).BroadcastChannel =
    BroadcastChannelPolyfill;
}

describe('useCallBroadcast', () => {
  beforeEach(() => {
    useUiStore.getState().setActiveCall(null);
    // Clear all polyfill listeners between tests.
    BroadcastChannelPolyfill._listeners.clear();
  });

  it('writes activeCall on "started" message', async () => {
    renderHook(() => useCallBroadcast());
    const bc = new BroadcastChannel('jchat-call');
    bc.postMessage({ type: 'started', sessionId: 's1', conversationId: 'c1', agentId: 'a1' });
    bc.close();
    await new Promise(r => setTimeout(r, 50));
    const ac = useUiStore.getState().activeCall;
    expect(ac?.sessionId).toBe('s1');
    expect(ac?.conversationId).toBe('c1');
    expect(ac?.agentId).toBe('a1');
  });

  it('clears activeCall on "ended"', async () => {
    useUiStore.getState().setActiveCall({ sessionId: 's1', conversationId: 'c1', agentId: 'a1' });
    renderHook(() => useCallBroadcast());
    const bc = new BroadcastChannel('jchat-call');
    bc.postMessage({ type: 'ended', sessionId: 's1', conversationId: 'c1' });
    bc.close();
    await new Promise(r => setTimeout(r, 50));
    expect(useUiStore.getState().activeCall).toBeNull();
  });

  it('ignores "focus-call" message (not store-relevant)', async () => {
    useUiStore.getState().setActiveCall({ sessionId: 's1', conversationId: 'c1', agentId: 'a1' });
    renderHook(() => useCallBroadcast());
    const bc = new BroadcastChannel('jchat-call');
    bc.postMessage({ type: 'focus-call', sessionId: 's1' });
    bc.close();
    await new Promise(r => setTimeout(r, 50));
    // focus-call doesn't change activeCall
    expect(useUiStore.getState().activeCall?.sessionId).toBe('s1');
  });
});
