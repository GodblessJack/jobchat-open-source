// jchat/server/lib/slack-l1-task.ts
//
// L1: Slack @mention → Claude Code task execution (SDK session).
// When someone @mentions the bot in a Slack channel, this module:
//   1. Creates or finds a jchat DM conversation for the Slack thread
//   2. Persists the user message to jchat_messages
//   3. Launches a full SDK session (runQuery) — real file ops, MCP tools, code execution
//   4. Streams progress/results back to the Slack thread via emitter events
//
// Follow-ups in the same Slack thread are treated as new turns in the same
// jchat conversation, so context is retained across messages.
//
// Inactive when SLACK_BOT_TOKEN is not configured (graceful no-op).

import { logger } from '../logger.js';
import type { WebClient } from '@slack/web-api';
import { runQuery, getWorkerManager } from '../sdk/sdk-bridge.js';
import type { WorkerKey } from '../sdk/worker-manager.js';
import { createConversation } from '../conversation/conversation-repo.js';
import { appendMessage } from '../conversation/messages-repo.js';
import { buildPersonaPrompt } from '../agent/persona-builder.js';
import { getAgent } from '../agent/agent-repo.js';
import { buildMcpDescriptors } from '../mcp/index.js';
import { getPostSlackUpdateToolDef } from '../mcp/slack-progress-mcp.js';
import { getSpawnSubagentToolDef } from '../mcp/spawn-subagent-mcp.js';
import type { Uuid } from '@shared/domain.js';

// ======================================================================
// Config
// ======================================================================

const SLACK_USER_ID = process.env.SLACK_USER_ID || 'a0000000-0000-0000-0000-000000000001';
const SLACK_CODE_CONTACT_ID = process.env.SLACK_CODE_CONTACT_ID || 'e2000001-0000-0000-0000-000000000001';

// ======================================================================
// Types
// ======================================================================

interface L1Session {
  channel: string;
  threadTs: string;
  userId: string;          // Slack user ID
  conversationId: Uuid;    // jchat conversation ID
  lastActivity: number;
}

interface AppMentionEvent {
  type: 'app_mention';
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
  channel: string;
  event_ts: string;
}

// ======================================================================
// State
// ======================================================================

const sessions = new Map<string, L1Session>(); // key = channel:thread_ts
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min

// Cleanup stale sessions every 10 min
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, s] of sessions) {
    if (now - s.lastActivity > SESSION_TTL_MS) {
      sessions.delete(key);
      logger.debug({ channel: s.channel, threadTs: s.threadTs }, 'slack-l1: evicted stale session');
    }
  }
}, 10 * 60 * 1000);
cleanupInterval.unref?.();

// ======================================================================
// Session key
// ======================================================================

function sessionKey(channel: string, threadTs: string): string {
  return `${channel}:${threadTs}`;
}

// ======================================================================
// Main handler — called from slack-client.ts on app_mention event
// ======================================================================

export async function handleAppMention(event: AppMentionEvent, web: WebClient): Promise<void> {
  const channel = event.channel;
  const threadTs = event.thread_ts || event.ts;
  const slackUserId = event.user;

  // Strip <@BOTID> mention from the text
  const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

  if (!text) {
    try {
      await web.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: '👋 有事吗？@我 加上你的问题或任务，我会用 Claude Code 帮你处理。\n\n例如：`@jobchat-ops 帮我检查一下 sweeper.ts 有没有 bug`'
      });
    } catch { /* ignore */ }
    return;
  }

  const key = sessionKey(channel, threadTs);
  let session = sessions.get(key);

  // ------ Resolve or create the jchat conversation ------
  if (!session) {
    try {
      const conv = await createConversation({
        userId: SLACK_USER_ID as Uuid,
        type: 'dm',
        agentIds: [SLACK_CODE_CONTACT_ID as Uuid],
        title: `Slack ${channel} thread`
      });
      session = {
        channel,
        threadTs,
        userId: slackUserId,
        conversationId: conv.id as Uuid,
        lastActivity: Date.now()
      };
      sessions.set(key, session);
      logger.info({ conversationId: conv.id, channel, threadTs }, 'slack-l1: created conversation');
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'slack-l1: failed to create conversation');
      try {
        await web.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: '❌ 创建会话失败，请稍后重试。'
        });
      } catch { /* ignore */ }
      return;
    }
  }

  session.lastActivity = Date.now();

  // ------ Post "thinking" indicator ------
  const thinkingMsg = await web.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: '🤔 正在分析你的问题...'
  }).catch(() => null);
  const thinkingTs = thinkingMsg?.ts;

  // ------ Persist user message to jchat_messages ------
  let parentMessageId: Uuid | undefined;
  try {
    const msg = await appendMessage({
      conversationId: session.conversationId,
      senderType: 'user',
      senderId: SLACK_USER_ID as Uuid,
      content: text,
      deliveryStatus: 'final',
      metadata: { source: 'slack', slack_user: slackUserId, slack_channel: channel }
    } as any);
    parentMessageId = msg.id as Uuid;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'slack-l1: failed to persist user message');
    // Continue anyway — the agent can still reply
  }

  // ------ Build persona prompt ------
  let systemPrompt: string[] = [
    '你是一个 AI 编程助手，通过 Slack 与用户交互。',
    '用户的每条消息都是通过 @提及 发送的。',
    '你可以读写文件、执行 shell 命令、搜索代码、使用 git。',
    '请用中文回复，简洁高效。每次完成修改后总结你改了什么。',
    '用 `post_slack_update` 工具向用户汇报进度（重要步骤时调用）。',
  ];

  try {
    const agentRow = await getAgent(SLACK_CODE_CONTACT_ID as Uuid);
    if (agentRow) {
      const personaPrompt = await buildPersonaPrompt({
        userId: SLACK_USER_ID as Uuid,
        agentId: SLACK_CODE_CONTACT_ID as Uuid,
        agentName: agentRow.name || 'Slack Code',
        personaMarkdown: agentRow.personaMarkdown || undefined,
        identity: agentRow.identity || null,
        conversationType: 'dm',
        recallQuery: text,
      });
      systemPrompt = personaPrompt;
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'slack-l1: persona build failed, using fallback prompt');
  }

  // ------ Build MCP descriptors ------
  // Start with the global jchat-core + browser descriptors, then add the
  // session-scoped post_slack_update tool bound to this Slack thread.
  const globalDescriptors = buildMcpDescriptors({
    userId: SLACK_USER_ID as Uuid,
    agentId: SLACK_CODE_CONTACT_ID as Uuid,
    conversationId: session.conversationId,
  });

  const slackUpdateTool = getPostSlackUpdateToolDef({
    web,
    channel,
    threadTs,
  });

  const spawnSubagentTool = getSpawnSubagentToolDef({
    userId: SLACK_USER_ID as Uuid,
    conversationId: session.conversationId,
  });

  // Add post_slack_update and spawn_subagent to the jchat-core server
  const mcpDescriptors = globalDescriptors.map((desc) => {
    if (desc.serverName === 'jchat-core') {
      return {
        ...desc,
        tools: [...desc.tools, slackUpdateTool, spawnSubagentTool],
      };
    }
    return desc;
  });

  // If jchat-core wasn't present (shouldn't happen), add as standalone
  if (!mcpDescriptors.some(d => d.serverName === 'jchat-core')) {
    mcpDescriptors.push({
      serverName: 'slack',
      tools: [slackUpdateTool],
    });
  }

  // ------ Launch SDK session ------
  const workerKey: WorkerKey = {
    userId: SLACK_USER_ID as Uuid,
    agentId: SLACK_CODE_CONTACT_ID as Uuid,
    conversationId: session.conversationId,
  };

  logger.info({ workerKey, text: text.slice(0, 100) }, 'slack-l1: launching SDK session');

  try {
    const emitter = await runQuery({
      key: workerKey,
      prompt: text,
      sdkOptions: {
        systemPrompt,
        includePartialMessages: true,
        settingSources: ['project'],
        permissionMode: 'bypassPermissions',
        mcpDescriptors,
        // Disable web search tools from the model (ours work via MCP)
        disallowedTools: ['WebSearch', 'WebFetch'],
        maxTurns: 50,
      },
      singleTurn: true,
    });

    // ------ Stream progress to Slack ------
    let textBuffer = '';
    let lastSlackUpdate = Date.now();
    const SLACK_UPDATE_INTERVAL_MS = 8000; // Post to Slack at most every 8 seconds
    let slackUpdateCount = 0;
    const MAX_SLACK_UPDATES = 15; // Don't flood the thread

    // Update the "thinking" message with first real content
    const updateThinking = async (content: string) => {
      if (thinkingTs) {
        try {
          await web.chat.update({
            channel,
            ts: thinkingTs,
            text: content.slice(0, 1500),
          });
        } catch { /* ignore */ }
      }
    };

    emitter.on('event', (sdkEvent: any) => {
      // Extract text from SDK stream events
      try {
        // content_block_delta → text_delta
        if (sdkEvent?.type === 'stream_event' && sdkEvent?.event?.type === 'content_block_delta') {
          const delta = sdkEvent.event.delta;
          if (delta?.type === 'text_delta' && delta.text) {
            textBuffer += delta.text;

            // Update thinking message with first substantial content
            if (textBuffer.length > 50 && slackUpdateCount === 0) {
              updateThinking(textBuffer.slice(0, 300) + '...');
            }

            // Periodic full update to Slack thread
            const now = Date.now();
            if (now - lastSlackUpdate > SLACK_UPDATE_INTERVAL_MS && slackUpdateCount < MAX_SLACK_UPDATES) {
              lastSlackUpdate = now;
              slackUpdateCount++;
              const preview = textBuffer.length > 1500
                ? textBuffer.slice(-1200)
                : textBuffer;
              web.chat.postMessage({
                channel,
                thread_ts: threadTs,
                text: `💬 ${preview}`,
                unfurl_links: false,
              }).catch(() => {});
            }
          }
        }

        // Tool calls — post a note
        if (sdkEvent?.type === 'assistant' && sdkEvent?.message?.content) {
          for (const block of sdkEvent.message.content) {
            if (block.type === 'tool_use') {
              const toolMsg = `🔧 使用工具: \`${block.name}\``;
              web.chat.postMessage({
                channel,
                thread_ts: threadTs,
                text: toolMsg,
                unfurl_links: false,
              }).catch(() => {});
            }
          }
        }
      } catch { /* ignore parse errors */ }
    });

    // ------ Handle completion ------
    const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      emitter.once('done', () => {
        resolve({ ok: true });
      });
      emitter.once('error', (err: Error) => {
        resolve({ ok: false, error: err?.message || 'unknown error' });
      });
    });

    // Clean up thinking message
    if (thinkingTs) {
      try {
        await web.chat.delete({ channel, ts: thinkingTs });
      } catch { /* ignore */ }
    }

    if (result.ok) {
      // Persist the assistant reply
      const finalText = textBuffer.trim() || '(agent completed without text output)';
      try {
        await appendMessage({
          conversationId: session.conversationId,
          senderType: 'agent',
          senderId: SLACK_CODE_CONTACT_ID as Uuid,
          content: finalText,
          parentId: parentMessageId,
          deliveryStatus: 'final',
          metadata: { source: 'slack', slack_channel: channel }
        } as any);
      } catch (err) {
        logger.warn({ err: (err as Error).message }, 'slack-l1: failed to persist assistant message');
      }

      // Post final result to Slack
      const chunks = splitLongMessage(finalText, 2800);
      for (const chunk of chunks) {
        await web.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: chunk,
          unfurl_links: false,
        }).catch(() => {});
      }

      logger.info({ conversationId: session.conversationId, len: finalText.length },
        'slack-l1: SDK session completed');
    } else {
      // ------ Error handling ------
      const errMsg = result.error || 'unknown error';
      logger.warn({ err: errMsg, conversationId: session.conversationId },
        'slack-l1: SDK session failed');

      try {
        await appendMessage({
          conversationId: session.conversationId,
          senderType: 'agent',
          senderId: SLACK_CODE_CONTACT_ID as Uuid,
          content: `❌ 任务执行失败：${errMsg}`,
          parentId: parentMessageId,
          deliveryStatus: 'error',
          metadata: { source: 'slack' }
        } as any);
      } catch { /* ignore */ }

      await web.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `❌ 抱歉，处理你的请求时出错了：${errMsg.slice(0, 500)}`,
      }).catch(() => {});
    }

    // ------ Release worker ------
    try {
      const mgr = getWorkerManager();
      mgr.release(workerKey);
    } catch { /* best-effort */ }

  } catch (err) {
    logger.error({ err: (err as Error).message }, 'slack-l1: runQuery failed');

    if (thinkingTs) {
      try { await web.chat.delete({ channel, ts: thinkingTs }); } catch { /* ignore */ }
    }

    await web.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: `❌ 抱歉，无法启动 Claude Code：${(err as Error).message.slice(0, 500)}`,
    }).catch(() => {});
  }
}

// ======================================================================
// Helpers
// ======================================================================

function splitLongMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('\n\n', maxLen);
    if (splitAt < maxLen / 2) {
      splitAt = remaining.lastIndexOf('\n', maxLen);
      if (splitAt < maxLen / 2) splitAt = remaining.lastIndexOf(' ', maxLen);
      if (splitAt < maxLen / 2) splitAt = maxLen;
    }
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
