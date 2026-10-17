// jchat/server/realtime/local-notify.ts
//
// Replaces Supabase Realtime with PostgreSQL LISTEN/NOTIFY.
// Listens for:
//   - `message_change` — fired by a trigger on jchat_messages (INSERT/UPDATE/DELETE)
//   - `conversation_change` — fired by a trigger on jchat_conversations
//
// Usage:
//   const notifier = startNotifyListener({
//     toConversation(convId, event) {
//       wsRouter.broadcastToConversation(convId, event);
//     },
//   });
//   // Later, to recover missed events:
//   await notifier.catchUp();

import { pool } from '../lib/db.js';
import type { PoolClient } from 'pg';
import { logger } from '../logger.js';

export interface NotifyHandler {
  toConversation: (conversationId: string, event: { type: string; [key: string]: unknown }) => void;
}

export interface NotifyControl {
  catchUp: () => Promise<void>;
  stop: () => void;
}

export function startNotifyListener(handler: NotifyHandler): NotifyControl {
  let client: PoolClient | null = null;
  let retries = 0;
  let lastSeen: Date = new Date();

  async function connect() {
    try {
      client = await pool.connect();
      await client.query('LISTEN message_change');
      await client.query('LISTEN conversation_change');

      client.on('notification', (msg) => {
        try {
          const payload = JSON.parse(msg.payload || '{}');
          if (msg.channel === 'message_change') {
            handler.toConversation(payload.conversation_id, {
              type: 'message_update',
              message_id: payload.message_id,
              op: payload.op,
            });
          } else if (msg.channel === 'conversation_change') {
            handler.toConversation(payload.conversation_id, {
              type: 'conversation_update',
              conversation_id: payload.conversation_id,
              op: payload.op,
            });
          }
          lastSeen = new Date();
        } catch (e) {
          logger.error({ err: e }, '[notify] Failed to parse notification');
        }
      });

      client.on('error', (err) => {
        logger.error({ err }, '[notify] client error');
        if (!client) return;
        client.release();
        client = null;
        if (retries < 10) {
          const delay = Math.min(1000 * 2 ** retries++, 30000);
          logger.warn(`[notify] Connection error, reconnecting in ${delay}ms...`);
          setTimeout(connect, delay);
        } else {
          logger.error('[notify] Max retries reached, giving up');
        }
      });
      client.on('end', () => {
        if (!client) return;
        client = null;
        if (retries < 10) {
          const delay = Math.min(1000 * 2 ** retries++, 30000);
          logger.warn(`[notify] Connection ended, reconnecting in ${delay}ms...`);
          setTimeout(connect, delay);
        } else {
          logger.error('[notify] Max retries reached, giving up');
        }
      });

      retries = 0;
      logger.info('[notify] LISTEN/NOTIFY listener started');
    } catch (err) {
      logger.error({ err }, '[notify] Failed to connect listener');
      if (retries < 10) setTimeout(connect, Math.min(1000 * 2 ** retries++, 30000));
    }
  }

  connect();

  return {
    async catchUp() {
      if (!client) return;
      try {
        const result = await client.query(
          `SELECT conversation_id, id FROM jchat_messages
           WHERE created_at > $1 AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT 100`,
          [lastSeen]
        );
        for (const row of result.rows) {
          handler.toConversation(row.conversation_id, {
            type: 'message_update',
            message_id: row.id,
            op: 'CATCHUP',
          });
        }
        lastSeen = new Date();
      } catch (e) {
        logger.error({ err: e }, '[notify] Catch-up failed');
      }
    },
    stop() {
      if (!client) return;
      client.removeAllListeners();
      client.release();
      client = null;
    },
  };
}
