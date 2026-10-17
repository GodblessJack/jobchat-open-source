// jchat/shared/domain.ts — domain types shared between server and client

export type Uuid = string;
export type IsoDate = string;

// ===== Agent =====

export interface AgentIdentity {
  emoji?: string;
  self_address?: string;
  user_address?: string;
  speaking_style?: string;
  signature_phrases?: string[];
}

export interface AgentSummary {
  id: Uuid;
  name: string;
  avatarUrl?: string | null;
  description?: string | null;
  lastReadAt?: string | null;
}

export interface AgentDetail extends AgentSummary {
  personaMarkdown?: string | null;
  customInstructions?: string | null;
  activeSkills: string[];
  identity?: AgentIdentity | null;
  bootstrapMd?: string | null;
  initialMessage?: string | null;
}

/**
 * Per-skill view returned by the `agent.skills.list` WS command. Narrower
 * than `AgentDetail.activeSkills` (which is just slug strings) — surfaces
 * the human-readable name + description so the DM-side AgentSkillsPanel
 * can render a real list.
 */
export interface AgentSkillView {
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
}

// ===== Conversation =====

export type ConversationType = 'dm' | 'group';

export interface ConversationSummary {
  id: Uuid;
  userId: Uuid;
  type: ConversationType;
  title: string | null;
  archivedAt?: IsoDate | null;
  updatedAt: IsoDate;
  createdAt: IsoDate;
  members: ConversationMember[];
  lastMessage?: MessageSummary;
  unread?: number;
}

export interface ConversationMember {
  conversationId: Uuid;
  agentId: Uuid;
  role: 'member' | 'moderator';
  joinedAt: IsoDate;
  /**
   * Zero-based ordinal within the conversation — captured at insert time
   * from the order the user picked agents in the create-group wizard.
   * Authoritative ordering for the round-table speaking sequence and the
   * DetailPanel members list. See `sql/027_conversation_member_position.sql`.
   */
  position: number;
}

// ===== Message =====

export type MessageSenderType = 'user' | 'agent' | 'system';
export type MessageDeliveryStatus = 'partial' | 'final' | 'error' | 'sending';

export interface MessageAttachmentRef {
  filePath: string;
  mime: string;
  size: number;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  args: unknown;
  status: 'start' | 'result' | 'error';
  result?: unknown;
  ts: IsoDate;
}

export interface MessageSummary {
  id: Uuid;
  conversationId: Uuid;
  senderType: MessageSenderType;
  senderId: Uuid;
  content: string | null;
  mentions?: Uuid[];
  toolCalls?: ToolCallRecord[];
  attachments?: MessageAttachmentRef[];
  parentId?: Uuid | null;
  sdkSessionId?: Uuid | null;
  deliveryStatus: MessageDeliveryStatus;
  createdAt: IsoDate;
  editedAt?: IsoDate | null;
  metadata?: Record<string, unknown>;
}

// ===== Agent Memory =====

export interface AgentMemoryEntry {
  id: Uuid;
  userId: Uuid;
  agentId: Uuid;
  sourceConversationId?: Uuid | null;
  sourceMessageId?: Uuid | null;
  chunkText: string;
  importance: number;
  createdAt: IsoDate;
}

// ===== SDK Session =====

export type SdkSessionStatus = 'idle' | 'starting' | 'running' | 'cancelled' | 'failed' | 'ended';

export interface SdkSessionRecord {
  id: Uuid;
  conversationId?: Uuid;
  agentId: Uuid;
  userId: Uuid;
  workspacePath: string;
  status: SdkSessionStatus;
  workerPid?: number | null;
  lastActiveAt: IsoDate;
  createdAt: IsoDate;
  endedAt?: IsoDate | null;
  errorMsg?: string | null;
}

// ===== Snapshots =====

export interface ContactsSnapshot {
  agents: AgentSummary[];
  conversations: ConversationSummary[];
}

export interface ConversationSnapshot {
  conversation: ConversationSummary;
  messages: MessageSummary[];
  streamingByAgentId: Record<Uuid, { messageId: Uuid; status: SdkSessionStatus }>;
}

export interface PresenceSnapshot {
  devices: number;
  otherTabs: string[];
}

export interface AgentStatusSnapshot {
  byAgentId: Record<Uuid, { status: SdkSessionStatus; lastActiveAt?: IsoDate }>;
}
