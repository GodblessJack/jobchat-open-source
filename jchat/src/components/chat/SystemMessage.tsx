/**
 * SystemMessage — centered, gray, pill-shaped message used for non-chat-
 * bubble system events (e.g. archived historical announcements). No avatar,
 * no copy button.
 */

import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

export function SystemMessage({ children }: Props) {
  return (
    <div className="flex justify-center px-2 py-1">
      <div className="rounded-full bg-black/5 dark:bg-white/10 px-3 py-1 text-center text-[11px] leading-tight text-gray-500 dark:text-gray-400 max-w-[80%]">
        {children}
      </div>
    </div>
  );
}
