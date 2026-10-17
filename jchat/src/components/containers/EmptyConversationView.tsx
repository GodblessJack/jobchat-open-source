/**
 * EmptyConversationView — shown in the center column when no conversation
 * is selected. Inviting illustration + clear next-action hint.
 */

import { MessageSquarePlus } from 'lucide-react';

export function EmptyConversationView() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-wechat-chat dark:bg-gray-900 px-6 text-center">
      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/70 dark:bg-gray-800 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
        <MessageSquarePlus className="h-10 w-10 text-[#07c160]" strokeWidth={1.5} />
      </div>
      <h2 className="mt-5 text-base font-medium text-gray-700 dark:text-gray-200">还没有对话</h2>
      <p className="mt-1.5 max-w-xs text-sm text-gray-500 dark:text-gray-400">
        切到左下角的{' '}
        <span className="font-medium text-gray-700 dark:text-gray-300">联系人</span>{' '}
        tab 选一位开始 DM，或点{' '}
        <span className="font-medium text-gray-700 dark:text-gray-300">+</span> 发起群聊 / 添加联系人。
      </p>
    </div>
  );
}
