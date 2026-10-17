/**
 * RoundtableInfoPanel — single-pane group conversation info view.
 *
 * Shows the members list (avatar + name + description) in join order.
 * Group name editing lives in ConversationHeader (double-click to edit).
 */

import { useConversationsStore } from '../../store/conversations';
import { useContactsStore } from '../../store/contacts';
import { avatarFallback } from '../../utils/avatar';
import type { Uuid } from '@shared/domain';

interface Props {
  conversationId: Uuid;
}

export function RoundtableInfoPanel({ conversationId }: Props) {
  const conv = useConversationsStore(s => s.byId[conversationId]);
  const agents = useContactsStore(s => s.agents);
  const contactsHydrated = useContactsStore(s => s.hydrated);

  if (!conv) return null;

  // Preserve EVERY member row, even if the contacts store hasn't hydrated
  // for that agentId yet — silently filtering with `.filter(Boolean)` would
  // make the panel show a smaller count than reality during the race. Mark
  // unresolved rows with `pending: true` so the render path can show a
  // skeleton placeholder.
  const members = (conv.members ?? []).map(m => {
    const a = agents[m.agentId];
    if (a) {
      return { agentId: m.agentId, name: a.name, avatarUrl: a.avatarUrl ?? null, description: a.description ?? null, pending: false };
    }
    if (contactsHydrated) {
      return { agentId: m.agentId, name: '未知联系人', avatarUrl: null, description: null, pending: false };
    }
    return { agentId: m.agentId, name: '加载中…', avatarUrl: null, description: null, pending: true };
  });

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div>
        <div className="text-xs font-medium text-gray-600 dark:text-gray-400">成员（{members.length}）</div>
        <ul className="mt-2 space-y-2">
          {members.map(m => (
            <li key={m.agentId} className="flex items-center gap-3">
              {m.pending ? (
                <div className="h-9 w-9 flex-shrink-0 animate-pulse rounded-md bg-gray-200 dark:bg-gray-700" />
              ) : (
                <img
                  src={m.avatarUrl ?? avatarFallback(m.name)}
                  alt={m.name}
                  className="h-9 w-9 rounded-md object-cover"
                />
              )}
              <div className="min-w-0">
                {m.pending ? (
                  <div className="h-3 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                ) : (
                  <>
                    <div className="truncate text-sm text-gray-800 dark:text-gray-200">{m.name}</div>
                    {m.description && (
                      <div className="truncate text-xs text-gray-500 dark:text-gray-400">{m.description}</div>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
