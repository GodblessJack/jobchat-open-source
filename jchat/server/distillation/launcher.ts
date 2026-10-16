// jchat/server/distillation/launcher.ts
//
// Spawns a headless SDK worker session bound to Jack's agent_id with a
// synthetic conversationId = `distill-<runId>`. Sends a fixed prompt that
// triggers the persona-distillation skill against the supplied X URL.
// Captures the `create_contact` MCP tool result via the onContactCreated
// hook (Task 3) and writes it to the run-registry.
//
// Plan: Task 4

import { runQuery, getWorkerManager } from '../sdk/sdk-bridge.js';
import { buildMcpDescriptors } from '../mcp/index.js';
import { buildPersonaPrompt } from '../agent/persona-builder.js';
import { logger } from '../logger.js';
import { markDone, markError } from './run-registry.js';
import { createContact, type CreateContactInput } from '../services/create-contact.js';
import { createContactInputSchemaStrict } from '../mcp/create-contact-mcp.js';
import { z } from 'zod';

/** Hardcoded Jack agent_id (sql/020_user_owned_agents.sql:113). */
const JACK_AGENT_ID = '00000000-0000-0000-0000-000000000001';

/** Jack's display name — used as a fallback agentName for buildPersonaPrompt
 *  without requiring a live Supabase call in the distillation path. */
const JACK_AGENT_NAME = 'Jack';

export interface LaunchDistillationOpts {
  runId: string;
  userId: string;
  xUrl: string;
  /** Optional WS broadcaster — when provided, fires 'contacts' topic on
   *  successful contact creation so the user's left-rail refreshes. */
  broadcastConvSnapshot?: (topic: string) => Promise<void> | void;
}

/**
 * Fire-and-forget. Resolves once the SDK query has been kicked off (i.e.
 * the emitter is wired up). The actual distillation completes
 * asynchronously and writes to the run-registry via the hook or the
 * emitter `done` / `error` events.
 */
export async function launchDistillation(opts: LaunchDistillationOpts): Promise<void> {
  const { runId, userId, xUrl, broadcastConvSnapshot } = opts;
  const conversationId = `distill-${runId}`;

  let contactCreatedSeen = false;
  let inflightPromise: Promise<void> | null = null;

  // Wrap caller's snapshot callback into the OrchestratorBroadcaster shape
  // expected by buildMcpDescriptors. The MCP create_contact tool only uses
  // broadcastTopicChanged ('contacts' topic on success); sendToUser is a
  // no-op for distillation (no streaming UI in the wizard path).
  const broadcaster = broadcastConvSnapshot
    ? {
        broadcastTopicChanged: (topic: string) => broadcastConvSnapshot(topic),
        sendToUser: () => {},
      }
    : null;

  const mcpDescriptors = buildMcpDescriptors({
    userId,
    agentId: JACK_AGENT_ID,
    conversationId,
    broadcaster,
    onContactCreated: (result) => {
      contactCreatedSeen = true;
      markDone(runId, {
        agent_id: result.agent_id,
        slug: result.slug_resolved,
        avatar_url: result.avatar_url,
        name: result.name,
      });
    },
  });

  const systemPromptParts = await buildPersonaPrompt({
    userId,
    agentId: JACK_AGENT_ID,
    agentName: JACK_AGENT_NAME,
    conversationType: 'dm',
  });
  const systemPrompt = systemPromptParts.join('\n');

  // Prompt that mimics what the user would type in Jack's chat to trigger
  // distillation. Matches the trigger phrases listed in skills/persona-
  // distillation/SKILL.md (line 6).
  //
  // The "headless mode" instruction is critical: the skill has two user-
  // confirmation checkpoints (Phase 1.5 调研质量, Phase 2.5 提炼确认) that
  // wait for a chat reply. The wizard has no user — without this bypass
  // the SDK session hangs forever at those phases. Spec §1.2 ("全部跳过
  // checkpoint, 黑盒跑完") makes this the contract.
  // The 【WIZARD_NO_CHECKPOINT】 token is a contract with
  // skills/persona-distillation/SKILL.md: Phase 0A / 1.5 / 2.5 / 4 / 5
  // checkpoints all skip when this token is present in the first user
  // message. Without the exact token the skill will hang waiting for
  // chat confirmation that never arrives (no user attached).
  //
  // The prompt also enumerates create_contact's required fields with
  // length requirements. Smoke runs showed the model would otherwise
  // call create_contact with {} and give up after a few rejections.
  const userPrompt =
    `【WIZARD_NO_CHECKPOINT】\n\n` +
    `请把这个 X 主页蒸馏成我的新好友：${xUrl}\n\n` +
    `这是 wizard 触发的无人值守流程：不要询问聚焦方向、不要在 Phase 0A / 1.5 / 2.5 / 4 / 5 ` +
    `暂停等确认。一路跑完 Phase 0 → 5，最终**必须**调用 mcp__jchat-core__create_contact 工具落库。\n\n` +
    `调用 create_contact 时必须传齐所有字段（不要传空对象 — 那会被服务端拒绝）：\n` +
    `- name: 1-80 字，从 X 主页提取的真名（如 "Naval Ravikant"）\n` +
    `- slug: 1-40 字符 [a-z0-9-]，通常是 x_handle 全小写（如 "naval"）\n` +
    `- skill_md: 100-50000 字，完整的 SKILL.md markdown 内容（包含 frontmatter、心智模型、表达 DNA、诚实边界等所有 section）\n` +
    `- persona_summary: **50-2000 字**，第一人称身份摘要（"我是 XXX，我相信 / 我习惯 / 我反对..."）\n` +
    `- initial_message: 10-1000 字，ta 见到用户时的第一句问候\n` +
    `- source_type: 固定值 "x_profile"\n` +
    `- source_url: "${xUrl}"\n` +
    `- x_handle: 1-15 字符 [A-Za-z0-9_]，URL 末尾的用户名\n` +
    `- bio: 可选，X 简介\n\n` +
    `调用前自检每个字段是否就位。任何字段缺失或不达长度都会被服务端拒绝。Phase 0 → 5 全部 success criterion 都是"create_contact 被成功调用且返回非 isError"。`;

  const sdkPrompt = {
    type: 'user',
    message: {
      role: 'user',
      content: userPrompt,
    },
    parent_tool_use_id: null,
    session_id: '',
  };

  let emitter;
  try {
    emitter = await runQuery({
      key: { userId, agentId: JACK_AGENT_ID, conversationId },
      prompt: sdkPrompt,
      // singleTurn ends the message queue immediately after the prompt
      // is pushed. Without this the SDK keeps the query alive waiting
      // for follow-up user input (chat protocol) and never emits `done`
      // even after the model has finished its final assistant turn.
      // The wizard has no user → must terminate after one turn.
      singleTurn: true,
      sdkOptions: {
        systemPrompt,
        includePartialMessages: false,
        settingSources: ['project'],
        permissionMode: 'bypassPermissions',
        mcpDescriptors,
        disallowedTools: ['WebSearch', 'WebFetch'],
      },
    });
  } catch (e) {
    markError(runId, 'SDK_LAUNCH_FAILED', (e as Error).message);
    return;
  }

  // Worker slot must be released exactly once per run, on whichever
  // terminal event fires. Otherwise the per-user pool count stays at 1
  // for the full duration of the distillation (60-120s+), starving the
  // user's normal chat replies.
  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    try {
      getWorkerManager().release({ userId, agentId: JACK_AGENT_ID, conversationId });
    } catch (e) {
      logger.warn({ runId, err: (e as Error)?.message }, 'worker release failed');
    }
  };

  // Server-side watchdog: 25 min. Real-world smoke runs on Naval
  // profile showed the 6-agent parallel research phase alone takes
  // ~10-12 min (6 agents × multiple browser_search calls), and the
  // Phase 2 synthesis adds 5+ min of pure LLM generation. 15 min
  // was killing valid mid-research runs. v2 can shorten by trimming
  // Phase 1 to a single-pass search.
  const SDK_TIMEOUT_MS = 25 * 60 * 1000;
  const watchdog = setTimeout(() => {
    const mins = Math.round(SDK_TIMEOUT_MS / 60000);
    logger.warn({ runId, mins }, 'distillation SDK watchdog fired');
    markError(runId, 'SDK_ERROR', `系统等待 ta 的回应超过了 ${mins} 分钟，先停下来。`);
    releaseOnce();
  }, SDK_TIMEOUT_MS);

  // CRITICAL: the SDK CLI bundled in @anthropic-ai/claude-agent-sdk
  // strips MCP tool args before invoking our handler when the model's
  // args fail its internal validation — even when our registered Zod
  // schema is loose. The model's intended args ARE present in the
  // assistant.tool_use.input field on the SDK event stream, though.
  //
  // To make the wizard actually work, we intercept create_contact
  // tool_use events here, validate the model's args ourselves, and
  // call the createContact service DIRECTLY — bypassing the SDK's
  // broken MCP arg-passing path. The SDK's downstream handler call
  // will still arrive (with empty args, returning a Zod error), but
  // by then we've already recorded the success in the registry, and
  // markDone is idempotent so the late handler can't undo it.
  let interceptInflight = false;
  emitter.on('event', (raw: unknown) => {
    try {
      const ev = raw as { type?: string; message?: { content?: Array<{ type?: string; text?: string; name?: string; input?: Record<string, unknown> }> } };
      if (ev?.type !== 'assistant' || !Array.isArray(ev.message?.content)) return;

      for (const block of ev.message.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          logger.debug({ runId, snippet: block.text.slice(0, 160) }, 'distillation assistant text');
          continue;
        }
        if (block.type !== 'tool_use' || typeof block.name !== 'string') continue;

        const isCreateContact = block.name.includes('create_contact');
        if (!isCreateContact) {
          logger.debug({ runId, tool: block.name }, 'distillation tool_use');
          continue;
        }

        const input = block.input ?? {};
        const summary = {
          keys: Object.keys(input),
          name: typeof input.name === 'string' ? input.name : '<missing>',
          slug: typeof input.slug === 'string' ? input.slug : '<missing>',
          skill_md_len: typeof input.skill_md === 'string' ? (input.skill_md as string).length : null,
          persona_summary_len: typeof input.persona_summary === 'string' ? (input.persona_summary as string).length : null,
          initial_message_len: typeof input.initial_message === 'string' ? (input.initial_message as string).length : null,
        };
        logger.debug({ runId, tool: block.name, args: summary }, 'distillation tool_use create_contact (model-sent args)');

        // Bypass: validate args ourselves and call the service directly.
        // contactCreatedSeen guards against double-invocation if the
        // model emits the same tool_use twice (rare but observed).
        if (contactCreatedSeen || interceptInflight) continue;
        const parsed = z.object(createContactInputSchemaStrict).safeParse(input);
        if (!parsed.success) {
          logger.debug(
            { runId, errors: parsed.error.issues.map((e) => `${e.path.join('.')}:${e.message}`) },
            'distillation create_contact intercept: invalid args, letting SDK error path handle it'
          );
          continue;
        }
        const validInput = parsed.data as CreateContactInput;
        interceptInflight = true;
        const broadcastFn = broadcaster
          ? (_uid: string, topic: string) => {
              broadcaster.broadcastTopicChanged(topic)?.catch(() => {});
            }
          : undefined;
        inflightPromise = Promise.resolve()
          .then(() => createContact(userId, validInput, broadcastFn))
          .then((result) => {
            logger.info({ runId, agentId: result.agent_id, slug: result.slug_resolved }, 'distillation: contact created via emitter intercept');
            contactCreatedSeen = true;
            markDone(runId, {
              agent_id: result.agent_id,
              slug: result.slug_resolved,
              avatar_url: result.avatar_url,
              name: result.name,
            });
          })
          .catch((e) => {
            interceptInflight = false;
            logger.warn(
              { runId, err: (e as Error)?.message },
              'distillation create_contact intercept: service threw — letting SDK error path retry'
            );
          })
          .finally(() => {
            inflightPromise = null;
          });
      }
    } catch {
      /* ignore */
    }
  });

  emitter.on('done', async () => {
    clearTimeout(watchdog);
    if (inflightPromise) {
      try {
        await inflightPromise;
      } catch {
        /* already logged in the catch above; just need the await to settle */
      }
    }
    if (!contactCreatedSeen) {
      markError(
        runId,
        'NO_CONTACT_CREATED',
        '没能为你生成 ta —— 可能 ta 在 X 上的公开内容太少。'
      );
    }
    releaseOnce();
  });
  emitter.on('error', (e) => {
    clearTimeout(watchdog);
    logger.warn({ runId, err: (e as Error)?.message }, 'distillation SDK error');
    markError(runId, 'SDK_ERROR', (e as Error)?.message ?? 'SDK error');
    releaseOnce();
  });
}
