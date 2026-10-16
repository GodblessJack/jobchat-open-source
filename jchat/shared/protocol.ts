// jchat/shared/protocol.ts — WS protocol contract (frontend ↔ backend)

export const PROTOCOL_VERSION = 1 as const;

// ===== Envelope =====

export type ClientEnvelope =
  | { v: 1; type: 'command'; id: string; name: ClientCommandName; payload?: unknown }
  | { v: 1; type: 'subscribe'; id: string; topic: string }
  | { v: 1; type: 'unsubscribe'; id: string; topic: string }
  | { v: 1; type: 'system.ping' };

export type ServerEnvelope =
  | { v: 1; type: 'ack'; id: string; result?: unknown }
  | { v: 1; type: 'error'; id?: string; code: string; message: string; details?: unknown }
  | SnapshotEvent
  | DeltaEvent
  | ToolCallEvent
  | ThinkingDeltaEvent
  | PresenceChangedEvent
  | InputSyncBroadcastEvent
  | PermissionRequestEvent
  | { v: 1; type: 'system.pong' };

export interface SnapshotEvent { v: 1; type: 'snapshot'; topic: string; signature: string; data: unknown; }
export interface DeltaEvent { v: 1; type: 'delta'; conversationId: string; messageId: string; agentId: string; textChunk: string; isFinal?: boolean; }
export interface ToolCallEvent { v: 1; type: 'tool_call'; conversationId: string; messageId: string; agentId: string; toolName: string; status: 'start' | 'result' | 'error' | 'progress'; result?: unknown; }
export interface ThinkingDeltaEvent { v: 1; type: 'thinking_delta'; conversationId: string; messageId: string; agentId: string; textChunk: string; }
export interface PresenceChangedEvent { v: 1; type: 'presence_changed'; devices: number; otherTabs: string[]; }
export interface InputSyncBroadcastEvent { v: 1; type: 'input_sync_broadcast'; conversationId: string; text: string; fromTab: string; }
export interface PermissionRequestEvent { v: 1; type: 'permission_request'; id: string; conversationId: string; agentId: string; action: string; args: unknown; }

// ===== Commands =====

export type ClientCommandName =
  | 'conversation.create'
  | 'conversation.open'
  | 'conversation.rename'
  | 'conversation.archive'
  | 'conversation.delete'
  | 'conversation.search'
  | 'conversation.load_more'
  | 'member.add'
  | 'member.remove'
  | 'message.send'
  | 'message.cancel_stream'
  | 'message.edit'
  | 'message.delete'
  | 'file.upload_init'
  | 'file.upload_complete'
  | 'file.signed_url'
  | 'input.sync_draft'
  | 'agent.skills.list';

// ===== Command payloads (c2s) =====

export interface ConversationCreatePayload { type: 'dm' | 'group'; agentIds: string[]; title?: string; }
export interface ConversationOpenPayload { conversationId: string; }
export interface ConversationRenamePayload { conversationId: string; title: string; }
export interface ConversationArchivePayload { conversationId: string; }
export interface ConversationDeletePayload { conversationId: string; }
export interface ConversationSearchPayload { q: string; limit?: number; }
export interface ConversationLoadMorePayload { conversationId: string; beforeMessageId: string; limit?: number; }

export interface MemberAddPayload { conversationId: string; agentId: string; }
export interface MemberRemovePayload { conversationId: string; agentId: string; }

export interface MessageAttachment { filePath: string; mime: string; size: number; }
export interface MessageSendPayload {
  conversationId: string;
  content: string;
  mentions?: string[];
  attachments?: MessageAttachment[];
  parentId?: string;
}
export interface MessageCancelStreamPayload { conversationId: string; agentId: string; }
export interface MessageEditPayload { messageId: string; content: string; }
export interface MessageDeletePayload { messageId: string; }

export interface FileUploadInitPayload { conversationId: string; filename: string; mime: string; size: number; }
export interface FileUploadCompletePayload { filePath: string; }
export interface FileSignedUrlPayload { filePath: string; }
export interface InputSyncDraftPayload { conversationId: string; text: string; }

// ===== Ack result shapes =====

export interface ConversationCreateResult { conversationId: string; }
export interface ConversationOpenResult { ok: true; }
export interface ConversationSearchResult {
  results: Array<{ messageId: string; conversationId: string; snippet: string; ts: number }>;
}
export interface ConversationLoadMoreResult { messages: unknown[]; }
export interface MessageSendResult { messageId: string; }
export interface FileUploadInitResult { uploadUrl: string; filePath: string; expiresAt: number; }
export interface FileSignedUrlResult { url: string; expiresAt: number; }
export interface SubscribeResult { snapshot: { topic: string; signature: string; data: unknown }; }
export interface AgentSkillsListPayload { agentId: string; }
export interface AgentSkillsListResult { skills: import('./domain').AgentSkillView[]; }

// ===== Subscription topics =====

export type SubscriptionTopic =
  | 'contacts'
  | `conversation:${string}`
  | 'presence'
  | 'agent-status'
  | `search:${string}`;

// ===== Type guards =====

const CLIENT_TYPES = new Set(['command', 'subscribe', 'unsubscribe', 'system.ping']);
const SERVER_TYPES = new Set([
  'ack', 'error', 'snapshot', 'delta', 'tool_call', 'thinking_delta',
  'presence_changed', 'input_sync_broadcast', 'permission_request', 'system.pong'
]);

export function isClientEnvelope(x: unknown): x is ClientEnvelope {
  if (!x || typeof x !== 'object') return false;
  const o = x as { v?: number; type?: string };
  if (o.v !== 1) return false;
  return typeof o.type === 'string' && CLIENT_TYPES.has(o.type);
}

export function isServerEnvelope(x: unknown): x is ServerEnvelope {
  if (!x || typeof x !== 'object') return false;
  const o = x as { v?: number; type?: string };
  if (o.v !== 1) return false;
  return typeof o.type === 'string' && SERVER_TYPES.has(o.type);
}
