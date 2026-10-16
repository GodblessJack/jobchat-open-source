import { Square } from 'lucide-react';
import { avatarFallback } from '../../utils/avatar';

interface TypingIndicatorProps {
  name: string;
  avatar?: string | null;
  /** When provided, renders a Stop button next to the typing dots. */
  onStop?: () => void;
  stopPending?: boolean;
  /** When true, render a transparent spacer instead of the avatar. */
  hideAvatar?: boolean;
}

export function TypingIndicator({ name, avatar, onStop, stopPending, hideAvatar }: TypingIndicatorProps) {
  const src = avatar || avatarFallback(name);
  return (
    <div className="flex items-start gap-2 py-2">
      {hideAvatar ? (
        <div className="w-9 h-9 flex-shrink-0" aria-hidden />
      ) : (
        <img src={src} alt={name} className="w-9 h-9 rounded-md object-cover flex-shrink-0" />
      )}
      <div className="flex items-center gap-1">
        <div className="bg-white dark:bg-gray-700 px-4 py-3 rounded-md shadow-sm">
          <div className="flex gap-1">
            <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
        {onStop && (
          <button
            type="button"
            onClick={onStop}
            disabled={stopPending}
            className="p-1 rounded-md text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-wait transition-colors duration-150 flex-shrink-0"
            title="停止生成"
            aria-label="停止生成"
          >
            <Square className="w-3.5 h-3.5" fill="currentColor" />
          </button>
        )}
      </div>
    </div>
  );
}
