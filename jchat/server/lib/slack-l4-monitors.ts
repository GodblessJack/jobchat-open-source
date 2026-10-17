// jchat/server/lib/slack-l4-monitors.ts
//
// L4: Persistent monitor agents that run on schedules and post reports to Slack.
// Each monitor is defined in the SLACK_MONITORS_CONFIG env var as a JSON array.
//
// Monitors use the same Claude API endpoint as the rest of the project.
// They are NOT full SDK worker sessions — they make a single API call per tick
// (no MCP tools, no persistent conversation). For complex multi-step monitoring,
// upgrade to a headless SDK session per the distillation launcher pattern.
//
// Architecture:
//   setInterval (sweeper pattern) → build prompt → callClaudeApi → post to Slack
//
// Inactive when SLACK_MONITORS_CONFIG is not set (graceful no-op).

import { logger } from '../logger.js';
import type { WebClient } from '@slack/web-api';

// ======================================================================
// Types
// ======================================================================

interface MonitorConfig {
  /** Human-readable name, shown in Slack reports. */
  name: string;
  /** Slack channel ID to post reports to. */
  channel: string;
  /** Interval between ticks in ms (e.g. 900000 = 15 min). */
  intervalMs: number;
  /** Prompt sent to the AI each tick. Include what to check and how to report. */
  prompt: string;
  /** Whether this monitor is active. */
  enabled: boolean;
  /** Optional: system prompt to set AI behavior. */
  systemPrompt?: string;
}

interface MonitorSession {
  config: MonitorConfig;
  running: boolean;
  lastRunAt: number | null;
  lastError: string | null;
  ticker: NodeJS.Timeout;
}

// ======================================================================
// State
// ======================================================================

const monitors = new Map<string, MonitorSession>();
let webClient: WebClient | null = null;

// ======================================================================
// Config parsing
// ======================================================================

function parseMonitorConfig(): MonitorConfig[] {
  const raw = process.env.SLACK_MONITORS_CONFIG;
  if (!raw) return [];
  try {
    const configs = JSON.parse(raw) as MonitorConfig[];
    return configs.filter(c => c.enabled && c.name && c.channel && c.prompt);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err ?? 'unknown error') }, 'slack-l4: failed to parse SLACK_MONITORS_CONFIG');
    return [];
  }
}

// ======================================================================
// Start / Stop
// ======================================================================

export function startMonitors(web: WebClient): () => void {
  webClient = web;
  const configs = parseMonitorConfig();
  const stopFns: Array<() => void> = [];

  for (const cfg of configs) {
    const session: MonitorSession = {
      config: cfg,
      running: false,
      lastRunAt: null,
      lastError: null,
      ticker: undefined as unknown as NodeJS.Timeout
    };

    // Run first tick after 10s (let server finish booting), then on schedule
    const initialDelay = 10_000;
    setTimeout(() => {
      void runMonitorTick(session);
      session.ticker = setInterval(() => void runMonitorTick(session), cfg.intervalMs);
      session.ticker.unref?.();
    }, initialDelay);

    monitors.set(cfg.name, session);
    stopFns.push(() => {
      clearTimeout(session.ticker);
      clearInterval(session.ticker);
    });

    logger.info({ name: cfg.name, intervalMs: cfg.intervalMs }, 'slack-l4: monitor started');
  }

  return () => {
    stopFns.forEach(fn => fn());
    monitors.clear();
    logger.info('slack-l4: all monitors stopped');
  };
}

// ======================================================================
// Monitor tick
// ======================================================================

async function runMonitorTick(session: MonitorSession): Promise<void> {
  if (session.running) {
    logger.debug({ name: session.config.name }, 'slack-l4: skipping tick (previous still running)');
    return;
  }

  if (!webClient) return;

  session.running = true;
  const startTime = Date.now();

  try {
    const response = await callMonitorApi(session.config);

    session.lastRunAt = Date.now();
    session.lastError = null;

    // Post report to Slack
    const duration = Math.round((Date.now() - startTime) / 1000);

    await webClient.chat.postMessage({
      channel: session.config.channel,
      text: response + `\n\n_⏱ ${duration}s · ${new Date().toISOString().replace('T', ' ').slice(0, 19)}_`,
      unfurl_links: false
    });

    logger.info({ name: session.config.name, duration }, 'slack-l4: tick completed');
  } catch (err) {
    session.lastError = err instanceof Error ? err.message : String(err ?? 'unknown error');
    logger.warn({ name: session.config.name, err: session.lastError }, 'slack-l4: tick failed');

    // Post error to Slack (but not more than once per hour to avoid spam)
    try {
      await webClient.chat.postMessage({
        channel: session.config.channel,
        text: `⚠️ Monitor *${session.config.name}* failed: ${session.lastError.slice(0, 500)}`
      });
    } catch { /* can't even post to Slack */ }
  } finally {
    session.running = false;
  }
}

// ======================================================================
// Claude API call
// ======================================================================

async function callMonitorApi(cfg: MonitorConfig): Promise<string> {
  const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

  if (!apiKey) {
    return `⚠️ Monitor "${cfg.name}": ANTHROPIC_API_KEY not configured.`;
  }

  const systemPrompt = cfg.systemPrompt || [
    '你是一个 AI 监控助手，定时巡检 jobchat 项目。',
    '每次巡检你会收到一条 prompt 告诉你该检查什么。',
    '请用中文回复，格式化为 Slack mrkdwn。',
    '回复要简洁（3000 字以内），重点突出发现的问题和建议。',
    '如果一切正常，简单说明即可，不要过度展开。'
  ].join('\n');

  const body = {
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      { role: 'user' as const, content: cfg.prompt }
    ],
    stream: false
  };

  const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => 'unknown');
    throw new Error(`API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json() as any;
  const textBlocks = (data.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text);
  return textBlocks.join('\n') || '(empty response)';
}
