import type { Uuid } from './domain.js';

export interface CallSessionMeta {
  conversationId: Uuid;
  agentId: Uuid;
  agentName: string;
  agentAvatarUrl: string | null;
  agentRole: string | null;            // agents.role, e.g. "面试教练"
  agentDescription: string | null;     // agents.persona_description, full persona blurb
}

export interface CallPersonaResponse {
  session: CallSessionMeta;
  systemInstruction: string;
}

export interface CallStartRequest { conversationId: Uuid; }
export interface CallStartResponse { sessionId: Uuid; }

export interface CallTranscribeRequest {
  sessionId: Uuid;
  transcriptEntryId: string;        // client-side stable uuid (per Gemini turn)
  sender: 'user' | 'gemini';
  text: string;
  timestamp: number;                // ms epoch
}
export interface CallTranscribeResponse {
  messageId: Uuid;
  action: 'insert' | 'update' | 'upsert';
}

export interface CallEndRequest {
  sessionId: Uuid;
  status: 'completed' | 'error';
  jwt?: string;                     // for sendBeacon path (no Authorization header)
}

export type CallBroadcastMessage =
  | { type: 'started'; sessionId: Uuid; conversationId: Uuid; agentId: Uuid }
  | { type: 'ended'; sessionId: Uuid; conversationId: Uuid }
  | { type: 'focus-call'; sessionId: Uuid };

export const CALL_BC_NAME = 'jchat-call';
