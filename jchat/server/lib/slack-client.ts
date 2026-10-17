// jchat/server/lib/slack-client.ts
//
// Singleton Slack client using Socket Mode + Web API. Handles:
//   - Sending interactive approval messages with Approve/Deny buttons
//   - Waiting for user button clicks via Socket Mode events
//   - Simple one-way notifications (bot user, richer than L2 webhook)
//
// L3 human-in-the-loop foundation. Inactive when SLACK_BOT_TOKEN or
// SLACK_APP_TOKEN is not configured (graceful no-op).

import { logger } from '../logger.js';
import type { WebClient } from '@slack/web-api';
import type { SocketModeClient } from '@slack/socket-mode';
import { startMonitors } from './slack-l4-monitors.js';

// ======================================================================
// Types
// ======================================================================

export interface ApprovalRequest {
  title: string;
  message: string;
  /** Slack channel ID to send the message to (e.g. 'C0123456789'). */
  channel: string;
  /** Timeout in ms before auto-denying. Default 5 min. */
  timeoutMs?: number;
  /** Extra context fields shown in the Slack message. */
  fields?: Record<string, string>;
}

export interface ApprovalResult {
  approved: boolean;
  /** User ID of the person who clicked the button. */
  respondedBy?: string;
  /** true if the request timed out with no response. */
  timedOut: boolean;
}

type PendingRequest = {
  resolve: (result: ApprovalResult) => void;
  timer: NodeJS.Timeout;
  channel: string;
  ts: string;
};

// ======================================================================
// Singleton state
// ======================================================================

let web: WebClient | null = null;
let socket: SocketModeClient | null = null;
let initialized = false;
let stopMonitors: (() => void) | null = null;
const pendingRequests = new Map<string, PendingRequest>(); // action_id → pending

const APP_TOKEN = process.env.SLACK_APP_TOKEN || '';   // xapp-...
const BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';   // xoxb-...
const ENABLED = !!(APP_TOKEN && BOT_TOKEN);
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

// ======================================================================
// Init / shutdown
// ======================================================================

export async function initSlackClient(): Promise<void> {
  if (!ENABLED) {
    logger.debug('slack-client: disabled (missing SLACK_APP_TOKEN or SLACK_BOT_TOKEN)');
    return;
  }
  if (initialized) return;

  try {
    // Dynamic imports so missing packages don't crash the whole server.
    const { WebClient: WC } = await import('@slack/web-api');
    const { SocketModeClient: SMC } = await import('@slack/socket-mode');

    web = new WC(BOT_TOKEN);
    socket = new SMC({
      appToken: APP_TOKEN,
      logLevel: 'info' as any
    });

    socket.on('block_actions', async (args: any) => {
      const { body, ack } = args.event || args;
      try {
        await ack();
      } catch {
        /* best-effort ack */
      }
      if (!body) return;

      // A block_actions payload carries an array of actions.
      const actions: Array<{ action_id?: string; value?: string }> =
        body.actions || [];
      for (const action of actions) {
        const actionId = action.action_id;
        if (!actionId) continue;
        const pending = pendingRequests.get(actionId);
        if (!pending) continue;

        const approved = actionId.startsWith('approve_');
        const user = body.user?.id || 'unknown';

        clearTimeout(pending.timer);
        pendingRequests.delete(actionId);

        // Update the original message to show the result.
        try {
          await web!.chat.update({
            channel: pending.channel,
            ts: pending.ts,
            blocks: [],
            text: approved
              ? `✅ **Approved** by <@${user}>`
              : `❌ **Denied** by <@${user}>`
          });
        } catch {
          /* best-effort message update */
        }

        pending.resolve({ approved, respondedBy: user, timedOut: false });
      }
    });

    // L1: app_mention → AI task execution
    socket.on('app_mention', async (args: any) => {
      logger.info({ user: args.event?.user, text: (args.event?.text || '').slice(0, 80) }, 'slack-l1: app_mention received');
      const { ack } = args;
      try { await ack(); } catch { /* best-effort */ }
      const innerEvent = args.event;
      if (!innerEvent || !web) return;
      try {
        const { handleAppMention } = await import('./slack-l1-task.js');
        handleAppMention(innerEvent, web).catch(err =>
          logger.warn({ err: (err as Error).message }, 'slack-client: app_mention task rejected')
        );
      } catch (err) {
        logger.warn({ err: (err as Error).message }, 'slack-client: app_mention handler failed');
      }
    });

    // L1-alt: Slash Command /ask → AI task execution (Socket Mode, no Event Subscriptions needed)
    socket.on('slash_commands', async (args: any) => {
      const { ack, body } = args;
      try { await ack(); } catch { /* best-effort */ }
      if (!body || !web) return;

      // Only handle /ask command
      const cmd = (body.command || '').replace(/^\//, '');
      if (cmd !== 'ask' || !body.text?.trim()) return;

      logger.info({ user: body.user_id, channel: body.channel_id, text: body.text }, 'slack-l1: slash command received');

      // Adapt slash command payload to look like an app_mention event
      const syntheticEvent = {
        type: 'app_mention' as const,
        user: body.user_id,
        text: `<@bot> ${body.text}`,
        ts: body.trigger_id || Date.now().toString(),
        channel: body.channel_id,
        event_ts: body.trigger_id || Date.now().toString()
      };

      try {
        const { handleAppMention } = await import('./slack-l1-task.js');
        handleAppMention(syntheticEvent, web).catch(err =>
          logger.warn({ err: (err as Error).message }, 'slack-client: slash command task rejected')
        );
      } catch (err) {
        logger.warn({ err: (err as Error).message }, 'slack-client: slash command handler failed');
      }
    });

    await socket.start();
    initialized = true;
    logger.info('slack-client: Socket Mode connected');

    // Start L4 monitor agents (health check, usage reports, etc.)
    if (web) {
      stopMonitors = startMonitors(web);
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'slack-client: init failed, L3 disabled');
    web = null;
    socket = null;
  }
}

export async function shutdownSlackClient(): Promise<void> {
  if (stopMonitors) {
    try { stopMonitors(); } catch { /* */ }
    stopMonitors = null;
  }
  if (socket) {
    try { await socket.disconnect(); } catch { /* */ }
    socket = null;
  }
  web = null;
  initialized = false;

  // Reject all pending requests on shutdown.
  for (const [id, p] of pendingRequests) {
    clearTimeout(p.timer);
    p.resolve({ approved: false, timedOut: true });
    pendingRequests.delete(id);
  }
}

// ======================================================================
// Public API
// ======================================================================

/** Get the shared WebClient instance. Returns null if L3 is not initialized. */
export function getWebClient(): WebClient | null {
  return web;
}

export const slackClient = {
  get enabled(): boolean {
    return ENABLED && initialized;
  },

  /**
   * Send a one-way rich notification to a Slack channel (no buttons).
   * Falls back to L2 webhook if L3 is not configured.
   */
  async notify(title: string, body: string, channel: string): Promise<void> {
    if (!web || !initialized) {
      // Fallback to L2 webhook
      const { slack } = await import('./slack-notify.js');
      slack.info(title, body);
      return;
    }
    try {
      await web.chat.postMessage({
        channel,
        text: `${title}\n${body}`,
        unfurl_links: false
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'slack-client: notify failed');
    }
  },

  /**
   * Send an approval request to Slack and wait for a human to click
   * Approve or Deny. Returns the result.
   *
   * Uses Slack Block Kit interactive buttons. The call blocks (async) until
   * the user responds or the timeout expires.
   */
  async askApproval(req: ApprovalRequest): Promise<ApprovalResult> {
    if (!web || !initialized) {
      logger.warn('slack-client: askApproval called but L3 not enabled — auto-denying');
      return { approved: false, timedOut: true };
    }

    const timeoutMs = req.timeoutMs || DEFAULT_TIMEOUT_MS;
    const approveId = `approve_${crypto.randomUUID().slice(0, 8)}`;
    const denyId = `deny_${crypto.randomUUID().slice(0, 8)}`;

    const fields = req.fields
      ? Object.entries(req.fields).map(([k, v]) => ({
          type: 'mrkdwn' as const,
          text: `*${k}*: ${v}`
        }))
      : [];

    const blocks = [
      {
        type: 'header' as const,
        text: { type: 'plain_text' as const, text: `🔔 ${req.title}`, emoji: true }
      },
      {
        type: 'section' as const,
        text: { type: 'mrkdwn' as const, text: req.message }
      },
      ...(fields.length > 0
        ? [{ type: 'section' as const, fields } as any]
        : []),
      {
        type: 'actions' as const,
        elements: [
          {
            type: 'button' as const,
            text: { type: 'plain_text' as const, text: '✅ Approve', emoji: true },
            style: 'primary' as const,
            action_id: approveId,
            value: 'approve'
          },
          {
            type: 'button' as const,
            text: { type: 'plain_text' as const, text: '❌ Deny', emoji: true },
            style: 'danger' as const,
            action_id: denyId,
            value: 'deny'
          }
        ]
      },
      {
        type: 'context' as const,
        elements: [
          {
            type: 'mrkdwn' as const,
            text: `⏰ Auto-denies in ${Math.round(timeoutMs / 60000)} min if no response.`
          }
        ]
      }
    ];

    try {
      const msg = await web.chat.postMessage({
        channel: req.channel,
        text: `${req.title}\n${req.message}`,
        blocks,
        unfurl_links: false
      });

      if (!msg.ts || !msg.channel) {
        return { approved: false, timedOut: true };
      }

      // Set up pending promises for both buttons.
      const result = await new Promise<ApprovalResult>((resolve) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(approveId);
          pendingRequests.delete(denyId);
          // Update the message to show timeout.
          web!.chat.update({
            channel: msg.channel!,
            ts: msg.ts!,
            blocks: [],
            text: '⏰ **Timed out** — no response received.'
          }).catch(() => {});
          resolve({ approved: false, timedOut: true });
        }, timeoutMs);

        const entry: PendingRequest = {
          resolve,
          timer,
          channel: msg.channel!,
          ts: msg.ts!
        };
        pendingRequests.set(approveId, entry);
        pendingRequests.set(denyId, entry);
      });

      return result;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'slack-client: askApproval failed');
      return { approved: false, timedOut: true };
    }
  }
};
