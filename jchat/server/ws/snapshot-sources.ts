/**
 * Snapshot sources — derived read-models per spec §6.1.
 *
 * Each source maps a (userId, topic) → snapshot payload that's broadcast
 * to subscribed clients via WsRouter. Sources are registered at boot in
 * `server/index.ts` via `router.registerSnapshotSource(prefix, source)`.
 *
 * Topics:
 *   - `contacts`              → list of agents the user can see + sidebar conversations
 *   - `conversation:<id>`     → full conversation snapshot (members, messages)
 *   - `presence`              → multi-tab device count for the user
 *   - `agent-status`          → running/idle/failed status of agents
 *   - `search:<query>`        → FTS results (one-shot; client sends search command)
 */

import type { SnapshotSource } from './ws-router.js';
import * as agentRepo from '../agent/agent-repo.js';
import * as conversationRepo from '../conversation/conversation-repo.js';
import * as messagesRepo from '../conversation/messages-repo.js';
import { getAgentStatusProjection } from '../conversation/stream-registry.js';
import { logger } from '../logger.js';

/** topic = 'contacts' */
export const contactsSource: SnapshotSource = {
  async load(userId: string, _topic: string) {
    const [agents, conversations] = await Promise.all([
      agentRepo.listAgentsForUser(userId),
      conversationRepo.listConversationsForUser(userId)
    ]);
    return { agents, conversations };
  }
};

/** topic = 'conversation:<id>' */
export const conversationSource: SnapshotSource = {
  async load(userId: string, topic: string) {
    const conversationId = topic.split(':')[1];
    if (!conversationId) return null;

    const conv = await conversationRepo.getConversation(userId, conversationId);
    if (!conv) return null;  // not authorized or doesn't exist

    const messages = await messagesRepo.loadHistory(conversationId, { limit: 100 });

    return {
      conversation: conv,
      messages,
      streamingByAgentId: {},  // populated later by streaming-aware diff
    };
  }
};

/**
 * Multi-tab device count is owned by WsRouter (`usersIndex` Map). The router
 * injects a counter at boot via `setPresenceCountSource` so this module stays
 * import-cycle-free.
 */
let presenceCountSource: ((userId: string) => number) | null = null;
export function setPresenceCountSource(fn: ((userId: string) => number) | null): void {
  presenceCountSource = fn;
}

/** topic = 'presence' */
export const presenceSource: SnapshotSource = {
  async load(userId: string, _topic: string) {
    const devices = presenceCountSource ? presenceCountSource(userId) : 1;
    return { devices, otherTabs: [] };
  }
};

/** topic = 'agent-status' */
export const agentStatusSource: SnapshotSource = {
  async load(userId: string, _topic: string) {
    // Real source of truth is the in-memory stream registry — `jchat_sdk_sessions`
    // (sql/015) was specced for cross-instance state but we never write it. The
    // single-process daemon owns the live registry directly. Scoped by userId
    // so each subscriber only sees their own running streams.
    return getAgentStatusProjection(userId);
  }
};

/**
 * Bind all sources onto a WsRouter instance.
 * Call once at server boot.
 */
export function registerAllSnapshotSources(router: {
  registerSnapshotSource: (prefix: string, source: SnapshotSource) => void;
}): void {
  router.registerSnapshotSource('contacts', contactsSource);
  router.registerSnapshotSource('conversation', conversationSource);
  router.registerSnapshotSource('presence', presenceSource);
  router.registerSnapshotSource('agent-status', agentStatusSource);
  logger.info('snapshot sources registered: contacts, conversation, presence, agent-status');
}
