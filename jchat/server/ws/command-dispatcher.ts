// jchat/server/ws/command-dispatcher.ts
//
// Routes a `command` envelope to the correct repo/service handler. Returns
// the ack `result` (which the router wraps in `{type:'ack', id, result}`).
// Throws `JchatError` on validation/auth/internal failures — the router
// catches and converts to `{type:'error', id, code, message}`.
//
// Cross-module imports below resolve to other subagents' work. To avoid
// import-time crashes if a sibling module hasn't landed yet, we use lazy
// `await import()` inside each handler. That keeps this file compilable
// in isolation while still picking up the real implementations once they
// exist on the same `server/<area>/<file>.ts` paths.

import path from 'node:path';
import { JchatError, ErrorCodes } from '@shared/errors.js';
import type {
  ClientCommandName,
  ConversationCreatePayload,
  ConversationOpenPayload,
  ConversationRenamePayload,
  ConversationArchivePayload,
  ConversationDeletePayload,
  ConversationSearchPayload,
  ConversationLoadMorePayload,
  MemberAddPayload,
  MemberRemovePayload,
  MessageSendPayload,
  MessageCancelStreamPayload,
  MessageEditPayload,
  MessageDeletePayload,
  FileUploadInitPayload,
  FileUploadCompletePayload,
  FileSignedUrlPayload,
  InputSyncDraftPayload,
  AgentSkillsListPayload
} from '@shared/protocol.js';

/**
 * Per-request auth context — populated by `ws-auth-middleware` on upgrade
 * and attached to each WS. Sibling subagent owns the real shape; we declare
 * the minimum we need here.
 */
export interface WsAuthContext {
  userId: string;
  email?: string | null;
  jwt: string;
}

export interface CommandContext {
  auth: WsAuthContext;
  /** Stable identifier for this socket (used by input.sync_draft etc.). */
  clientId: string;
  /** Logger child scoped to this request — optional. */
  log?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

type Handler<P, R> = (payload: P, ctx: CommandContext) => Promise<R>;

/**
 * The dispatcher itself is stateless — each call resolves to a `result`
 * payload. We expose a single `dispatch(name, payload, ctx)` entrypoint
 * plus a typed handler table for tests.
 */
export class CommandDispatcher {
  async dispatch(
    name: ClientCommandName,
    payload: unknown,
    ctx: CommandContext
  ): Promise<unknown> {
    const handler = this.handlers[name] as Handler<unknown, unknown> | undefined;
    if (!handler) {
      throw new JchatError(ErrorCodes.VALIDATION_ERROR, `unknown command: ${name}`);
    }
    return handler(payload, ctx);
  }

  // ---------- Handler table ----------
  // Each handler does a minimal payload shape check, then delegates to the
  // appropriate sibling module via lazy import. The lazy imports are wrapped
  // in `loadModule()` which converts ENOENT-style failures into a clear
  // `WORKER_UNAVAILABLE` / `INTERNAL_ERROR` so partial integration is
  // diagnosable in dev.

  private readonly handlers: { [K in ClientCommandName]: Handler<unknown, unknown> } = {
    'conversation.create': async (p, ctx) => {
      const payload = expectObj<ConversationCreatePayload>(p, ['type', 'agentIds']);
      const repo = await loadModule('../conversation/conversation-repo.js');
      // DM dedup: if asking for a DM with a single agent, return the existing
      // (user, agent) DM if one exists. Avoids sidebar duplicate rows when the
      // user repeatedly clicks an agent in the directory.
      const isSingletonDm =
        payload.type === 'dm' &&
        Array.isArray(payload.agentIds) &&
        payload.agentIds.length === 1;
      // Deduplicate agentIds — duplicate IDs in a single batch cause
      // unique-constraint violations that surface as INTERNAL_ERROR.
      const deduped = [...new Set(payload.agentIds)];
      const conv = isSingletonDm
        ? await repo.findOrCreateDm(ctx.auth.userId, payload.agentIds[0])
        : await repo.createConversation({
            userId: ctx.auth.userId,
            type: payload.type,
            agentIds: deduped,
            title: payload.title
          });
      // Spec contract: ack returns `{ conversationId }`, not the full ConversationSummary.
      return { conversationId: conv.id };
    },

    'conversation.open': async (p, ctx) => {
      const payload = expectObj<ConversationOpenPayload>(p, ['conversationId']);
      const repo = await loadModule('../conversation/conversation-repo.js');
      const conv = await repo.getConversation(ctx.auth.userId, payload.conversationId);
      // Best-effort: touch lastReadAt on the user_agents row for the DM agent
      // so the UI can show unread indicators. Fire-and-forget — failures are
      // swallowed (the conversation.open ack takes priority).
      if (conv && conv.type === 'dm' && conv.members && conv.members.length === 1) {
        setImmediate(async () => {
          try {
            const { db } = await import('../lib/db.js');
            const { userAgents } = await import('../sql/schema/index.js');
            const { eq, and } = await import('drizzle-orm');
            await db.update(userAgents)
              .set({ lastReadAt: new Date() })
              .where(and(
                eq(userAgents.userId, ctx.auth.userId),
                eq(userAgents.agentId, conv.members[0].agentId)
              ));
          } catch { /* best-effort */ }
        });
      }
      return conv;
    },

    'conversation.rename': async (p, ctx) => {
      const payload = expectObj<ConversationRenamePayload>(p, ['conversationId', 'title']);
      const repo = await loadModule('../conversation/conversation-repo.js');
      return repo.renameConversation(ctx.auth.userId, payload.conversationId, payload.title);
    },

    'conversation.archive': async (p, ctx) => {
      const payload = expectObj<ConversationArchivePayload>(p, ['conversationId']);
      const repo = await loadModule('../conversation/conversation-repo.js');
      return repo.archiveConversation(ctx.auth.userId, payload.conversationId);
    },

    'conversation.delete': async (p, ctx) => {
      const payload = expectObj<ConversationDeletePayload>(p, ['conversationId']);
      const repo = await loadModule('../conversation/conversation-repo.js');
      return repo.deleteConversation(ctx.auth.userId, payload.conversationId);
    },

    'conversation.search': async (p, ctx) => {
      const payload = expectObj<ConversationSearchPayload>(p, ['q']);
      const search = await loadModule('../search/search-repo.js');
      return search.searchMessages(ctx.auth.userId, payload.q, payload.limit ?? 20);
    },

    'conversation.load_more': async (p, ctx) => {
      const payload = expectObj<ConversationLoadMorePayload>(p, ['conversationId', 'beforeMessageId']);
      // Ownership gate: getConversation throws AUTH_FORBIDDEN if the
      // conversation is owned by a different user, returns null if nonexistent.
      const convRepo = await loadModule('../conversation/conversation-repo.js');
      const conv = await convRepo.getConversation(ctx.auth.userId, payload.conversationId);
      if (!conv) throw new JchatError(ErrorCodes.VALIDATION_ERROR, 'conversation not found');
      const repo = await loadModule('../conversation/messages-repo.js');
      return repo.loadHistory(payload.conversationId, {
        beforeMessageId: payload.beforeMessageId,
        limit: payload.limit ?? 50
      });
    },

    'agent.skills.list': async (p, ctx) => {
      const payload = expectObj<AgentSkillsListPayload>(p, ['agentId']);
      const agentRepo = await loadModule('../agent/agent-repo.js');
      // Visibility gate FIRST — never read skills before confirming the
      // caller can see this agent (anti-enumeration).
      await agentRepo.assertAgentVisibleToUser(ctx.auth.userId, payload.agentId);
      const skills = await agentRepo.getAgentSkillViews(payload.agentId);
      return { skills };
    },

    'member.add': async (p, ctx) => {
      const payload = expectObj<MemberAddPayload>(p, ['conversationId', 'agentId']);
      const repo = await loadModule('../conversation/conversation-repo.js');
      return repo.addMember(ctx.auth.userId, payload.conversationId, payload.agentId);
    },

    'member.remove': async (p, ctx) => {
      const payload = expectObj<MemberRemovePayload>(p, ['conversationId', 'agentId']);
      const repo = await loadModule('../conversation/conversation-repo.js');
      return repo.removeMember(ctx.auth.userId, payload.conversationId, payload.agentId);
    },

    'message.send': async (p, ctx) => {
      const payload = expectObj<MessageSendPayload>(p, ['conversationId', 'content']);
      // group-dispatch.dispatchUserMessage's preamble says auth is checked
      // upstream — it wasn't. Without this guard any authenticated user can
      // POST a message into another user's conversation (service-role write),
      // triggering that user's agent reply at the attacker's prompt. Cheapest
      // ownership check: getConversation() throws AUTH_FORBIDDEN if the row
      // exists but is owned by another user, and returns null if missing —
      // both are correct rejection paths here.
      const convRepoForAuth = await loadModule('../conversation/conversation-repo.js');
      const owned = await convRepoForAuth.getConversation(ctx.auth.userId, payload.conversationId);
      // getConversation throws AUTH_FORBIDDEN when the row exists but isn't
      // owned; null means missing. Return AUTH_FORBIDDEN in both cases so the
      // server doesn't leak conversation-exists info to an attacker probing
      // for IDs.
      if (!owned) throw new JchatError(ErrorCodes.AUTH_FORBIDDEN, 'conversation not accessible');
      // Validate attachment paths — must start with jchat/<userId>/ to prevent
      // path traversal (e.g. ../../../etc/passwd).
      if (payload.attachments && payload.attachments.length > 0) {
        const prefix = `jchat/${ctx.auth.userId}/`;
        for (const a of payload.attachments) {
          if (!a.filePath || !a.filePath.startsWith(prefix)) {
            throw new JchatError(ErrorCodes.VALIDATION_ERROR, `invalid attachment path: ${a.filePath}`);
          }
        }
      }
      const dispatch = await loadModule('../conversation/group-dispatch.js');
      const agentRepo = await loadModule('../agent/agent-repo.js');

      // Inject agent name lookup (server-side, real Supabase query)
      const agentNameLookup = async (ids: string[]) => {
        const map = new Map<string, string>();
        for (const id of ids) {
          const a = await agentRepo.getAgent(id);
          if (a) map.set(id, a.name);
        }
        return map;
      };

      const result = await dispatch.dispatchUserMessage(
        {
          userId: ctx.auth.userId,
          conversationId: payload.conversationId,
          payload: {
            content: payload.content,
            mentions: payload.mentions,
            attachments: payload.attachments,
            parentId: payload.parentId ?? null
          }
        },
        agentNameLookup
      );

      // v1 minimal orchestrator (non-streaming Anthropic API direct call —
      // simpler than full SDK + worker-manager for v1; see WAKE_UP_CHECKLIST.md).
      if (result.targetAgentIds.length > 0) {
        const orch = await loadModule('../conversation/agent-reply-orchestrator.js');
        orch.kickoffAgentReplies({
          userId: ctx.auth.userId,
          conversationId: payload.conversationId,
          parentUserMessageId: result.userMessage.id,
          targetAgentIds: result.targetAgentIds,
          userMessageText: payload.content,
          attachments: payload.attachments
        });
      }

      return { messageId: result.userMessage.id };
    },

    'message.cancel_stream': async (p, ctx) => {
      const payload = expectObj<MessageCancelStreamPayload>(p, ['conversationId', 'agentId']);
      // Any authenticated user could otherwise cancel another user's agent
      // reply mid-stream just by guessing/scraping conversationId + agentId.
      // getConversation throws AUTH_FORBIDDEN if the conversation is owned by
      // a different user; if it returns null the conversation doesn't exist
      // and the cancel is a no-op (still authorized to fail silently).
      const repo = await loadModule('../conversation/conversation-repo.js');
      await repo.getConversation(ctx.auth.userId, payload.conversationId);
      const orch = await loadModule('../conversation/agent-reply-orchestrator.js');
      const cancelled = orch.cancelAgentReply(payload.conversationId, payload.agentId);
      return { ok: true, cancelled };
    },

    'message.edit': async (p, ctx) => {
      const payload = expectObj<MessageEditPayload>(p, ['messageId', 'content']);
      const repo = await loadModule('../conversation/messages-repo.js');
      return repo.editMessage(ctx.auth.userId, payload.messageId, payload.content);
    },

    'message.delete': async (p, ctx) => {
      const payload = expectObj<MessageDeletePayload>(p, ['messageId']);
      const repo = await loadModule('../conversation/messages-repo.js');
      return repo.softDeleteMessage(ctx.auth.userId, payload.messageId);
    },

    'file.upload_init': async (p, ctx) => {
      const payload = expectObj<FileUploadInitPayload>(p, ['conversationId', 'filename', 'mime', 'size']);
      // Ownership gate: only the conversation owner can upload files to it.
      // getConversation throws AUTH_FORBIDDEN when owned by another user;
      // returns null when the conversation doesn't exist — both must reject.
      const convRepo = await loadModule('../conversation/conversation-repo.js');
      const owned = await convRepo.getConversation(ctx.auth.userId, payload.conversationId);
      if (!owned) throw new JchatError(ErrorCodes.AUTH_FORBIDDEN, 'conversation not accessible');
      const storage = await loadModule('../storage/signed-url.js');
      return storage.uploadInit({ ...payload, userId: ctx.auth.userId });
    },

    'file.upload_complete': async (p, ctx) => {
      const payload = expectObj<FileUploadCompletePayload>(p, ['filePath']);
      const storage = await loadModule('../storage/signed-url.js');
      return storage.uploadComplete({ ...payload, userId: ctx.auth.userId });
    },

    'file.signed_url': async (p, ctx) => {
      const payload = expectObj<FileSignedUrlPayload>(p, ['filePath']);
      // Authorization: resolve first, then verify ownership — naive prefix
      // checks are defeated by ../ sequences (e.g. jchat/userA/../userB/...).
      const filesRoot = (await import('../config.js')).config.filesRoot;
      const resolved = path.resolve(filesRoot, payload.filePath);
      const expectedDir = path.resolve(filesRoot, 'jchat', ctx.auth.userId) + path.sep;
      if (!resolved.startsWith(expectedDir)) {
        throw new JchatError(ErrorCodes.AUTH_FORBIDDEN, 'file not owned by user');
      }
      const storage = await loadModule('../storage/signed-url.js');
      return storage.signedDownloadUrl(payload.filePath);
    },

    'input.sync_draft': async (p, ctx) => {
      const payload = expectObj<InputSyncDraftPayload>(p, ['conversationId', 'text']);
      // The router (not the dispatcher) is responsible for fanning out the
      // resulting `input_sync_broadcast` event to other tabs. Dispatcher only
      // returns ack {ok:true} — actual broadcast is handled at router level
      // via WsRouter.broadcastInputSyncDraft.
      return { ok: true as const, payload };
    }
  };
}

// ===== Helpers =====

function expectObj<T>(payload: unknown, requiredKeys: ReadonlyArray<keyof T & string>): T {
  if (!payload || typeof payload !== 'object') {
    throw new JchatError(ErrorCodes.VALIDATION_ERROR, 'payload must be an object');
  }
  const obj = payload as Record<string, unknown>;
  for (const k of requiredKeys) {
    if (obj[k] === undefined) {
      throw new JchatError(ErrorCodes.VALIDATION_ERROR, `missing required field: ${String(k)}`);
    }
  }
  return obj as T;
}

/**
 * Lazy-load a sibling module relative to this file. If the module is missing
 * (sibling subagent hasn't landed it yet), throw `WORKER_UNAVAILABLE` so the
 * client gets a clear error instead of a server crash.
 *
 * The cast to `any` is intentional — sibling modules don't exist at type-check
 * time. Once they land, a follow-up pass can replace `any` with proper types.
 */

async function loadModule(relativePath: string): Promise<any> {
  try {

    const mod: any = await import(relativePath);
    return mod;
  } catch (err) {
    throw new JchatError(
      ErrorCodes.WORKER_UNAVAILABLE,
      `module not yet available: ${relativePath}`,
      { error: err instanceof Error ? err.message : String(err) }
    );
  }
}
