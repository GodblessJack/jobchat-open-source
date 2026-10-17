/**
 * ChatBubble — symmetric message row with avatar + name + time + content.
 *
 * Layout:
 *   [avatar] [name · time]          ← assistant (left-aligned)
 *            [bubble content]
 *
 *           [name · time] [avatar]  ← user (right-aligned, mirrored)
 *           [bubble content]
 *
 * Hover affordance (desktop): the copy button appears on group hover.
 * Tap-to-reveal (mobile): tapping the bubble shows the copy button for 3 s.
 */

import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { Check, Copy, Phone, Square } from 'lucide-react';
import { avatarFallback } from '../../utils/avatar';
import ThinkingBar from './ThinkingBar';
import type { ThinkingEvent } from '../../store/messages';

interface ChatBubbleProps {
  role: 'user' | 'assistant';
  avatar?: string | null;
  name?: string;
  time?: string;
  copyText?: string;
  /** When provided, renders a Stop button next to the bubble. */
  onStop?: () => void;
  /** Disables the Stop button while a cancel command is in flight. */
  stopPending?: boolean;
  /** Marks the message as originating from a video call (renders 📞 indicator). */
  fromCall?: boolean;
  /** ThinkingBar events for streaming agent messages. */
  thinkingEvents?: ThinkingEvent[];
  /** When true, render a transparent spacer instead of the avatar image. */
  hideAvatar?: boolean;
  /** When true, omit the sender name from the header. */
  hideName?: boolean;
  children: ReactNode;
}

export function ChatBubble({ role, avatar, name, time, copyText, onStop, stopPending, fromCall, hideAvatar, hideName, thinkingEvents, children }: ChatBubbleProps) {
  const isUser = role === 'user';
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>();
  // Tap-to-reveal for mobile (hover doesn't work on touch devices).
  const [showActions, setShowActions] = useState(false);
  const actionsTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Clean up timers on unmount to avoid setState on unmounted component.
  useEffect(() => () => {
    clearTimeout(copyTimerRef.current);
    clearTimeout(actionsTimerRef.current);
  }, []);

  const handleBubbleTap = useCallback((e: React.MouseEvent) => {
    // Don't toggle on clicks inside interactive elements (buttons, links, code copy btns).
    const target = e.target as HTMLElement;
    if (target.closest('button, a, [role="button"]')) return;
    setShowActions(true);
    clearTimeout(actionsTimerRef.current);
    actionsTimerRef.current = setTimeout(() => setShowActions(false), 3000);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [copyText]);

  const avatarSrc = avatar || avatarFallback(name);

  return (
    <div className={`group/bubble flex items-start gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        hideAvatar ? (
          <div className="w-9 h-9 flex-shrink-0" aria-hidden />
        ) : (
          <img
            src={avatarSrc}
            alt={name || '联系人'}
            className="w-9 h-9 rounded-md object-cover flex-shrink-0"
          />
        )
      )}
      <div
        className={`flex flex-col min-w-0 ${
          isUser ? 'items-end max-w-[75%]' : 'items-start max-w-[75%]'
        }`}
      >
        {/* Header: name + time. For user side, mirror so name/time sit closest to bubble. */}
        {(name || time) && (
          <div
            className={`mb-1 flex items-center gap-2 px-1 text-[11px] ${
              isUser ? 'flex-row-reverse' : ''
            }`}
          >
            {!isUser && name && !hideName && <span className="text-gray-500 dark:text-gray-400">{name}</span>}
            {time && <span className="text-gray-400 dark:text-gray-500">{time}</span>}
            {fromCall && (
              <span
                aria-label="来自视频通话"
                title="来自视频通话"
                className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-300"
              >
                <Phone className="h-2.5 w-2.5" />
              </span>
            )}
          </div>
        )}
        {/* ThinkingBar: shows agent reasoning during streaming */}
        {thinkingEvents && thinkingEvents.length > 0 && (
          <div className="w-full">
            <ThinkingBar events={thinkingEvents} />
          </div>
        )}
        <div
          className={`flex items-end gap-1 ${isUser ? 'flex-row-reverse' : ''} max-w-full`}
        >
          <div className="min-w-0" onClick={handleBubbleTap}>{children}</div>
          {onStop && (
            <button
              type="button"
              onClick={onStop}
              disabled={stopPending}
              className="p-1 rounded-md text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 disabled:cursor-wait transition-colors duration-150 flex-shrink-0"
              title="停止生成"
              aria-label="停止生成"
            >
              <Square className="w-3.5 h-3.5" fill="currentColor" />
            </button>
          )}
          {copyText && (
            <button
              type="button"
              onClick={handleCopy}
              className={`p-1 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-opacity duration-150 flex-shrink-0 ${
                showActions
                  ? 'opacity-100'
                  : 'opacity-0 group-hover/bubble:opacity-100 focus:opacity-100'
              }`}
              title={copied ? 'Copied!' : 'Copy message'}
              aria-label={copied ? 'Message copied to clipboard' : 'Copy message to clipboard'}
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      </div>
      {isUser && (
        <img
          src={avatarSrc}
          alt={name || 'User'}
          className="w-9 h-9 rounded-md object-cover flex-shrink-0"
        />
      )}
    </div>
  );
}
