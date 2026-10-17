// Subscribes to the cross-tab call broadcast channel and projects 'started' /
// 'ended' lifecycle events into useUiStore.activeCall. Mounted once at the
// App root.
//
// Falls back to localStorage 'storage' events when BroadcastChannel is
// unsupported. Note: postCallEvent (lib/call.ts) writes localStorage with a
// UNIQUE key prefixed by `${CALL_BC_NAME}:msg:`; this listener prefix-matches
// to support the unique-key scheme.

import { useEffect } from 'react';
import { useUiStore } from '../store/ui';
import { CALL_BC_NAME, type CallBroadcastMessage } from '@shared/call-types';

export function useCallBroadcast(): void {
  const setActiveCall = useUiStore(s => s.setActiveCall);

  useEffect(() => {
    const handle = (msg: CallBroadcastMessage) => {
      if (msg.type === 'started') {
        setActiveCall({
          sessionId: msg.sessionId,
          conversationId: msg.conversationId,
          agentId: msg.agentId,
        });
      } else if (msg.type === 'ended') {
        const current = useUiStore.getState().activeCall;
        if (current && current.sessionId === msg.sessionId) {
          setActiveCall(null);
        }
      }
      // 'focus-call' is consumed by the meeting tab itself; ignored here.
    };

    let bc: BroadcastChannel | null = null;
    let storageHandler: ((e: StorageEvent) => void) | null = null;

    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel(CALL_BC_NAME);
      bc.onmessage = e => {
        if (e.data && typeof (e.data as CallBroadcastMessage).type === 'string') {
          handle(e.data as CallBroadcastMessage);
        }
      };
    } else {
      const PREFIX = `${CALL_BC_NAME}:msg:`;
      storageHandler = (e: StorageEvent) => {
        if (e.key && e.key.startsWith(PREFIX) && e.newValue) {
          try { handle(JSON.parse(e.newValue)); } catch { /* ignore */ }
        }
      };
      window.addEventListener('storage', storageHandler);
    }

    return () => {
      bc?.close();
      if (storageHandler) window.removeEventListener('storage', storageHandler);
    };
  }, [setActiveCall]);
}
