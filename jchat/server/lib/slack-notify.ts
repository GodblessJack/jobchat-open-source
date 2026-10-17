// jchat/server/lib/slack-notify.ts
//
// Lightweight Slack Incoming Webhook notifier. Fire-and-forget — failures are
// logged but never crash the caller. Gracefully degrades when SLACK_WEBHOOK_URL
// is not configured (no-op).
//
// Usage:
//   import { slack } from '../lib/slack-notify.js';
//   slack.info('jchat-server started');
//   slack.warn('sweeper swept 3 stuck meeting sessions');
//   slack.error('worker spawn failed', { userId, error: err.message });
//   slack.deploy({ status: 'success', commit: 'abc1234', duration: '42s' });

import { logger } from '../logger.js';

const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const ENABLED = !!WEBHOOK_URL;

// ======================================================================
// Internal
// ======================================================================

type SlackLevel = 'info' | 'warn' | 'error' | 'deploy';

const LEVEL_EMOJI: Record<SlackLevel, string> = {
  info: 'ℹ️',
  warn: '⚠️',
  error: '🚨',
  deploy: '🚀'
};

const LEVEL_COLOR: Record<SlackLevel, string> = {
  info: '#3b82f6',
  warn: '#f59e0b',
  error: '#ef4444',
  deploy: '#22c55e'
};

interface SlackAttachment {
  title: string;
  text: string;
  color: string;
  fields?: Array<{ title: string; value: string; short: boolean }>;
  footer?: string;
  ts?: number;
}

async function send(
  level: SlackLevel,
  title: string,
  body?: string,
  fields?: Record<string, string>
): Promise<void> {
  if (!ENABLED) return;

  const attachment: SlackAttachment = {
    title: `${LEVEL_EMOJI[level]} ${title}`,
    text: body || '',
    color: LEVEL_COLOR[level],
    ts: Math.floor(Date.now() / 1000)
  };

  if (fields && Object.keys(fields).length > 0) {
    attachment.fields = Object.entries(fields).map(([k, v]) => ({
      title: k,
      value: String(v),
      short: true
    }));
  }

  const payload = {
    attachments: [attachment]
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      logger.warn({ status: res.status, statusText: res.statusText }, 'slack webhook failed');
    }
  } catch (err) {
    clearTimeout(t);
    logger.warn({ err: (err as Error).message }, 'slack webhook send error');
  }
}

// ======================================================================
// Public API
// ======================================================================

export const slack = {
  /** Check if Slack notifications are enabled. */
  get enabled(): boolean {
    return ENABLED;
  },

  /** General info notification — server start, health checks, etc. */
  info(title: string, body?: string, fields?: Record<string, string>): void {
    void send('info', title, body, fields);
  },

  /** Warning — degraded but not broken (e.g. sweeper found stuck sessions). */
  warn(title: string, body?: string, fields?: Record<string, string>): void {
    void send('warn', title, body, fields);
  },

  /** Critical — needs attention (e.g. worker crash, spawn failure). */
  error(title: string, body?: string, fields?: Record<string, string>): void {
    void send('error', title, body, fields);
  },

  /** Deploy notification — success or failure with metadata. */
  deploy(status: 'success' | 'failure', body?: string, fields?: Record<string, string>): void {
    const title = status === 'success' ? 'Deploy succeeded' : 'Deploy failed';
    void send('deploy', title, body, fields);
  }
};
