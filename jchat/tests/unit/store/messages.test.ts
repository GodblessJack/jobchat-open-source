import { describe, it, expect, beforeEach } from 'vitest';
import { useMessagesStore } from '@/store/messages';
import type { MessageSummary } from '@shared/domain';

function reset() {
  useMessagesStore.getState().clear();
}

const userMsg: MessageSummary = {
  id: 'u1',
  conversationId: 'c1',
  senderType: 'user',
  senderId: 'user-1',
  content: 'hi',
  deliveryStatus: 'final',
  createdAt: '2026-04-28T00:00:00Z'
};

describe('messagesStore', () => {
  beforeEach(reset);

  it('setMessages replaces the conversation list', () => {
    useMessagesStore.getState().setMessages('c1', [userMsg]);
    expect(useMessagesStore.getState().selectMessages('c1')).toHaveLength(1);
  });

  it('append adds a message; idempotent on duplicate id', () => {
    const s = useMessagesStore.getState();
    s.append('c1', userMsg);
    s.append('c1', userMsg);
    expect(s.selectMessages('c1')).toHaveLength(1);
  });

  it('applyDelta accumulates streaming text', () => {
    const s = useMessagesStore.getState();
    s.applyDelta('c1', 'm1', 'a1', 'Hel');
    s.applyDelta('c1', 'm1', 'a1', 'lo ');
    s.applyDelta('c1', 'm1', 'a1', 'world');
    const stream = useMessagesStore.getState().selectStreaming('c1')['m1'];
    expect(stream.text).toBe('Hello world');
    expect(stream.agentId).toBe('a1');
  });

  it('applyThinkingDelta accumulates thinking text separately', () => {
    const s = useMessagesStore.getState();
    s.applyThinkingDelta('c1', 'm1', 'a1', 'think 1 ');
    s.applyThinkingDelta('c1', 'm1', 'a1', 'think 2');
    const stream = useMessagesStore.getState().selectStreaming('c1')['m1'];
    expect(stream.thinking).toBe('think 1 think 2');
    expect(stream.text).toBe('');
  });

  it('finalize promotes streaming buffer to final message and clears stream', () => {
    const s = useMessagesStore.getState();
    s.applyDelta('c1', 'm1', 'a1', 'final answer');
    s.finalize('c1', 'm1', 'final answer');

    const messages = useMessagesStore.getState().selectMessages('c1');
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('m1');
    expect(messages[0].content).toBe('final answer');
    expect(messages[0].deliveryStatus).toBe('final');
    expect(messages[0].senderId).toBe('a1');

    expect(useMessagesStore.getState().selectStreaming('c1')['m1']).toBeUndefined();
  });

  it('finalize updates an existing list entry instead of duplicating', () => {
    const s = useMessagesStore.getState();
    const partial: MessageSummary = {
      ...userMsg,
      id: 'm1',
      senderType: 'agent',
      senderId: 'a1',
      content: '',
      deliveryStatus: 'partial'
    };
    s.append('c1', partial);
    s.applyDelta('c1', 'm1', 'a1', 'token');
    s.finalize('c1', 'm1', 'token complete');

    const messages = useMessagesStore.getState().selectMessages('c1');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('token complete');
    expect(messages[0].deliveryStatus).toBe('final');
  });

  it('clearConversation drops one conversation only', () => {
    const s = useMessagesStore.getState();
    s.setMessages('c1', [userMsg]);
    s.setMessages('c2', [{ ...userMsg, id: 'u2', conversationId: 'c2' }]);
    s.clearConversation('c1');
    expect(useMessagesStore.getState().selectMessages('c1')).toHaveLength(0);
    expect(useMessagesStore.getState().selectMessages('c2')).toHaveLength(1);
  });
});
