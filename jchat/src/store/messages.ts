/**
 * messagesStore — per-conversation message lists + streaming buffers.
 *
 * Architecture:
 *  - `byConvId[convId]`         → MessageSummary[] in ascending order
 *  - `streamingByConvId[convId][messageId]` → text accumulator for in-flight delta streams
 *
 * `applyDelta` updates only the streaming bucket so React can render the
 * currently-streaming bubble without re-rendering the whole list.
 */

import { create } from 'zustand';
import type { MessageSummary, Uuid } from '@shared/domain';

/** A single thinking/tool event for the ThinkingBar display. */
export interface ThinkingEvent {
  ts: number;
  type: 'thinking' | 'tool_call' | 'tool_result' | 'tool_progress';
  text: string;
  detail?: string;
  toolName?: string;
  toolUseId?: string;
  elapsed?: number;
  status?: 'running' | 'done' | 'error';
}

export interface StreamingState {
  /** accumulated content received via delta events */
  text: string;
  /** message id of the placeholder/in-flight message */
  messageId: Uuid;
  /** agent who is producing the stream */
  agentId: Uuid;
  /** thinking-mode delta accumulator (separate stream) */
  thinking: string;
  /** Structured event list for ThinkingBar UI. */
  thinkingEvents: ThinkingEvent[];
}

export interface MessagesState {
  byConvId: Record<Uuid, MessageSummary[]>;
  streamingByConvId: Record<Uuid, Record<Uuid, StreamingState>>; // convId → messageId → streaming

  /** Replace the entire message list for a conversation (used on snapshot). */
  setMessages: (convId: Uuid, messages: MessageSummary[]) => void;

  /** Append a new message (e.g. after a `message.send` ack or a user echo). */
  append: (convId: Uuid, message: MessageSummary) => void;

  /** Apply a delta (token chunk) to the streaming buffer. */
  applyDelta: (convId: Uuid, messageId: Uuid, agentId: Uuid, textChunk: string) => void;

  /** Apply a thinking-mode delta. */
  applyThinkingDelta: (convId: Uuid, messageId: Uuid, agentId: Uuid, textChunk: string) => void;

  /** Append a structured thinking event (tool_call, tool_result, etc.) to the streaming buffer. */
  applyThinkingEvent: (convId: Uuid, messageId: Uuid, agentId: Uuid, event: ThinkingEvent) => void;

  /** Replace a temporary optimistic message ID with the real server-assigned ID. */
  updateMessageId: (convId: Uuid, oldId: Uuid, newId: Uuid) => void;

  /** Promote the streaming buffer to a final MessageSummary and remove the streaming entry. */
  finalize: (convId: Uuid, messageId: Uuid, finalContent: string) => void;

  /** Clear all messages for a conversation. */
  clearConversation: (convId: Uuid) => void;

  /** Clear all messages across the store. */
  clear: () => void;

  selectMessages: (convId: Uuid) => MessageSummary[];
  selectStreaming: (convId: Uuid) => Record<Uuid, StreamingState>;
}

export const useMessagesStore = create<MessagesState>((set, get) => ({
  byConvId: {},
  streamingByConvId: {},

  setMessages(convId, messages) {
    set(state => ({
      byConvId: { ...state.byConvId, [convId]: messages.slice() }
    }));
  },

  append(convId, message) {
    set(state => {
      const existing = state.byConvId[convId] ?? [];
      // Avoid double-append if already present (idempotent w.r.t. snapshots)
      if (existing.some(m => m.id === message.id)) {
        return {
          byConvId: {
            ...state.byConvId,
            [convId]: existing.map(m => (m.id === message.id ? { ...m, ...message } : m))
          }
        };
      }
      return {
        byConvId: { ...state.byConvId, [convId]: [...existing, message] }
      };
    });
  },

  applyDelta(convId, messageId, agentId, textChunk) {
    set(state => {
      const convStreaming = state.streamingByConvId[convId] ?? {};
      const prev = convStreaming[messageId];
      const next: StreamingState = prev
        ? { ...prev, text: prev.text + textChunk }
        : { messageId, agentId, text: textChunk, thinking: '', thinkingEvents: [] };
      return {
        streamingByConvId: {
          ...state.streamingByConvId,
          [convId]: { ...convStreaming, [messageId]: next }
        }
      };
    });
  },

  applyThinkingDelta(convId, messageId, agentId, textChunk) {
    set(state => {
      const convStreaming = { ...(state.streamingByConvId[convId] ?? {}) };
      const prev = convStreaming[messageId] as StreamingState | undefined;
      if (prev) {
        const newThinking = prev.thinking + textChunk;
        const last = prev.thinkingEvents[prev.thinkingEvents.length - 1];
        const newEvents: ThinkingEvent[] = last && last.type === 'thinking'
          ? [
              ...prev.thinkingEvents.slice(0, -1),
              { ...last, text: last.text + textChunk },
            ]
          : [
              ...prev.thinkingEvents,
              { ts: Date.now(), type: 'thinking', text: textChunk },
            ];
        convStreaming[messageId] = {
          ...prev,
          thinking: newThinking,
          thinkingEvents: newEvents,
        };
      } else {
        convStreaming[messageId] = {
          text: '',
          messageId,
          agentId,
          thinking: textChunk,
          thinkingEvents: [{ ts: Date.now(), type: 'thinking', text: textChunk }],
        };
      }
      return {
        streamingByConvId: {
          ...state.streamingByConvId,
          [convId]: convStreaming,
        },
      };
    });
  },

  applyThinkingEvent(convId, messageId, agentId, event) {
    set(state => {
      const convStreaming = { ...(state.streamingByConvId[convId] ?? {}) };
      const prev = convStreaming[messageId] as StreamingState | undefined;
      if (prev) {
        convStreaming[messageId] = {
          ...prev,
          thinkingEvents: [...prev.thinkingEvents, event],
        };
      } else {
        convStreaming[messageId] = {
          text: '',
          messageId,
          agentId,
          thinking: '',
          thinkingEvents: [event],
        };
      }
      return {
        streamingByConvId: {
          ...state.streamingByConvId,
          [convId]: convStreaming,
        },
      };
    });
  },

  updateMessageId(convId, oldId, newId) {
    set(state => {
      const existing = state.byConvId[convId];
      if (!existing) return state;

      // Rename the streaming buffer key so finalize can locate it by the new ID.
      const convStreaming = state.streamingByConvId[convId];
      let nextStreaming = state.streamingByConvId;
      if (convStreaming?.[oldId]) {
        const { [oldId]: stream, ...rest } = convStreaming;
        nextStreaming = {
          ...state.streamingByConvId,
          [convId]: { ...rest, [newId]: { ...stream, messageId: newId } }
        };
      }

      return {
        byConvId: {
          ...state.byConvId,
          [convId]: existing.map(m =>
            m.id === oldId ? { ...m, id: newId, deliveryStatus: 'final' as const } : m
          )
        },
        streamingByConvId: nextStreaming,
      };
    });
  },

  finalize(convId, messageId, finalContent) {
    set(state => {
      const convStreaming = state.streamingByConvId[convId] ?? {};
      const stream = convStreaming[messageId];
      const { [messageId]: _drop, ...remainingStream } = convStreaming;
      const list = state.byConvId[convId] ?? [];
      const idx = list.findIndex(m => m.id === messageId);
      let nextList = list;
      if (idx >= 0) {
        nextList = list.slice();
        nextList[idx] = { ...nextList[idx], content: finalContent, deliveryStatus: 'final' };
      } else if (stream) {
        // We have a streaming buffer but no list entry — synthesize a minimal MessageSummary.
        nextList = [
          ...list,
          {
            id: messageId,
            conversationId: convId,
            senderType: 'agent',
            senderId: stream.agentId,
            content: finalContent,
            deliveryStatus: 'final',
            createdAt: new Date().toISOString()
          }
        ];
      }
      return {
        byConvId: { ...state.byConvId, [convId]: nextList },
        streamingByConvId: { ...state.streamingByConvId, [convId]: remainingStream }
      };
    });
  },

  clearConversation(convId) {
    set(state => {
      const { [convId]: _a, ...byConv } = state.byConvId;
      const { [convId]: _b, ...streaming } = state.streamingByConvId;
      return { byConvId: byConv, streamingByConvId: streaming };
    });
  },

  clear() {
    set({ byConvId: {}, streamingByConvId: {} });
  },

  selectMessages(convId) {
    return get().byConvId[convId] ?? [];
  },

  selectStreaming(convId) {
    return get().streamingByConvId[convId] ?? {};
  }
}));
