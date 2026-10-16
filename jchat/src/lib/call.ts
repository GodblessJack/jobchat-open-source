// jchat/src/lib/call.ts
//
// Cross-tab plumbing for the meeting × jchat video call integration.
//   - openCallTab: launch the meeting SPA in a new tab with conversationId
//   - postCallEvent: broadcast a call lifecycle event to other same-origin tabs
//
// Falls back to localStorage 'storage' events when BroadcastChannel is unsupported.

import { CALL_BC_NAME, type CallBroadcastMessage } from '@shared/call-types';

export function openCallTab(conversationId: string): void {
  // Trailing slash matters: meeting vite has `base: '/call/'`, so the entry URL
  // must start with `/call/` (with slash) — otherwise vite warns "did you mean /call/?".
  const url = `/call/?conversationId=${encodeURIComponent(conversationId)}`;
  // `noopener` prevents the meeting tab from manipulating window.opener.
  window.open(url, `jchat-call-${conversationId}`, 'noopener');
}

export function postCallEvent(msg: CallBroadcastMessage): void {
  try {
    const bc = new BroadcastChannel(CALL_BC_NAME);
    bc.postMessage(msg);
    bc.close();
  } catch {
    // BroadcastChannel unsupported → fall back to localStorage event.
    // Use a fixed overwrite key — no cleanup timer — to avoid the race where
    // background tabs (throttled to ~1Hz) miss the 'storage' event before a
    // 50ms cleanup deletes the key.
    const key = `${CALL_BC_NAME}:msg:latest`;
    localStorage.setItem(key, JSON.stringify(msg));
  }
}
