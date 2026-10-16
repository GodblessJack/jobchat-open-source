/**
 * ScrollToBottomButton — floating action button shown when the user has
 * scrolled away from the bottom of the message stream. Optionally shows a
 * "+N new" badge for messages that arrived while scrolled up.
 */

import { ChevronDown } from 'lucide-react';

interface Props {
  visible: boolean;
  unreadCount: number;
  onClick: () => void;
}

export function ScrollToBottomButton({ visible, unreadCount, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!visible}
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible || undefined}
      aria-label={
        unreadCount > 0 ? `跳到底部，${unreadCount} 条新消息` : '跳到底部'
      }
      className={`absolute bottom-4 right-4 z-20 flex items-center gap-1.5 rounded-full bg-white dark:bg-gray-700 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 shadow-lg dark:shadow-gray-900 ring-1 ring-black/5 dark:ring-white/10 transition-all duration-200 hover:bg-gray-50 dark:hover:bg-gray-600 hover:shadow-xl ${
        visible ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none'
      }`}
    >
      {unreadCount > 0 && (
        <span className="rounded-full bg-[#fa5151] px-1.5 py-0.5 text-[10px] font-medium leading-none text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
      <ChevronDown className="h-4 w-4" />
    </button>
  );
}
