/**
 * NewConversationPage — small wizard for creating a DM or group.
 *
 * Routes:
 *   /chat/new                  → DM picker
 *   /chat/new?agentId=<id>     → DM with that agent (auto-create on mount)
 *   /chat/new?type=group       → group wizard
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useContactsStore } from '../store/contacts';
import { useJchatWsClient } from '../ws/JchatWsProvider';
import type { ConversationCreateResult } from '@shared/protocol';
import { avatarFallback } from '../utils/avatar';
import { truncate } from '../lib/utils';

export function NewConversationPage() {
  const ws = useJchatWsClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const targetAgent = params.get('agentId');
  const isGroup = params.get('type') === 'group';

  const agents = useContactsStore(s => s.agents);
  const agentIds = useContactsStore(s => s.agentIds);

  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Auto-create DM when arriving with agentId. Use a ref to ensure we only
  // attempt once per (targetAgent) to avoid the effect-deps loop creating
  // duplicate conversations.
  const autoCreatedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!targetAgent || isGroup) return;
    if (autoCreatedRef.current === targetAgent) return; // already attempted
    autoCreatedRef.current = targetAgent;
    let cancelled = false;
    void (async () => {
      setBusy(true);
      try {
        const result = await ws.command<ConversationCreateResult>('conversation.create', {
          type: 'dm',
          agentIds: [targetAgent]
        });
        if (!cancelled) navigate(`/chat/${result.conversationId}`, { replace: true });
      } catch (err) {

        console.error('[NewConversationPage] auto-create DM failed', err);
        autoCreatedRef.current = null; // allow retry on error
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [targetAgent, isGroup, ws, navigate]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agentIds
      .map(id => agents[id])
      .filter(Boolean)
      .filter(a => !q || a.name.toLowerCase().includes(q));
  }, [agentIds, agents, search]);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createGroup() {
    if (busy || selected.size === 0) return;
    setBusy(true);
    try {
      const result = await ws.command<ConversationCreateResult>('conversation.create', {
        type: 'group',
        title: title.trim() || undefined,
        agentIds: Array.from(selected)
      });
      navigate(`/chat/${result.conversationId}`, { replace: true });
    } finally {
      setBusy(false);
    }
  }

  async function createDmAndGo(agentId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await ws.command<ConversationCreateResult>('conversation.create', {
        type: 'dm',
        agentIds: [agentId]
      });
      navigate(`/chat/${result.conversationId}`, { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-white dark:bg-gray-900">
      <header className="border-b border-gray-200 dark:border-gray-700 px-4 py-3 text-sm font-medium text-gray-800 dark:text-gray-100">
        {isGroup ? '新建群聊' : '新建会话'}
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isGroup && (
          <Input
            placeholder="群聊标题（可选）"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
        )}
        <Input placeholder="搜索联系人…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="space-y-1">
          {filtered.length === 0 && (
            <div className="px-3 py-10 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
                <Search className="h-4 w-4 text-gray-400 dark:text-gray-500" />
              </div>
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                {search.trim()
                  ? `未找到 "${truncate(search.trim(), 20)}"`
                  : '还没有联系人'}
              </div>
              <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                {search.trim() ? '换个关键词试试' : '点 + 添加联系人'}
              </div>
            </div>
          )}
          {filtered.map(a => {
            const checked = selected.has(a.id);
            const Row = (
              <div
                key={a.id}
                className="flex items-center gap-3 rounded-md p-2 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <img
                  src={a.avatarUrl || avatarFallback(a.name)}
                  alt={a.name}
                  className="h-8 w-8 rounded-md object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{a.name}</div>
                  {a.description && <div className="truncate text-xs text-gray-400 dark:text-gray-500">{a.description}</div>}
                </div>
                {isGroup ? (
                  <input type="checkbox" checked={checked} onChange={() => toggle(a.id)} />
                ) : (
                  <Button size="sm" onClick={() => createDmAndGo(a.id)} disabled={busy}>
                    {busy ? '创建中…' : '开始'}
                  </Button>
                )}
              </div>
            );
            return Row;
          })}
        </div>
      </div>

      {isGroup && (
        <footer className="border-t border-gray-200 dark:border-gray-700 p-3">
          <Button className="w-full" disabled={busy || selected.size === 0} onClick={createGroup}>
            {busy ? '创建中…' : `创建群聊（${selected.size}）`}
          </Button>
        </footer>
      )}
    </div>
  );
}
