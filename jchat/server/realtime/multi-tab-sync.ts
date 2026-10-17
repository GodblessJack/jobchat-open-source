// jchat/server/realtime/multi-tab-sync.ts
//
// Listens to PostgreSQL LISTEN/NOTIFY for changes on jchat_messages and
// jchat_conversations, then uses WsRouter to fan out to all WS connections
// of the same user (i.e. their other tabs / devices).
//
// Strategy:
//   - A PG NOTIFY listener catches real-time change events from DB triggers.
//   - For each event we look up the conversation owner (`user_id`) and
//     broadcast a `snapshot` event for the relevant topics so subscribers
//     pick up the new state.
//   - The router's per-client signature dedup ensures duplicate events
//     don't cause redundant frames on the wire.
//
// This module DOES NOT compute the snapshot itself — it just nudges the
// router to recompute. The router's registered `SnapshotSource` for each
// topic is the source of truth.
//
// Replaces the previous Supabase Realtime-based implementation.

import type { WsRouter } from '../ws/ws-router.js';
import { logger } from '../logger.js';
import { startNotifyListener, type NotifyControl } from './local-notify.js';

export interface MultiTabSyncOptions {
  router: WsRouter;
  log?: typeof logger;
}

export class MultiTabSync {
  private readonly router: WsRouter;
  private readonly log: typeof logger;
  private notifier: NotifyControl | null = null;
  private started = false;
  private catchupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(opts: MultiTabSyncOptions) {
    this.router = opts.router;
    this.log = opts.log ?? logger;
  }

  /** Subscribe to PG NOTIFY changes. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;

    this.notifier = startNotifyListener({
      toConversation: (conversationId, event) => {
        // Fan out to all clients subscribed to this conversation.
        this.router.broadcastTopicChanged(`conversation:${conversationId}`).catch((err) => {
          this.log.warn({ err, conversationId }, 'multi-tab-sync: broadcast failed');
        });
        // Also nudge the contacts snapshot so last-message preview / unread
        // counts update on other tabs.
        this.router.broadcastTopicChanged('contacts').catch((err) => {
          this.log.warn({ err }, 'multi-tab-sync: contacts broadcast failed');
        });
      },
    });

    // Periodic catch-up in case of missed notifications.
    this.catchupInterval = setInterval(() => {
      this.notifier?.catchUp().catch((err) => {
        this.log.warn({ err }, 'multi-tab-sync: catch-up failed');
      });
    }, 60_000);
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.catchupInterval) {
      clearInterval(this.catchupInterval);
      this.catchupInterval = null;
    }
    this.notifier?.stop();
    this.notifier = null;
  }
}
