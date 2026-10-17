/**
 * MessageStream — renders the conversation message list with streaming deltas.
 *
 * Performance:
 *  - Stable React keys (message.id)
 *  - Streaming buffer rendered as a separate placeholder bubble; only that
 *    bubble re-renders when delta tokens arrive.
 *
 * Scroll behaviour:
 *  - On new content, auto-scroll to bottom IF the user was already near the
 *    bottom (within ~120px). If they have scrolled up, do not yank them down —
 *    instead show a floating "scroll to bottom" button with an unread count.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMessagesStore } from '../../store/messages';
import { useContactsStore } from '../../store/contacts';
import { useAuthStore } from '../../store/auth';
import { useJchatWsClient } from '../../ws/JchatWsProvider';
import { ChatBubble } from '../chat/ChatBubble';
import { MessageRenderer } from '../chat/MessageRenderer';
import { ImageGrid } from '../chat/ImageGrid';
import { FileCard } from '../chat/FileCard';
import { TypingIndicator } from '../chat/TypingIndicator';
import { SystemMessage } from '../chat/SystemMessage';
import { ScrollToBottomButton } from '../chat/ScrollToBottomButton';
import { formatTime, formatDateLabel } from '../../lib/utils';
import { avatarFallback } from '../../utils/avatar';
import { extractDisplayName, inferTypeFromMime } from '../../utils/textSanitize';
import type { MessageSummary } from '@shared/domain';
import type { ThinkingEvent, StreamingState } from '../../store/messages';

// Stable empty refs to avoid creating new objects each render → infinite loop.
const EMPTY_MESSAGES: MessageSummary[] = [];
const EMPTY_STREAMING: Record<string, StreamingState> = {};

const NEAR_BOTTOM_PX = 120;

interface Props {
  conversationId: string;
}

export function MessageStream({ conversationId }: Props) {
  const messages = useMessagesStore(s => s.byConvId[conversationId] ?? EMPTY_MESSAGES);
  const streaming = useMessagesStore(s => s.streamingByConvId[conversationId] ?? EMPTY_STREAMING);
  const agents = useContactsStore(s => s.agents);
  const user = useAuthStore(s => s.user);
  const myName = user?.displayName ?? user?.username ?? '我';
  const myAvatar = null;
  const ws = useJchatWsClient();
  const containerRef = useRef<HTMLDivElement>(null);
  // Track which (agentId) has a cancel command in flight so the Stop button
  // shows a busy state and we don't fire duplicate cancels.
  const [cancelling, setCancelling] = useState<Record<string, boolean>>({});

  const handleStop = useCallback(async (agentId: string) => {
    if (cancelling[agentId]) return;
    setCancelling(prev => ({ ...prev, [agentId]: true }));
    try {
      await ws.command('message.cancel_stream', { conversationId, agentId });
    } catch {
      // ignore — server will eventually time out and finalize
    } finally {
      // Leave true: the partial bubble is about to flip to final, so the
      // button will disappear. Reset on conversation switch.
      setCancelling(prev => ({ ...prev, [agentId]: false }));
    }
  }, [ws, conversationId, cancelling]);

  // Track whether the user is near the bottom; if so, future content should
  // pin to bottom; otherwise we surface the scroll-to-bottom button.
  const [atBottom, setAtBottom] = useState(true);
  // Number of messages that arrived while the user was scrolled up.
  const [unseenCount, setUnseenCount] = useState(0);
  const lastMessageCount = useRef(messages.length);
  // Reset state when switching conversations.
  useEffect(() => {
    setUnseenCount(0);
    setAtBottom(true);
    setCancelling({});
    lastMessageCount.current = messages.length;
    requestAnimationFrame(() => {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distFromBottom < NEAR_BOTTOM_PX;
    setAtBottom(nearBottom);
    if (nearBottom) setUnseenCount(0);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setUnseenCount(0);
    setAtBottom(true);
  }, []);

  // On new messages: pin to bottom if already at bottom, otherwise bump unseen.
  useEffect(() => {
    const newCount = messages.length;
    const delta = newCount - lastMessageCount.current;
    lastMessageCount.current = newCount;
    if (delta <= 0) return;
    if (atBottom) {
      requestAnimationFrame(() => scrollToBottom(false));
    } else {
      setUnseenCount(c => c + delta);
    }
  }, [messages.length, atBottom, scrollToBottom]);

  // On streaming token deltas: only auto-scroll if already at bottom.
  // (When the user is reading earlier content, do not yank them.)
  const streamingKey = Object.keys(streaming).join(',');
  const streamingTextLen = Object.values(streaming).reduce((acc, s) => acc + (s.text?.length ?? 0), 0);
  useEffect(() => {
    if (!atBottom) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [streamingKey, streamingTextLen, atBottom]);

  const showScrollButton = !atBottom;

  // Group messages by calendar date, inserting date-separator labels between groups.
  type GroupedItem =
    | { kind: 'separator'; label: string; key: string }
    | { kind: 'message'; message: MessageSummary; isConsecutive: boolean };
  const groupedItems = useMemo<GroupedItem[]>(() => {
    const items: GroupedItem[] = [];
    let lastDateKey = '';
    let prevSenderKey = '';
    for (const m of messages) {
      const dateKey = new Date(m.createdAt).toLocaleDateString('zh-CN');
      if (dateKey !== lastDateKey) {
        lastDateKey = dateKey;
        prevSenderKey = '';
        items.push({ kind: 'separator', label: formatDateLabel(m.createdAt), key: `sep-${dateKey}` });
      }
      const senderKey = `${m.senderType}:${m.senderId}`;
      const isConsecutive = senderKey === prevSenderKey;
      prevSenderKey = senderKey;
      items.push({ kind: 'message', message: m, isConsecutive });
    }
    return items;
  }, [messages]);

  // Pre-render streaming items with consecutive-sender tracking, so they
  // inherit the same compact spacing / hidden avatar as persisted messages.
  const streamItems = useMemo(() => {
    const items: { key: string; element: React.ReactNode }[] = [];
    // Start from the last persisted message's sender so a new stream from the
    // same agent merges visually.
    const lastMsg = messages[messages.length - 1];
    let prevKey = lastMsg ? `${lastMsg.senderType}:${lastMsg.senderId}` : '';
    for (const stream of Object.values(streaming)) {
      if (messages.some(m => m.id === stream.messageId)) continue;
      const agent = agents[stream.agentId];
      const senderKey = `agent:${stream.agentId}`;
      const isConsecutive = senderKey === prevKey;
      prevKey = senderKey;
      const hasThinking = stream.thinkingEvents && stream.thinkingEvents.length > 0;
      if (!stream.text && !hasThinking) {
        items.push({
          key: `typing-${stream.messageId}`,
          element: (
            <div className={isConsecutive ? 'mt-1' : 'mt-4'}>
              <TypingIndicator
                name={agent?.name || '联系人'}
                avatar={agent?.avatarUrl}
                onStop={() => handleStop(stream.agentId)}
                stopPending={!!cancelling[stream.agentId]}
                hideAvatar={isConsecutive}
              />
            </div>
          )
        });
      } else {
        items.push({
          key: `stream-${stream.messageId}`,
          element: (
            <div className={isConsecutive ? 'mt-1' : 'mt-4'}>
              <ChatBubble
                role="assistant"
                avatar={agent?.avatarUrl || undefined}
                name={agent?.name}
                time=""
                onStop={() => handleStop(stream.agentId)}
                stopPending={!!cancelling[stream.agentId]}
                hideAvatar={isConsecutive}
                hideName={isConsecutive}
                thinkingEvents={stream.thinkingEvents}
              >
                <MessageRenderer content={stream.text} role="assistant" />
              </ChatBubble>
            </div>
          )
        });
      }
    }
    return items;
  }, [streaming, messages, agents, cancelling, handleStop]);

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="absolute inset-0 overflow-y-auto px-4 py-4 bg-wechat-chat dark:bg-gray-800"
      >
        {messages.length === 0 && Object.keys(streaming).length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-gray-400 dark:text-gray-500">
            没有消息——发个招呼吧
          </div>
        )}

        {groupedItems.map(item => {
          if (item.kind === 'separator') {
            return (
              <div key={item.key} className="flex justify-center py-2 mt-4">
                <span className="inline-block rounded-full bg-gray-200/70 dark:bg-gray-700/70 px-3 py-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                  {item.label}
                </span>
              </div>
            );
          }
          const m = item.message;
          // For partial agent messages, prefer the live streaming buffer
          // content over the snapshot. The server only persists content every
          // PERSIST_EVERY_N chunks, so the snapshot is stale between flushes;
          // splicing the streaming text in makes the bubble flow in real time.
          const liveStream = m.deliveryStatus === 'partial' ? streaming[m.id] : undefined;
          const displayMessage = liveStream && liveStream.text
            ? { ...m, content: liveStream.text }
            : m;
          const displayThinkingEvents = liveStream?.thinkingEvents;
          return (
            <div key={m.id} className={item.isConsecutive ? 'mt-1' : 'mt-4'}>
              <MessageRow
                message={displayMessage}
                myName={myName}
                myAvatar={myAvatar}
                agentMap={agents}
                cancellingByAgentId={cancelling}
                onStop={handleStop}
                hideAvatar={item.isConsecutive}
                hideName={item.isConsecutive}
                thinkingEvents={displayThinkingEvents}
              />
            </div>
          );
        })}

        {streamItems.map(item => <React.Fragment key={item.key}>{item.element}</React.Fragment>)}
      </div>

      <ScrollToBottomButton
        visible={showScrollButton}
        unreadCount={unseenCount}
        onClick={() => scrollToBottom(true)}
      />
    </div>
  );
}

interface RowProps {
  message: MessageSummary;
  myName: string;
  myAvatar: string | null;
  agentMap: Record<string, { id: string; name: string; avatarUrl?: string | null }>;
  cancellingByAgentId: Record<string, boolean>;
  onStop: (agentId: string) => void;
  hideAvatar?: boolean;
  hideName?: boolean;
  thinkingEvents?: ThinkingEvent[];
}

function MessageRow({ message, myName, myAvatar, agentMap, cancellingByAgentId, onStop, hideAvatar, hideName, thinkingEvents }: RowProps) {
  if (message.senderType === 'system') {
    return <SystemMessage>{message.content}</SystemMessage>;
  }

  const isUser = message.senderType === 'user';
  const senderAgent = !isUser ? agentMap[message.senderId] : undefined;
  const role: 'user' | 'assistant' = isUser ? 'user' : 'assistant';
  const name = isUser ? myName : senderAgent?.name || '联系人';
  const avatar = isUser
    ? myAvatar || avatarFallback(myName)
    : senderAgent?.avatarUrl || avatarFallback(name);

  // Split attachments: images → ImageGrid, non-images → FileCard.
  // v1 bug: only images rendered, all other files were silently dropped.
  const allAttachments = message.attachments || [];
  const imageAttachments = allAttachments.filter(a => a.mime?.startsWith('image/') ?? false);
  const fileAttachments = allAttachments.filter(a => a.mime != null && !a.mime.startsWith('image/'));

  // Cancel-stream affordance: only when this is an agent message still partial.
  const isPartialAgent = !isUser && message.deliveryStatus === 'partial';
  const stopHandler = isPartialAgent ? () => onStop(message.senderId) : undefined;
  const stopPending = isPartialAgent ? !!cancellingByAgentId[message.senderId] : undefined;
  const isCancelled = !isUser && message.deliveryStatus === 'final' &&
    typeof message.content === 'string' && message.content.startsWith('[已取消]');

  return (
    <ChatBubble
      role={role}
      avatar={avatar}
      name={name}
      time={formatTime(message.createdAt)}
      copyText={message.content || undefined}
      onStop={stopHandler}
      stopPending={stopPending}
      fromCall={message.metadata?.source === 'call'}
      hideAvatar={hideAvatar}
      hideName={hideName}
      thinkingEvents={thinkingEvents}
    >
      {message.content && <MessageRenderer content={message.content} role={role} />}
      {imageAttachments.length > 0 && (
        <div className="mt-2">
          <ImageGrid
            images={imageAttachments.map(a => ({ url: `supabase://${a.filePath}`, alt: '' }))}
          />
        </div>
      )}
      {fileAttachments.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {fileAttachments.map((a, i) => (
            <FileCard
              key={`${a.filePath}-${i}`}
              file={{
                name: extractDisplayName(a.filePath),
                url: `supabase://${a.filePath}`,
                size: a.size,
                type:
                  inferTypeFromMime(a.mime) ??
                  (a.filePath.split('.').pop()?.toLowerCase() ?? 'file')
              }}
            />
          ))}
        </div>
      )}
      {/* Unified status area with min-height to prevent layout shift
           when status changes (e.g. "sending" → resolved). */}
      <div className="mt-1 min-h-[1rem] text-[11px] leading-none">
        {isPartialAgent && !isCancelled && (
          <span className="inline-flex items-center gap-1 text-gray-400 dark:text-gray-500">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400 dark:bg-gray-500" />
            <span>{stopPending ? '正在取消…' : '正在输入'}</span>
          </span>
        )}
        {isCancelled && (
          <span className="italic text-gray-400 dark:text-gray-500">已取消</span>
        )}
        {message.deliveryStatus === 'sending' && (
          <span className="inline-flex items-center gap-1 text-gray-400 dark:text-gray-500">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400 dark:bg-gray-500" />
            <span>发送中</span>
          </span>
        )}
        {message.deliveryStatus === 'error' && (
          <span className="italic text-red-400">发送失败</span>
        )}
      </div>
    </ChatBubble>
  );
}
