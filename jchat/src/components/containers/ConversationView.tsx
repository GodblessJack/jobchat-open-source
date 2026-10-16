/**
 * ConversationView — middle column.
 *
 * Subscribes to topic `conversation:<id>` for snapshots; renders header,
 * message stream, and chat input.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConversationsStore } from '../../store/conversations';
import { useMessagesStore } from '../../store/messages';
import { useUiStore } from '../../store/ui';
import { useJchatWsClient, useConversationSnapshot } from '../../ws/JchatWsProvider';
import { ConversationHeader } from './ConversationHeader';
import { MessageStream } from './MessageStream';
import { ChatInput } from './ChatInput';
import { EmptyConversationView } from './EmptyConversationView';
import { CallStatusBar } from './CallStatusBar';
import { MessageSkeleton } from '../chat/MessageSkeleton';
import { ChevronLeft } from 'lucide-react';
import { Button } from '../ui/button';
import type { ConversationSnapshot } from '@shared/domain';

interface Props {
  conversationId: string | null;
}

export function ConversationView({ conversationId }: Props) {
  const navigate = useNavigate();
  const setMobilePane = useUiStore(s => s.setMobilePane);
  const conv = useConversationsStore(s =>
    conversationId ? s.byId[conversationId] ?? null : null
  );

  const ws = useJchatWsClient();
  const [pendingMessage, setPendingMessage] = useState(false);
  // Banner shown when message.send is rejected by the server (e.g. content
  // too long, attachments missing, validation error). Without this the
  // textarea just resets and the user thinks nothing happened.
  const [sendError, setSendError] = useState<string | null>(null);

  const handleSnapshot = useCallback((data: ConversationSnapshot) => {
    if (!conversationId) return;
    useConversationsStore.getState().upsert(data.conversation);
    useMessagesStore.getState().setMessages(conversationId, data.messages);
  }, [conversationId]);

  useConversationSnapshot(conversationId, handleSnapshot);

  // Guard: warn before switching conversations during an active call.
  // Note: React useEffect fires after commit, so the new conversation has
  // already rendered. We navigate back to the call's conversation immediately
  // with replace:true so there is no visible flash and no stale history entry.
  useEffect(() => {
    const activeCall = useUiStore.getState().activeCall;
    if (activeCall && activeCall.conversationId !== conversationId) {
      const ok = window.confirm('当前正在通话中，切换会话将结束通话。确认切换？');
      if (ok) {
        useUiStore.getState().setActiveCall(null);
        useUiStore.getState().setDetailPanelActiveTab('profile');
        useUiStore.getState().setDetailPanelWidth(320);
      } else {
        // Navigate back to the original conversation (the one with the active
        // call), not -1 (which could go anywhere). replace:true avoids adding
        // a junk history entry.
        navigate(`/chat/${activeCall.conversationId}`, { replace: true });
      }
    }
  }, [conversationId]);

  if (!conversationId) {
    return <EmptyConversationView />;
  }

  if (!conv) {
    return (
      <div className="flex h-full flex-col bg-wechat-chat">
        <div className="border-b border-gray-200 bg-white px-4 py-3">
          <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
          <div className="mt-1.5 h-3 w-48 animate-pulse rounded bg-gray-100" />
        </div>
        <div className="flex-1 overflow-hidden">
          <MessageSkeleton />
        </div>
      </div>
    );
  }

  async function handleSend(payload: {
    content: string;
    mentions: string[];
    attachments: { filePath: string; mime: string; size: number }[];
  }) {
    if (!conversationId) return;
    if (pendingMessage) return;
    setSendError(null);
    setPendingMessage(true);
    try {
      await ws.command('message.send', {
        conversationId,
        content: payload.content,
        mentions: payload.mentions.length ? payload.mentions : undefined,
        attachments: payload.attachments.length ? payload.attachments : undefined
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      console.error('[ConversationView] message.send failed', err);
      setSendError(msg || '发送失败');
    } finally {
      setPendingMessage(false);
    }
  }

  function handleBack() {
    setMobilePane('list');
    navigate('/chat');
  }

  return (
    <div className="flex h-full flex-col">
      <CallStatusBar conversationId={conversationId} />
      <div className="flex items-center border-b border-gray-200 bg-white">
        {/* Mobile back button — only on small viewports */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
          aria-label="Back to list"
          className="md:hidden"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <ConversationHeader conversation={conv} />
        </div>
      </div>

      <MessageStream conversationId={conversationId} />

      {sendError && (
        <div
          role="alert"
          className="mx-3 mb-1 flex items-start justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
        >
          <span className="leading-snug">{sendError}</span>
          <button
            type="button"
            onClick={() => setSendError(null)}
            className="flex-shrink-0 rounded px-1.5 py-0.5 text-amber-600 hover:bg-amber-100"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      <ChatInput key={conversationId} conversationId={conversationId} onSend={handleSend} disabled={pendingMessage} />
    </div>
  );
}
