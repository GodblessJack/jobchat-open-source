/**
 * agent-reply-orchestrator.ts — v2 SDK-driven orchestrator.
 *
 * Pipeline (per spec §7.1 steps [7]-[12]):
 *   1. Concurrency cap (per-conv, per-user, global) — see enforceConcurrency.
 *   2. Insert partial agent message + push snapshot so UI shows "typing".
 *   3. Build the system prompt via persona-builder (persona + custom
 *      instructions + group context + agent-memory recall RAG).
 *   4. Call sdk-bridge.runQuery() — spawns a per-(user,agent,conversation)
 *      worker subprocess, loads `agent_skills.enabled=true` via skill-loader,
 *      streams SDK events back via JSON-lines IPC.
 *   5. Translate SDK events into our protocol envelopes:
 *        stream_event/content_block_delta/text_delta -> `delta` (per token)
 *        stream_event/content_block_X/thinking_delta -> `thinking_delta`
 *        assistant message containing tool_use       -> `tool_call`
 *        result message                              -> final
 *   6. Persist message.content every PERSIST_EVERY_N chunks. Write the final
 *      content + delivery_status='final' on `done`.
 *   7. On any worker / SDK failure, fall back to the v1 Anthropic-direct
 *      single-shot call so the demo keeps working even if the worker pool
 *      is misconfigured (e.g. SESSIONS_ROOT missing).
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID as uuid } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { db } from '../lib/db.js';
import { jchatMessages } from '../sql/schema/index.js';
import { eq, desc, ne, and } from 'drizzle-orm';
import * as agentRepo from '../agent/agent-repo.js';
import { buildPersonaPrompt } from '../agent/persona-builder.js';
import { appendMessage, updateMessageContent, appendToolCall } from './messages-repo.js';
import { getConversation } from './conversation-repo.js';
import { enforceConcurrency, releaseSlot, extractMemoryAsync } from './group-dispatch.js';
import { runQuery, getWorkerManager } from '../sdk/sdk-bridge.js';
import { registerStream, attachWorker, unregisterStream, cancelStream, isStreamActive } from './stream-registry.js';
import { buildMcpDescriptors } from '../mcp/index.js';
import type { Uuid, ToolCallRecord } from '@shared/domain.js';
import type { ServerEnvelope } from '@shared/protocol.js';

// ===== Broadcaster injection =====

export interface OrchestratorBroadcaster {
  broadcastTopicChanged(topic: string): Promise<void> | void;
  sendToUser(userId: string, event: ServerEnvelope): void;
}

let broadcaster: OrchestratorBroadcaster | null = null;

export function setOrchestratorBroadcaster(b: OrchestratorBroadcaster): void {
  broadcaster = b;
}

// ===== Cancellation =====

/**
 * Cancel an active agent reply stream. Returns true if a stream was found
 * and aborted, false if no active stream exists for the given pair.
 *
 * Side effects: see `stream-registry.cancelStream` — fires both the orchestrator
 * AbortController and a worker-IPC abort. Does NOT update the message row;
 * the orchestrator's catch+finally write `[已取消] ...` and unregister.
 */
export function cancelAgentReply(conversationId: Uuid, agentId: Uuid): boolean {
  return cancelStream(conversationId, agentId);
}

// ===== Public entrypoint =====

export interface KickoffOpts {
  userId: Uuid;
  conversationId: Uuid;
  parentUserMessageId: Uuid;
  targetAgentIds: Uuid[];
  /** The user's message text — used as the recall query for persona-builder. */
  userMessageText?: string;
  /** Attachment metadata from user message (filePath, mime, size). */
  attachments?: Array<{ filePath: string; mime: string; size: number }>;
}

/** Persist every N text chunks to limit Postgres write rate (delta still pushes every chunk). */
const PERSIST_EVERY_N = 20;

/**
 * Indirection so tests can vi.spyOn this reference without fighting ES-module
 * live-binding rules. Production code always calls through this object.
 * Tests replace `_impl.runOneAgentReply` via `vi.spyOn(_impl, 'runOneAgentReply')`.
 */
export const _impl = {
  runOneAgentReply: (opts: RunOpts): Promise<void> => runOneAgentReply(opts)
};

/**
 * Fire-and-forget. Schedules each target agent to reply.
 * Caller (command-dispatcher.message.send) does NOT await.
 */
export function kickoffAgentReplies(opts: KickoffOpts): void {
  if (opts.targetAgentIds.length === 0) return;

  const decision = enforceConcurrency({
    userId: opts.userId,
    conversationId: opts.conversationId,
    targetAgentIds: opts.targetAgentIds
  });

  if (decision.admitted.length === 0) {
    logger.warn(
      { userId: opts.userId, conversationId: opts.conversationId, queued: decision.queued.length, reason: decision.reason },
      'agent-reply-orchestrator: all candidates queued by concurrency cap'
    );
    return;
  }

  // Dedup: filter out agents that already have an active stream for this
  // conversation. Without this check, a second message.send dispatched before
  // the first reply completes would create duplicate agent message rows (the
  // stream registry's abort-previous logic in registerStream prevents two
  // streams from running concurrently, but the second call would create its
  // own placeholder message before the abort — leaving two rows in the DB).
  const fresh = decision.admitted.filter(
    (agentId) => !isStreamActive(opts.conversationId, agentId)
  );
  if (fresh.length === 0 && decision.admitted.length > 0) {
    logger.info(
      { userId: opts.userId, conversationId: opts.conversationId, count: decision.admitted.length },
      'agent-reply-orchestrator: all admitted agents already have active streams (dedup)'
    );
    return;
  }

  // Serial fan-out: each agent's reply must fully persist before the next
  // begins so that the next agent's loadRecentHistory includes the prior
  // reply — this is the round-table "上一个说完下一个才开口" contract.
  // A 200ms delay is inserted between each agent to prevent a resource
  // spike when @all is used in a large group (e.g. 20+ agents all starting
  // SDK workers simultaneously).
  // Errors are caught per-agent so one failure does not stop the round.
  void (async () => {
    for (let i = 0; i < fresh.length; i++) {
      const agentId = fresh[i];
      try {
        // Stagger the start of each agent reply by 200ms so SDK workers
        // don't all spawn at the same instant.
        if (i > 0) {
          await new Promise((r) => setTimeout(r, 200));
        }
        await _impl.runOneAgentReply({
          userId: opts.userId,
          conversationId: opts.conversationId,
          parentUserMessageId: opts.parentUserMessageId,
          agentId,
          userMessageText: opts.userMessageText,
          attachments: opts.attachments
        });
      } catch (err) {
        logger.error(
          { err, agentId, conversationId: opts.conversationId },
          'agent reply failed (round-table continues)'
        );
      }
    }
  })();
}

interface RunOpts {
  userId: Uuid;
  conversationId: Uuid;
  parentUserMessageId: Uuid;
  agentId: Uuid;
  userMessageText?: string;
  /** Attachment metadata from user message (filePath, mime, size). */
  attachments?: Array<{ filePath: string; mime: string; size: number }>;
}

export async function runOneAgentReply(opts: RunOpts): Promise<void> {
  const conversationTopic = `conversation:${opts.conversationId}`;
  let placeholderId: Uuid | null = null;
  // Register an AbortController in the stream registry so dispatcher's
  // `message.cancel_stream` can interrupt this reply mid-flight. The
  // controller is also passed to runViaSdk + callAnthropic so the abort
  // signal propagates into the SDK pipeline / fetch.
  const abortController = new AbortController();
  const streamId = registerStream({
    userId: opts.userId,
    conversationId: opts.conversationId,
    agentId: opts.agentId,
    abortController
  });

  try {
    // 0. Finalize any stale partial messages from a previous run that was
    //    aborted but whose cancel handler failed to mark the message final.
    //    Without this, a crashed/cancelled stream leaves a permanent "typing"
    //    row that the user sees as stuck forever.
    {
      const staleRows = await db
        .select({ id: jchatMessages.id, content: jchatMessages.content })
        .from(jchatMessages)
        .where(
          and(
            eq(jchatMessages.conversationId, opts.conversationId),
            eq(jchatMessages.senderId, opts.agentId),
            eq(jchatMessages.senderType, 'agent'),
            eq(jchatMessages.deliveryStatus, 'partial')
          )
        )
        .limit(5);
      for (const row of staleRows) {
        const finalContent = row.content
          ? `[中断] ${row.content}`
          : '（上一条回复中断）';
        await updateMessageContent(row.id, finalContent, { deliveryStatus: 'final' }).catch(() => {});
      }
    }

    // 1. Persist a partial agent-message row immediately so the UI shows "typing".
    const placeholder = await appendMessage({
      conversationId: opts.conversationId,
      senderType: 'agent',
      senderId: opts.agentId,
      content: '',
      parentId: opts.parentUserMessageId,
      deliveryStatus: 'partial'
    });
    placeholderId = placeholder.id;

    await broadcaster?.broadcastTopicChanged(conversationTopic);

    // 2. Resolve agent + persona.
    const agent = await agentRepo.getAgentForUser(opts.userId, opts.agentId);
    if (!agent) {
      throw new Error(`agent not found: ${opts.agentId}`);
    }

    // 3. Resolve conversation type + group peers (for persona group context).
    const conv = await getConversation(opts.userId, opts.conversationId).catch(() => null);
    const conversationType: 'dm' | 'group' = conv?.type === 'group' ? 'group' : 'dm';
    let groupPeers: Array<{ id: Uuid; name: string; avatarUrl: string | null; description: string | null }> = [];
    if (conversationType === 'group' && conv?.members) {
      const peerIds = conv.members
        .filter((m) => m.agentId !== opts.agentId)
        .map((m) => m.agentId);
      const peerSummaries = await Promise.all(peerIds.map((id) => agentRepo.getAgent(id)));
      groupPeers = peerSummaries
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl ?? null, description: p.description ?? null }));
    }

    // 4a. Resolve active skills and their content for prompt injection.
    type ResolvedSkill = { name: string; content: string };
    const activeSkills: ResolvedSkill[] = [];
    try {
      const dbSkills = await agentRepo.getActiveSkillsForAgent(opts.agentId);
      // Skills source root: <jchat>/server/skills/<name>/SKILL.md
      const skillsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');
      for (const sk of dbSkills) {
        if (sk.inline_content) {
          activeSkills.push({ name: sk.name, content: sk.inline_content });
        } else {
          try {
            const mdPath = path.join(skillsRoot, sk.name, 'SKILL.md');
            const content = await fs.readFile(mdPath, 'utf-8');
            activeSkills.push({ name: sk.name, content });
          } catch {
            logger.warn({ skill: sk.name }, 'failed to read shared skill SKILL.md, skipping');
          }
        }
      }
    } catch (err) {
      logger.warn({ err, agentId: opts.agentId }, 'failed to resolve active skills for prompt');
    }

    // 4b. Build the system prompt (persona + custom instructions + group context + memory recall + skills).
    const systemPrompt: string[] = await buildPersonaPrompt({
      userId: opts.userId,
      agentId: opts.agentId,
      agentName: agent.name,
      personaMarkdown: agent.personaMarkdown,
      identity: agent.identity,
      customInstructions: agent.customInstructions,
      conversationType,
      groupPeers,
      recallQuery: opts.userMessageText,
      activeSkills
    });

    // 5. Try the SDK pipeline (worker + skill loading + per-token streaming).
    let usedSdk = false;
    try {
      await runViaSdk({
        opts,
        placeholderMessageId: placeholder.id,
        systemPrompt,
        agentName: agent.name,
        abortSignal: abortController.signal
      });
      usedSdk = true;
    } catch (sdkErr) {
      // If the user cancelled, do NOT fall through to v1 — the orchestrator's
      // outer try/catch will mark the message [已取消] below.
      if (abortController.signal.aborted) {
        throw sdkErr;
      }
      logger.warn(
        { err: (sdkErr as Error).message, agentId: opts.agentId, conversationId: opts.conversationId },
        'SDK pipeline failed; falling back to v1 Anthropic-direct call'
      );
    }

    // 6. Fallback to v1 Anthropic-direct if SDK failed.
    if (!usedSdk) {
      const history = await loadRecentHistory(opts.conversationId, 10);
      // Only fall back to history if the last entry is a user turn.
      const lastHistoryUser = history.length > 0 && history[history.length - 1].role === 'user'
        ? history[history.length - 1].content
        : '';
      const fallbackUserText = augmentWithAttachments(
        opts.userMessageText || lastHistoryUser || '',
        opts.attachments,
        config.filesRoot
      );
      const replyText = await callAnthropic(
        systemPrompt,
        history,
        fallbackUserText,
        abortController.signal
      );
      await updateMessageContent(placeholder.id, replyText, {
        deliveryStatus: 'final',
        ...(opts.attachments && opts.attachments.length > 0 ? { attachments: opts.attachments } : {}),
      });
      if (broadcaster) {
        broadcaster.sendToUser(opts.userId, {
          v: 1,
          type: 'delta',
          conversationId: opts.conversationId,
          messageId: placeholder.id,
          agentId: opts.agentId,
          textChunk: replyText,
          isFinal: true
        });
        await broadcaster.broadcastTopicChanged(conversationTopic);
      }
    }
  } catch (err) {
    const wasCancelled = abortController.signal.aborted;
    if (wasCancelled) {
      logger.info({ agentId: opts.agentId, conversationId: opts.conversationId }, 'agent reply cancelled by user');
    } else {
      logger.error({ err, agentId: opts.agentId }, 'agent reply orchestration error');
    }
    // Best-effort: mark partial as final. On cancel, prepend "[已取消] " so
    // the UI can distinguish from a normal completion.
    if (placeholderId) {
      try {
        if (wasCancelled) {
          // Read current accumulated content; preserve whatever streamed so far.
          const contentRows = await db
            .select({ content: jchatMessages.content })
            .from(jchatMessages)
            .where(eq(jchatMessages.id, placeholderId))
            .limit(1);
          const partial = contentRows[0]?.content ?? '';
          const finalText = partial.length > 0 ? `[已取消] ${partial}` : '[已取消]';
          await updateMessageContent(placeholderId, finalText, { deliveryStatus: 'final' });
          if (broadcaster) {
            broadcaster.sendToUser(opts.userId, {
              v: 1,
              type: 'delta',
              conversationId: opts.conversationId,
              messageId: placeholderId,
              agentId: opts.agentId,
              textChunk: '',
              isFinal: true
            });
          }
        } else {
          await updateMessageContent(placeholderId, '（回复失败，请稍后重试）', { deliveryStatus: 'final' });
        }
      } catch { /* ignore */ }
    }
    if (broadcaster) {
      try {
        await broadcaster.broadcastTopicChanged(conversationTopic);
      } catch { /* ignore */ }
    }
  } finally {
    unregisterStream(opts.conversationId, opts.agentId, streamId);
    releaseSlot(opts.userId, opts.conversationId);
  }
}

// ===== SDK pipeline =====

interface SdkRunArgs {
  opts: RunOpts;
  placeholderMessageId: Uuid;
  systemPrompt: string[];
  agentName: string;
  /**
   * AbortSignal from the orchestrator's stream registry. When aborted, the
   * SDK pipeline stops forwarding deltas and the watchdog rejects, which
   * propagates an error up to the orchestrator's catch — which then writes
   * the [已取消] final state.
   */
  abortSignal: AbortSignal;
}

/**
 * Drive the SDK worker. Streams content_block_delta/text_delta chunks as
 * `delta` events. Persists every PERSIST_EVERY_N chunks; flushes on `done`.
 *
 * Throws on init failure (caller will fall back to v1).
 */
/**
 * Scan agent reply content for /tmp/ file references and auto-copy them to
 * shared storage. Handles models that textually reference workspace files
 * without calling create_attachment.
 */
/**
 * Rewrite hallucinated zhipin.cn URLs in agent content to proper supabase://
 * URLs. The model persistently generates fake staging URLs instead of using
 * create_attachment. This function:
 * 1. Finds 📎 [name](https://jobchat.zhipin.cn/...) patterns
 * 2. Extracts the filename, looks for the file in the workspace root
 * 3. Copies the file to shared storage
 * 4. Rewrites the URL to supabase://<newPath>
 */
/** Scan the workspace for recently-created output files and auto-attach them.
 *  This catches files the agent creates via Bash/Python that aren't
 *  properly referenced in the message content. */
async function scanAndAttachRecentFiles(
  wsRoot: string,
  scope: { userId: string; conversationId: string },
): Promise<{ content: string; attachments: Array<{ filePath: string; mime: string; size: number }> }> {
  // Scan workspace + /tmp for recently-created output files. Agents use
  // Bash which writes to system /tmp/, not the workspace cwd. Include /tmp
  // but filter by uid to avoid cross-user leakage (codex P1 defense).
  const now = Date.now();
  const MAX_AGE_MS = 10 * 60 * 1000;
  const myUid = (typeof process !== 'undefined' && process.getuid) ? process.getuid() : -1;
  const scanDirs = [wsRoot, '/tmp'];
  const attachments: Array<{ filePath: string; mime: string; size: number }> = [];
  const mimeMap: Record<string, string> = {
    '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif',
    '.webp':'image/webp','.bmp':'image/bmp','.svg':'image/svg+xml',
    '.pdf':'application/pdf','.txt':'text/plain','.csv':'text/csv',
    '.md':'text/markdown','.json':'application/json','.html':'text/html',
    '.zip':'application/zip','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  try {
    for (const dir of scanDirs) {
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        // Skip debug / test artefacts. Agents can create intermediate files
        // (e.g. test_fpdf.pdf, debug_output.json) during tool use — these
        // must never leak to the user as auto-attached files.
        if (/^(test|debug|tmp|temp|scratch)[_\-.]/i.test(entry.name)) continue;
        if (/[._-](test|debug|tmp|scratch)[._-]/i.test(entry.name)) continue;
        const ext = path.extname(entry.name).toLowerCase();
        const mime = mimeMap[ext];
        if (!mime) continue;
        const fullPath = path.join(dir, entry.name);
        try {
          const st = await fs.stat(fullPath);
          if (st.size === 0 || st.size > config.uploadMaxSize) continue;
          if (now - st.mtimeMs > MAX_AGE_MS) continue;
          // For /tmp/, only accept files owned by current process uid
          if (dir === '/tmp' && myUid >= 0 && st.uid !== myUid) continue;
          const destRel = path.join('jchat', scope.userId, scope.conversationId, `${uuid()}-${entry.name}`);
          const destAbs = path.resolve(config.filesRoot, destRel);
          if (!destAbs.startsWith(path.resolve(config.filesRoot) + path.sep)) continue;
          await fs.mkdir(path.dirname(destAbs), { recursive: true });
          await fs.copyFile(fullPath, destAbs);
          attachments.push({ filePath: destRel, mime, size: st.size });
          logger.info({ src: fullPath, dest: destRel }, 'auto-attached recent workspace file');
        } catch { /* skip unreadable */ }
      }
    }
  } catch { /* not accessible */ }
  // Append attachment links to content if any found
  let content = '';
  if (attachments.length > 0) {
    content = '\n\n---\n';
    for (const a of attachments) {
      const name = path.basename(a.filePath);
      const isImage = a.mime.startsWith('image/');
      content += isImage
        ? `\n![${name}](supabase://${a.filePath})\n`
        : `\n📎 [${name} (${(a.size / 1024).toFixed(1)} KB)](supabase://${a.filePath})\n`;
    }
  }
  return { content, attachments };
}

async function rewriteZhipinUrls(
  content: string,
  wsRoot: string,
  scope: { userId: string; conversationId: string },
): Promise<{ content: string; attachments: Array<{ filePath: string; mime: string; size: number }> }> {
  const attachments: Array<{ filePath: string; mime: string; size: number }> = [];
  // Match both mail convention and bare links with zhipin.cn URLs
  const mailRe = /(📎\s*\[([^\]]+)\]\(https:\/\/jobchat\.zhipin\.cn\/[^)]+\))/g;
  const bareRe = /(\[([^\]]+)\]\(https:\/\/jobchat\.zhipin\.cn\/[^)]+\))/g;

  let rewritten = content;

  const processMatch = async (match: string, label: string): Promise<string | null> => {
    // Extract filename from label: "final-test-report.pdf PDF 8.9 KB" → "final-test-report.pdf"
    const namePart = label.split(/\s+/)[0];
    if (!namePart || !namePart.includes('.')) return null;
    const tmpPath = path.join(wsRoot, namePart);
    try {
      const st = await fs.stat(tmpPath);
      if (!st.isFile() || st.size === 0 || st.size > config.uploadMaxSize) return null;
      const ext = path.extname(namePart).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif',
        '.webp':'image/webp','.pdf':'application/pdf','.txt':'text/plain',
        '.csv':'text/csv','.json':'application/json',
      };
      const mime = mimeMap[ext] || 'application/octet-stream';
      const destRel = path.join('jchat', scope.userId, scope.conversationId, `${uuid()}-${namePart}`);
      const destAbs = path.resolve(config.filesRoot, destRel);
      if (!destAbs.startsWith(path.resolve(config.filesRoot) + path.sep)) return null;
      await fs.mkdir(path.dirname(destAbs), { recursive: true });
      await fs.copyFile(tmpPath, destAbs);
      attachments.push({ filePath: destRel, mime, size: st.size });
      const isImage = mime.startsWith('image/');
      return isImage
        ? `![${namePart}](supabase://${destRel})`
        : `📎 [${namePart} (${(st.size / 1024).toFixed(1)} KB)](supabase://${destRel})`;
    } catch {
      return null; // file doesn't exist
    }
  };

  // Process mail convention: 📎 [name](url)
  for (const m of content.matchAll(mailRe)) {
    const replacement = await processMatch(m[1], m[2]);
    if (replacement) {
      rewritten = rewritten.replace(m[1], replacement);
    }
  }
  // Process bare links: [name](url) — only unmatched ones
  for (const m of content.matchAll(bareRe)) {
    if (m[1].startsWith('📎')) continue; // already handled
    const replacement = await processMatch(m[1], m[2]);
    if (replacement) {
      rewritten = rewritten.replace(m[1], replacement);
    }
  }

  return { content: rewritten, attachments };
}


async function runViaSdk(args: SdkRunArgs): Promise<void> {
  const { opts, placeholderMessageId, systemPrompt, abortSignal } = args;

  const history = await loadRecentHistory(opts.conversationId, 10);
  const userText = opts.userMessageText && opts.userMessageText.trim().length > 0
    ? opts.userMessageText
    : (history.length > 0 ? history[history.length - 1].content : '');

  // Inject attachment references so the agent can see files the user uploaded.
  // Applied here (before the SDK/v1 branch) so both paths receive attachment refs.
  const augmentedUserText = augmentWithAttachments(userText, opts.attachments, config.filesRoot);

  const userPrompt = buildSdkUserPrompt(history, augmentedUserText);

  // SDK message shape — single-turn user message.
  const prompt = {
    type: 'user' as const,
    message: {
      role: 'user' as const,
      content: userPrompt
    },
    parent_tool_use_id: null,
    session_id: ''
  };

  // Attachments collected from create_attachment MCP tool calls during this
  // reply. Declared before buildMcpDescriptors so the onAttachmentCreated
  // closure can safely reference it (callbacks are deferred, not called
  // synchronously during buildMcpDescriptors).
  const collectedAttachments: Array<{ filePath: string; mime: string; size: number }> = [];

  // Distillation toolchain (parse_x_url, check_distillation_quota, create_contact,
  // create_attachment). userId/agentId/conversationId are bound by closure —
  // never trusted from tool args. workspacePath is resolved after worker
  // acquisition and injected via a getter closure.
  let workspacePath = '';
  const mcpDescriptors = buildMcpDescriptors({
    userId: opts.userId,
    agentId: opts.agentId,
    conversationId: opts.conversationId,
    broadcaster,
    getWorkspacePath: () => workspacePath,
    onAttachmentCreated: (ref) => {
      collectedAttachments.push(ref);
    },
  });

  const sdkOptions: Record<string, unknown> = {
    systemPrompt,
    includePartialMessages: true,
    settingSources: ['project'],
    permissionMode: 'bypassPermissions',
    mcpDescriptors,
    // Hide the SDK's built-in `WebSearch` / `WebFetch` from the model.
    // Those run server-side on Anthropic's API; our endpoint is the
    // BigModel-anthropic shim which does NOT implement them. If the model
    // calls them it never gets a tool_result and the worker hangs until
    // the orchestrator's 120s watchdog fires (Boss-reported as "Elon says
    // he can't search the internet"). The `browser` MCP server registered
    // in `mcp/index.ts` provides a working `browser_search` / `browser_fetch`
    // backed by Zhipu Web Search.
    disallowedTools: ['WebSearch', 'WebFetch']
  };
  if (config.anthropicModel) sdkOptions.model = config.anthropicModel;

  const emitter = await runQuery({
    key: { userId: opts.userId, agentId: opts.agentId, conversationId: opts.conversationId },
    prompt,
    sdkOptions,
    singleTurn: true
  });

  // Attach the worker handle to the stream registry so cancel can also fire
  // an `abort` IPC into the worker subprocess.
  attachWorker(opts.conversationId, opts.agentId, emitter.worker);

  // Resolve workspace path from the acquired worker handle so the
  // create_attachment MCP tool can copy files out of the sandbox.
  const spawnedWorker = emitter.worker as { workspacePath?: string } | undefined;
  if (spawnedWorker?.workspacePath) {
    workspacePath = spawnedWorker.workspacePath;
  }

  const conversationTopic = `conversation:${opts.conversationId}`;
  let accumulated = '';
  let chunksSinceFlush = 0;
  const toolCalls: ToolCallRecord[] = [];

  const handleEvent = async (raw: unknown): Promise<void> => {
    // Stop forwarding deltas once cancelled. The watchdog promise below will
    // reject shortly after via the abort listener.
    if (abortSignal.aborted) return;
    const ev = raw as { type?: string; event?: { type?: string; index?: number; delta?: { type?: string; text?: string; thinking?: string } }; message?: { content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> } };
    if (!ev || typeof ev !== 'object') return;

    // Per-token streaming: type='stream_event', event.type='content_block_delta'
    if (ev.type === 'stream_event' && ev.event && ev.event.type === 'content_block_delta') {
      const delta = ev.event.delta;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
        accumulated += delta.text;
        chunksSinceFlush += 1;
        if (broadcaster) {
          broadcaster.sendToUser(opts.userId, {
            v: 1,
            type: 'delta',
            conversationId: opts.conversationId,
            messageId: placeholderMessageId,
            agentId: opts.agentId,
            textChunk: delta.text
          });
        }
        if (chunksSinceFlush >= PERSIST_EVERY_N) {
          chunksSinceFlush = 0;
          // Best-effort partial persistence.
          updateMessageContent(placeholderMessageId, accumulated).catch((e) =>
            logger.warn({ err: e, placeholderMessageId }, 'partial persist failed')
          );
        }
        return;
      }
      if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking.length > 0) {
        // Thinking content (LLM chain-of-thought) is NOT forwarded to the frontend.
        // It contains internal system mechanics (skill names, routing logic, etc.) that
        // must not be exposed to end users. Log it server-side for debugging only.
        logger.info({ agentId: opts.agentId, conversationId: opts.conversationId, thinkingLen: delta.thinking.length }, 'thinking_delta suppressed');
        return;
      }
    }

    // Full assistant turn — extract any tool_use blocks for tool_call event.
    if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
      for (const block of ev.message.content) {
        if (block.type === 'tool_use' && block.id && block.name) {
          const tc: ToolCallRecord = {
            id: block.id,
            name: block.name,
            args: (block.input as Record<string, unknown>) ?? {},
            status: 'start',
            ts: new Date().toISOString()
          };
          toolCalls.push(tc);
          appendToolCall(placeholderMessageId, tc).catch((e) =>
            logger.warn({ err: e, toolName: block.name }, 'appendToolCall failed')
          );
          if (broadcaster) {
            broadcaster.sendToUser(opts.userId, {
              v: 1,
              type: 'tool_call',
              conversationId: opts.conversationId,
              messageId: placeholderMessageId,
              agentId: opts.agentId,
              toolName: block.name,
              status: 'start'
            });
          }
        }
      }
      // Fallback: if no per-token deltas were emitted (e.g. SDK didn't stream),
      // capture the assistant text from the full message so we still get content.
      if (accumulated.length === 0) {
        const text = ev.message.content
          .filter((c) => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text!)
          .join('');
        if (text.length > 0) {
          accumulated = text;
          if (broadcaster) {
            broadcaster.sendToUser(opts.userId, {
              v: 1,
              type: 'delta',
              conversationId: opts.conversationId,
              messageId: placeholderMessageId,
              agentId: opts.agentId,
              textChunk: text
            });
          }
        }
      }
    }

    // Tool result from SDK user message — forward as tool_call result.
    if (ev.type === 'user' && (ev as any).tool_use_result !== undefined && (ev as any).parent_tool_use_id) {
      const userMsg = ev as { type: 'user'; parent_tool_use_id: string; tool_use_result?: unknown };
      if (broadcaster) {
        broadcaster.sendToUser(opts.userId, {
          v: 1,
          type: 'tool_call',
          conversationId: opts.conversationId,
          messageId: placeholderMessageId,
          agentId: opts.agentId,
          toolName: userMsg.parent_tool_use_id,
          status: 'result',
          result: userMsg.tool_use_result,
        });
      }
      return;
    }

    // Tool progress heartbeat — forward as tool_call progress.
    if (ev.type === 'tool_progress') {
      const tp = ev as { type: 'tool_progress'; tool_use_id: string; tool_name: string; elapsed_time_seconds: number };
      if (broadcaster) {
        broadcaster.sendToUser(opts.userId, {
          v: 1,
          type: 'tool_call',
          conversationId: opts.conversationId,
          messageId: placeholderMessageId,
          agentId: opts.agentId,
          toolName: tp.tool_name,
          status: 'progress',
          result: { tool_use_id: tp.tool_use_id, elapsed: tp.elapsed_time_seconds },
        });
      }
      return;
    }
  };

  emitter.on('event', (raw: unknown) => {
    void handleEvent(raw).catch((e) =>
      logger.warn({ err: e, agentId: opts.agentId }, 'event handler failed')
    );
  });

  // Watchdog: if neither 'done' nor 'error' fires within REPLY_TIMEOUT_MS,
  // assume the worker has hung and reject. The rejection propagates out of
  // runViaSdk and is caught by the orchestrator's outer try/catch, which then
  // falls through to the v1 Anthropic-direct fallback path (see line ~165).
  // The fallback writes a final reply, so the placeholder will not stay
  // 'partial' forever (the bug Boss saw with Elon at 05:11).
  // 5 min — generous for agentic skills (Elon does search + fetch + Bash +
  // synthesis; 2 min was killing legitimate exploratory replies). The fallback
  // path is still v1 Anthropic-direct so a hung worker eventually surfaces a
  // user-visible message.
  const REPLY_TIMEOUT_MS = 300_000;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const onDone = () => { if (!settled) { settled = true; cleanup(); resolve(); } };
    const onError = (e: unknown) => { if (!settled) { settled = true; cleanup(); reject(e); } };
    const onAbort = () => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('cancelled by user'));
      }
    };
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`agent reply timed out after ${REPLY_TIMEOUT_MS}ms`));
      }
    }, REPLY_TIMEOUT_MS);
    function cleanup() {
      clearTimeout(timer);
      emitter.removeListener('done', onDone);
      emitter.removeListener('error', onError);
      abortSignal.removeEventListener('abort', onAbort);
      // Release the worker slot back to the pool on every exit path
      // (success, error, timeout, abort). Without this, the inUseCount
      // never decrements on failure paths and the pool leaks entries.
      try {
        getWorkerManager().release({
          userId: opts.userId,
          agentId: opts.agentId,
          conversationId: opts.conversationId
        });
      } catch { /* ignore — release is best-effort */ }
    }
    emitter.once('done', onDone);
    emitter.once('error', onError);
    abortSignal.addEventListener('abort', onAbort, { once: true });
    if (abortSignal.aborted) onAbort();
  });

  // Flush final content + mark final. Auto-attach workspace files:
  // 1. Rewrite hallucinated zhipin.cn URLs → supabase://
  // 2. Auto-attach recently-created workspace files (PDF, PNG, etc.)
  //    regardless of whether the agent references them in text.
  let finalText = accumulated.length > 0 ? accumulated : '（空回复）';
  if (workspacePath) {
    try {
      // Scan workspace for files created during this session and auto-attach them.
      // This catches files the agent created but didn't properly reference.
      const scannedAttached = await scanAndAttachRecentFiles(workspacePath, {
        userId: opts.userId,
        conversationId: opts.conversationId,
      });
      if (scannedAttached.attachments.length > 0) {
        collectedAttachments.push(...scannedAttached.attachments);
        // Append attachment links to agent's text, don't overwrite (codex P1)
        finalText += scannedAttached.content;
        logger.info({ count: scannedAttached.attachments.length }, 'auto-attached recent workspace files');
      }
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'scan-and-attach failed (non-fatal)');
    }
    // Always try URL rewriting — zhipin.cn links can appear alongside
    // legit attachments (codex P2)
    {
      try {
        const rewriteResult = await rewriteZhipinUrls(finalText, workspacePath, {
          userId: opts.userId,
          conversationId: opts.conversationId,
        });
        if (rewriteResult.attachments.length > 0) {
          finalText = rewriteResult.content;
          collectedAttachments.push(...rewriteResult.attachments);
        }
      } catch (e) {
        logger.warn({ err: (e as Error).message }, 'zhipin URL rewrite failed (non-fatal)');
      }
    }
  }
  await updateMessageContent(placeholderMessageId, finalText, {
    deliveryStatus: 'final',
    ...(collectedAttachments.length > 0 ? { attachments: collectedAttachments } : {}),
  });

  // Persist agent reply to RAG memory for future recall (fire-and-forget).
  setImmediate(() => {
    extractMemoryAsync({
      userId: opts.userId,
      agentId: opts.agentId,
      conversationId: opts.conversationId,
      agentMessageId: placeholderMessageId,
      text: finalText,
      importance: 0.5
    }).catch((err) => logger.warn({ err, placeholderMessageId }, 'extractMemoryAsync failed'));
  });

  if (broadcaster) {
    // Send a terminal isFinal=true delta with empty text so clients can
    // close out the streaming UI without re-painting the whole message.
    broadcaster.sendToUser(opts.userId, {
      v: 1,
      type: 'delta',
      conversationId: opts.conversationId,
      messageId: placeholderMessageId,
      agentId: opts.agentId,
      textChunk: '',
      isFinal: true
    });
    await broadcaster.broadcastTopicChanged(conversationTopic);
  }

  // Worker slot already released in cleanup() inside the Promise above —
  // covers success, error, timeout, and abort paths uniformly.
}

// ===== v1 fallback (Anthropic-direct, kept for resilience) =====

interface HistoryRow {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Build the single-user-message prompt sent to the SDK.
 *
 * The trailing row of `history` is the current user message in a DM (or in
 * the FIRST speaker of a group round-table turn) — including it in
 * `historyContext` would just duplicate `userText`, so we drop it. In a
 * serial round-table where a previous agent has already spoken THIS turn,
 * the trailing row is that prior agent's reply, which MUST stay in
 * `historyContext` so the next speaker can build on or challenge it.
 * Discriminate by the last row's `role`.
 *
 * Exported for unit tests; the runtime path goes through `runViaSdk`.
 */
/** Inject attachment references (supabase:// URLs) into user text so the agent
 *  can see files the user uploaded. Images get markdown image syntax,
 *  non-images get the 📎 file-card convention. Used by both SDK and v1 fallback. */
export function augmentWithAttachments(
  userText: string,
  attachments?: Array<{ filePath: string; mime: string; size: number }>,
  filesRoot?: string
): string {
  if (!attachments || attachments.length === 0) return userText;
  const lines: string[] = [];
  const root = filesRoot ? path.resolve(filesRoot) : null;
  for (const a of attachments) {
    const name = a.filePath.split('/').pop() || 'file';
    const sizeStr = a.size > 0 ? ` (${(a.size / 1024).toFixed(1)} KB)` : '';
    const localPath = root ? path.join(root, a.filePath) : null;
    if (a.mime.startsWith('image/')) {
      lines.push(`![${name}](supabase://${a.filePath})`);
    } else {
      // Include local filesystem path so the agent can use the Read tool to access the file.
      const localHint = localPath ? ` → 本地路径: ${localPath}` : '';
      lines.push(`📎 [${name}${sizeStr}](supabase://${a.filePath})${localHint}`);
    }
  }
  if (lines.length === 0) return userText;
  return `${userText}\n\n[用户上传的附件]\n${lines.join('\n')}`;
}

export function buildSdkUserPrompt(history: HistoryRow[], userText: string): string {
  const last = history[history.length - 1];
  const contextHistory = last?.role === 'user' ? history.slice(0, -1) : history;
  const historyContext = contextHistory.map((h) => `[${h.role}] ${h.content}`).join('\n');
  return historyContext
    ? `## Conversation so far\n\n${historyContext}\n\n## Current message\n\n${userText}`
    : userText;
}

async function loadRecentHistory(conversationId: Uuid, limit: number): Promise<HistoryRow[]> {
  const rows = await db
    .select({
      senderType: jchatMessages.senderType,
      content: jchatMessages.content,
      createdAt: jchatMessages.createdAt,
      deliveryStatus: jchatMessages.deliveryStatus,
    })
    .from(jchatMessages)
    .where(and(
      eq(jchatMessages.conversationId, conversationId),
      ne(jchatMessages.senderType, 'system')
    ))
    .orderBy(desc(jchatMessages.createdAt))
    .limit(limit)
    .catch((err) => {
      logger.warn({ err, conversationId }, 'loadRecentHistory failed');
      return [];
    });

  if (!Array.isArray(rows)) return [];

  return rows
    .reverse()
    .filter((r) => (r.content ?? '').trim().length > 0 && r.deliveryStatus !== 'partial')
    .map((r) => ({
      role: r.senderType === 'user' ? ('user' as const) : ('assistant' as const),
      content: r.content as string
    }));
}

async function callAnthropic(
  systemPrompt: string | string[],
  history: HistoryRow[],
  currentUserText: string | undefined,
  signal?: AbortSignal
): Promise<string> {
  const baseUrl = config.anthropicBaseUrl || 'https://api.anthropic.com';
  const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;
  const model = config.anthropicModel || 'claude-sonnet-4-20250514';

  // The Anthropic REST API accepts system as a string or an array of text blocks.
  const system: string | Array<{ type: 'text'; text: string }> = Array.isArray(systemPrompt)
    ? systemPrompt.map((s) => ({ type: 'text' as const, text: s }))
    : systemPrompt;

  // Build messages with three guarantees BigModel/Anthropic both require:
  //   (a) non-empty
  //   (b) strict user/assistant alternation (collapse consecutive same-role rows)
  //   (c) ends with a `user` turn
  // Without these the upstream returns `code 1214 messages 参数非法` (BigModel)
  // or 400 invalid_request_error (Anthropic).
  const collapsed: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const h of history) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.role === h.role) {
      last.content += '\n\n' + h.content;
    } else {
      collapsed.push({ role: h.role, content: h.content });
    }
  }
  // Make sure the trailing turn is a user turn — append currentUserText if
  // history ends with assistant (or is empty). currentUserText is the user
  // message that triggered this reply; it may not yet be in `history` because
  // loadRecentHistory filters partial rows.
  const tail = collapsed[collapsed.length - 1];
  const userText = currentUserText && currentUserText.trim().length > 0
    ? currentUserText
    : '继续';
  if (!tail || tail.role !== 'user') {
    collapsed.push({ role: 'user', content: userText });
  } else if (currentUserText && tail.content !== currentUserText) {
    // History already ends with a user turn but it's a stale one — append
    // the current message so the model sees it.
    collapsed.push({ role: 'assistant', content: '（继续）' });
    collapsed.push({ role: 'user', content: userText });
  }

  const body = {
    model,
    max_tokens: 4096,
    system,
    messages: collapsed
  };

  // Compose a hard fetch timeout with the user-cancel AbortSignal. The
  // outer caller's signal aborts on cancel; the inner one aborts after
  // 90s so a stuck upstream can't leave the placeholder agent message
  // 'partial' forever (the SDK pipeline has its own 5min watchdog, but
  // we're already on the fallback path — that watchdog is gone).
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), 90_000);
  const composedSignal = signal
    ? AbortSignal.any([signal, timeoutCtrl.signal])
    : timeoutCtrl.signal;
  let r: Response;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal: composedSignal
    });
  } finally {
    clearTimeout(timer);
  }

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`anthropic api ${r.status}: ${text.slice(0, 300)}`);
  }

  const json = (await r.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (json.content || [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text!)
    .join('\n')
    .trim();

  return text || '（空回复）';
}
