// jchat/server/conversation/group-dispatch.ts
//
// Spec §7.1 — 13-step dispatch from a user message to N agent replies.
// Plan §6.4 splits this into 4 cooperating functions:
//
//   dispatchUserMessage()  — steps [1]-[5] : persist user msg + resolve targets
//   enforceConcurrency()   — steps [6]-[7] : per-user/conv/global limit gating
//   streamAgentReply()     — steps [8]-[12]: per-agent SDK streaming + persist
//   extractMemoryAsync()   — step  [13]    : fire-and-forget memory chunk write
//
// Worker-manager and ws-router are dependencies but their final shape is
// owned by other agents — we declare narrow handle types here so we can
// wire the real implementation later without rewriting this module.

import type { MessageAttachmentRef, MessageSummary, ToolCallRecord, Uuid } from '@shared/domain.js';
import { ErrorCodes, JchatError } from '@shared/errors.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { addMemory } from '../agent/agent-memory.js';
import { parseMentions, type MentionMember } from './mention-parser.js';
import {
  appendMessage,
  appendToolCall,
  updateMessageContent
} from './messages-repo.js';
import { getConversationMembers } from './conversation-repo.js';

// ===== Concurrency tracking =====

interface ConcurrencyTracker {
  perUser: Map<Uuid, number>;
  perConversation: Map<Uuid, number>;
  global: number;
}

function makeTracker(): ConcurrencyTracker {
  return { perUser: new Map(), perConversation: new Map(), global: 0 };
}

const tracker: ConcurrencyTracker = makeTracker();

/** TEST HOOK — reset internal counters between unit tests. */
export function __resetConcurrencyForTest(): void {
  tracker.perUser.clear();
  tracker.perConversation.clear();
  tracker.global = 0;
}

function incCounter(userId: Uuid, conversationId: Uuid): void {
  tracker.perUser.set(userId, (tracker.perUser.get(userId) ?? 0) + 1);
  tracker.perConversation.set(conversationId, (tracker.perConversation.get(conversationId) ?? 0) + 1);
  tracker.global += 1;
}

function decCounter(userId: Uuid, conversationId: Uuid): void {
  const newUserCount = Math.max(0, (tracker.perUser.get(userId) ?? 0) - 1);
  if (newUserCount === 0) {
    tracker.perUser.delete(userId);
  } else {
    tracker.perUser.set(userId, newUserCount);
  }
  const newConvCount = Math.max(0, (tracker.perConversation.get(conversationId) ?? 0) - 1);
  if (newConvCount === 0) {
    tracker.perConversation.delete(conversationId);
  } else {
    tracker.perConversation.set(conversationId, newConvCount);
  }
  tracker.global = Math.max(0, tracker.global - 1);
}

// ===== Worker / WS contracts (narrow stubs — fulfilled by other modules) =====

export interface WorkerStreamEvents {
  textChunk: string;
  toolCall: ToolCallRecord;
  thinkingDelta: string;
  finalText: string;
  error: Error;
}

export interface WorkerHandle {
  sessionId: Uuid;
  /** Iterate stream events. Implementations are typically async iterators. */
  stream: AsyncIterable<
    | { kind: 'text'; chunk: string }
    | { kind: 'tool'; toolCall: ToolCallRecord }
    | { kind: 'thinking'; chunk: string }
    | { kind: 'final'; text: string }
    | { kind: 'error'; error: Error }
  >;
  /** Best-effort abort. */
  abort(): void;
}

export interface WorkerManagerLike {
  acquire(opts: {
    userId: Uuid;
    agentId: Uuid;
    conversationId: Uuid;
  }): Promise<WorkerHandle>;
}

export interface WsBroadcastLike {
  delta(ev: { conversationId: Uuid; messageId: Uuid; agentId: Uuid; textChunk: string; isFinal?: boolean }): void;
  toolCall(ev: { conversationId: Uuid; messageId: Uuid; agentId: Uuid; toolCall: ToolCallRecord }): void;
  thinkingDelta(ev: { conversationId: Uuid; messageId: Uuid; agentId: Uuid; textChunk: string }): void;
  conversationSnapshot(conversationId: Uuid): void;
}

// ===== Step 1-5: dispatchUserMessage =====

export interface DispatchUserMessageOpts {
  userId: Uuid;
  conversationId: Uuid;
  payload: {
    content: string;
    mentions?: Uuid[]; // client-side hint; ignored — server reparses
    attachments?: MessageAttachmentRef[];
    parentId?: Uuid | null;
  };
}

export interface DispatchResult {
  userMessage: MessageSummary;
  targetAgentIds: Uuid[];
  members: { agentId: Uuid; name: string }[];
}

/**
 * Step [1]-[5]: persist the user message and decide which agents (if any)
 * should reply. Returns the persisted user-message row plus the resolved
 * target agent IDs.
 *
 * `agentNameLookup` is injected so this function stays pure-ish; in
 * production it's a callback that does a Supabase IN-query against the
 * `agents` table; in unit tests it's a Map.
 */
export async function dispatchUserMessage(
  opts: DispatchUserMessageOpts,
  agentNameLookup: (agentIds: Uuid[]) => Promise<Map<Uuid, string>>
): Promise<DispatchResult> {
  // [1][2] auth + ownership checked upstream by ws-router. We trust opts here.
  if (!opts.payload.content?.trim() && (!opts.payload.attachments || opts.payload.attachments.length === 0)) {
    throw new JchatError(ErrorCodes.VALIDATION_ERROR, 'message content or attachments required');
  }

  // Build the canonical (server-authoritative) member list with names.
  const memberRows = await getConversationMembers(opts.conversationId);
  const memberAgentIds = memberRows.map((m) => m.agentId);
  const nameMap = await agentNameLookup(memberAgentIds);
  const members: MentionMember[] = memberRows
    .filter((m) => nameMap.has(m.agentId))
    .map((m) => ({ agentId: m.agentId, name: nameMap.get(m.agentId)! }));

  // [3] Server-authoritative mention parsing. Client-side `mentions` is ignored.
  const parsed = parseMentions(opts.payload.content || '', members);

  // Persist the user message.
  const userMessage = await appendMessage({
    conversationId: opts.conversationId,
    senderType: 'user',
    senderId: opts.userId,
    content: opts.payload.content || '',
    mentions: parsed.isExplicitAll ? memberAgentIds : parsed.mentions,
    attachments: opts.payload.attachments,
    parentId: opts.payload.parentId ?? null,
    deliveryStatus: 'final'
  });

  // [4] snapshot push happens at ws-router layer (post-call). Realtime
  //     row-insert is automatic via supabase_realtime publication.

  // [5] Dispatch decision: three-way branch based on mention parse result.
  //
  // memberRows already arrives in joined_at ASC order — see
  // conversation-repo.loadMembers.
  const memberAgentIdsOrdered = memberAgentIds; // already join-ordered
  let targetAgentIds: Uuid[];

  if (parsed.isExplicitAll) {
    // @all / @everyone — round-table fan-out to every member.
    targetAgentIds = [...memberAgentIdsOrdered];
  } else if (parsed.mentions.length > 0) {
    // Specific @mentions — narrow to the mentioned subset, in join order.
    const mentionedSet = new Set(parsed.mentions);
    targetAgentIds = memberAgentIdsOrdered.filter((id) => mentionedSet.has(id));
  } else {
    // No @mention at all — no agent should reply.
    targetAgentIds = [];
  }

  // DM exception preserved: a 1-member "group" still always-replies.
  if (targetAgentIds.length === 0 && memberAgentIdsOrdered.length === 1) {
    targetAgentIds = [memberAgentIdsOrdered[0]];
  }

  // File-sharing in groups: empty text + attachments + >1 members → broadcast.
  if (targetAgentIds.length === 0 && memberAgentIdsOrdered.length > 1 && opts.payload.attachments && opts.payload.attachments.length > 0) {
    targetAgentIds = [...memberAgentIdsOrdered];
  }

  return {
    userMessage,
    targetAgentIds,
    members: members.map((m) => ({ agentId: m.agentId, name: m.name }))
  };
}

// ===== Step 6-7: enforceConcurrency =====

export interface ConcurrencyDecision {
  /** Agents that may proceed immediately (counter incremented). */
  admitted: Uuid[];
  /** Agents that are queued (over a limit). Caller should surface "等待中" UX. */
  queued: Uuid[];
  reason?: string;
}

export interface EnforceConcurrencyOpts {
  userId: Uuid;
  conversationId: Uuid;
  targetAgentIds: Uuid[];
}

/**
 * Step [6]: gate target agents against per-user, per-conversation, and
 * global limits. Admitted slots have their counter incremented; the caller
 * MUST pair every admit with releaseSlot() once the worker stream completes.
 */
export function enforceConcurrency(opts: EnforceConcurrencyOpts): ConcurrencyDecision {
  const admitted: Uuid[] = [];
  const queued: Uuid[] = [];
  for (const agentId of opts.targetAgentIds) {
    const userCount = tracker.perUser.get(opts.userId) ?? 0;
    const convCount = tracker.perConversation.get(opts.conversationId) ?? 0;
    const globalCount = tracker.global;
    if (userCount >= config.concurrentAgentsPerUser) {
      queued.push(agentId);
      continue;
    }
    if (convCount >= config.concurrentAgentsPerConv) {
      queued.push(agentId);
      continue;
    }
    if (globalCount >= config.globalWorkerLimit) {
      queued.push(agentId);
      continue;
    }
    incCounter(opts.userId, opts.conversationId);
    admitted.push(agentId);
  }
  const decision: ConcurrencyDecision = { admitted, queued };
  if (queued.length > 0) {
    decision.reason =
      `concurrency limits: per-user=${config.concurrentAgentsPerUser}, ` +
      `per-conv=${config.concurrentAgentsPerConv}, global=${config.globalWorkerLimit}`;
  }
  return decision;
}

export function releaseSlot(userId: Uuid, conversationId: Uuid): void {
  decCounter(userId, conversationId);
}

// ===== Step 8-12: streamAgentReply =====

export interface StreamAgentReplyOpts {
  userId: Uuid;
  conversationId: Uuid;
  agentId: Uuid;
  parentMessageId: Uuid;
  workerManager: WorkerManagerLike;
  ws: WsBroadcastLike;
  /** Persist intermediate text every N text chunks. Default 20. */
  persistChunkInterval?: number;
}

export interface StreamAgentReplyResult {
  agentMessageId: Uuid;
  finalText: string;
  status: 'final' | 'error';
  error?: Error;
}

const PERSIST_INTERVAL_DEFAULT = 20;

/**
 * Step [8]-[12]: acquire a worker, create the agent message row, pump
 * stream events to WS + DB, and finalize.
 *
 * Slot release is the CALLER's responsibility (they own the
 * enforceConcurrency admission), so we don't decrement here.
 */
export async function streamAgentReply(
  opts: StreamAgentReplyOpts
): Promise<StreamAgentReplyResult> {
  // [7] worker-manager.acquire() — returns a WorkerHandle.
  const worker = await opts.workerManager.acquire({
    userId: opts.userId,
    agentId: opts.agentId,
    conversationId: opts.conversationId
  });

  // [8] Create a NEW jchat_messages row (sender_type='agent', partial).
  const agentMsg = await appendMessage({
    conversationId: opts.conversationId,
    senderType: 'agent',
    senderId: opts.agentId,
    content: '',
    parentId: opts.parentMessageId,
    sdkSessionId: worker.sessionId,
    deliveryStatus: 'partial'
  });

  let textBuf = '';
  let chunkCount = 0;
  const persistEvery = opts.persistChunkInterval ?? PERSIST_INTERVAL_DEFAULT;
  let finalText = '';
  let errored: Error | null = null;

  try {
    for await (const ev of worker.stream) {
      switch (ev.kind) {
        case 'text': {
          textBuf += ev.chunk;
          chunkCount += 1;
          opts.ws.delta({
            conversationId: opts.conversationId,
            messageId: agentMsg.id,
            agentId: opts.agentId,
            textChunk: ev.chunk
          });
          if (chunkCount % persistEvery === 0) {
            await updateMessageContent(agentMsg.id, textBuf).catch((err) => {
              logger.warn({ err, messageId: agentMsg.id }, 'mid-stream persist failed');
            });
          }
          break;
        }
        case 'tool': {
          await appendToolCall(agentMsg.id, ev.toolCall);
          opts.ws.toolCall({
            conversationId: opts.conversationId,
            messageId: agentMsg.id,
            agentId: opts.agentId,
            toolCall: ev.toolCall
          });
          break;
        }
        case 'thinking': {
          opts.ws.thinkingDelta({
            conversationId: opts.conversationId,
            messageId: agentMsg.id,
            agentId: opts.agentId,
            textChunk: ev.chunk
          });
          break;
        }
        case 'final': {
          finalText = ev.text || textBuf;
          break;
        }
        case 'error': {
          errored = ev.error;
          break;
        }
      }
    }
  } catch (err) {
    errored = err instanceof Error ? err : new Error(String(err));
  }

  // [12] Finalize.
  if (errored) {
    await updateMessageContent(agentMsg.id, textBuf || '', { deliveryStatus: 'error' }).catch(
      () => {}
    );
    opts.ws.delta({
      conversationId: opts.conversationId,
      messageId: agentMsg.id,
      agentId: opts.agentId,
      textChunk: '',
      isFinal: true
    });
    opts.ws.conversationSnapshot(opts.conversationId);
    return { agentMessageId: agentMsg.id, finalText: textBuf, status: 'error', error: errored };
  }

  const text = finalText || textBuf;
  await updateMessageContent(agentMsg.id, text, { deliveryStatus: 'final' });
  opts.ws.delta({
    conversationId: opts.conversationId,
    messageId: agentMsg.id,
    agentId: opts.agentId,
    textChunk: '',
    isFinal: true
  });
  opts.ws.conversationSnapshot(opts.conversationId);
  return { agentMessageId: agentMsg.id, finalText: text, status: 'final' };
}

// ===== Step 13: extractMemoryAsync =====

export interface ExtractMemoryOpts {
  userId: Uuid;
  agentId: Uuid;
  conversationId: Uuid;
  agentMessageId: Uuid;
  text: string;
  importance?: number;
}

/**
 * Step [13]: spawn a fire-and-forget memory write. Always returns
 * immediately; failures are swallowed (logged inside addMemory).
 *
 * Caller pattern:
 *   setImmediate(() => extractMemoryAsync(...).catch(err => logger.error(...)));
 */
export async function extractMemoryAsync(opts: ExtractMemoryOpts): Promise<void> {
  // v1: take the entire reply as one chunk. v2 will split on paragraphs / tokens.
  const text = (opts.text || '').trim();
  if (!text) return;
  // Skip pure tool-call replies (no natural-language signal).
  if (text.length < 8) return;
  await addMemory({
    userId: opts.userId,
    agentId: opts.agentId,
    sourceConversationId: opts.conversationId,
    sourceMessageId: opts.agentMessageId,
    chunkText: text,
    importance: opts.importance ?? 0.5
  });
}

/** Used by tests + status snapshots. */
export function getConcurrencySnapshot(): {
  perUser: Record<string, number>;
  perConversation: Record<string, number>;
  global: number;
} {
  return {
    perUser: Object.fromEntries(tracker.perUser),
    perConversation: Object.fromEntries(tracker.perConversation),
    global: tracker.global
  };
}

/**
 * Cancel handle — small struct returned by orchestrator so ws-router can
 * cancel a running stream. Each entry is a (conversationId, agentId) pair
 * that the orchestrator wires to the worker handle's abort().
 */
export interface CancelRegistry {
  register(conversationId: Uuid, agentId: Uuid, abort: () => void): void;
  cancel(conversationId: Uuid, agentId: Uuid): void;
}

export function createCancelRegistry(): CancelRegistry {
  const map = new Map<string, () => void>();
  const key = (c: Uuid, a: Uuid) => `${c}::${a}`;
  return {
    register(c, a, abort) {
      map.set(key(c, a), abort);
    },
    cancel(c, a) {
      const fn = map.get(key(c, a));
      if (fn) {
        try {
          fn();
        } catch (err) {
          logger.warn({ err, conversationId: c, agentId: a }, 'cancel handler threw');
        }
        map.delete(key(c, a));
      }
    }
  };
}
