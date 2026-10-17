/**
 * ContactList — left rail.
 *
 * WeChat-style two-tab layout:
 *  - Top: search box + "+" button. The "+" opens a small popover with
 *    two actions: 发起群聊 (→ /chat/new?type=group) and 添加联系人
 *    (opens the AddContact distillation wizard).
 *  - Body: shows EITHER the conversation list OR the contact directory,
 *    depending on the active tab.
 *  - Footer: two icon tabs ("会话" / "联系人") plus the logout link.
 *
 * Selecting a contact in the directory opens (or finds-or-creates) a DM
 * by routing through /chat/new?agentId=…
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Moon, MoreHorizontal, Plus, Search, Sun, UserPlus, Users as UsersIcon, UsersRound, X } from 'lucide-react';
import { RowMenu } from '../ui/row-menu';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { useDistillationStore } from '../../store/distillation';
import { useContactsStore } from '../../store/contacts';
import { useConversationsStore } from '../../store/conversations';
import { useUiStore } from '../../store/ui';
import { useAuthStore } from '../../store/auth';
import { Input } from '../ui/input';
import { avatarFallback } from '../../utils/avatar';
import { formatRelativeDay, truncate } from '../../lib/utils';
import { cn } from '../../lib/utils';
import { useJchatWsClient } from '../../ws/JchatWsProvider';
import { useToastStore } from '../../store/toast';

/**
 * Render a server-produced search snippet safely. The server (Postgres
 * `ts_headline`, or the slice fallback) wraps matches in `<b>...</b>` —
 * but the surrounding text is the user's own message content, so any HTML
 * inside (e.g. an agent reply that happens to contain `<script>` or
 * `<img onerror=...>`) would execute if we used dangerouslySetInnerHTML.
 *
 * Split on the highlight tag and let React escape everything else; only
 * known-good `<b>` segments become real elements.
 */
function renderSnippet(snippet: string): React.ReactNode {
  if (!snippet) return null;
  const parts = snippet.split(/(<b>[\s\S]*?<\/b>)/g);
  return parts.map((part, i) => {
    if (part.startsWith('<b>') && part.endsWith('</b>')) {
      return <b key={i}>{part.slice(3, -4)}</b>;
    }
    return <span key={i}>{part}</span>;
  });
}

interface MessageSearchHit {
  messageId: string;
  conversationId: string;
  snippet: string;
  rank: number;
  ts: number;
}

type Tab = 'chats' | 'contacts';

export function ContactList() {
  const navigate = useNavigate();
  const ws = useJchatWsClient();
  const search = useContactsStore(s => s.search);
  const setSearch = useContactsStore(s => s.setSearch);
  const [messageHits, setMessageHits] = useState<MessageSearchHit[]>([]);
  const [tab, setTab] = useState<Tab>('chats');
  const [plusOpen, setPlusOpen] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);
  const avatarMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!plusOpen && !avatarMenuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) {
        setPlusOpen(false);
      }
      if (avatarMenuRef.current && !avatarMenuRef.current.contains(e.target as Node)) {
        setAvatarMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setPlusOpen(false);
        setAvatarMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [plusOpen, avatarMenuOpen]);

  // Debounced FTS over jchat_messages — only fires when on the chats tab
  // (search-by-message doesn't apply to the contact directory).
  useEffect(() => {
    const q = search.trim();
    if (tab !== 'chats' || q.length < 2) {
      setMessageHits([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const hits = await ws.command<MessageSearchHit[]>('conversation.search', { q, limit: 5 });
        if (!cancelled) setMessageHits(hits || []);
      } catch {
        if (!cancelled) setMessageHits([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [search, ws, tab]);

  // Subscribe to actual state slices (NOT selector functions — those have stable
  // references and don't trigger re-render when underlying state changes).
  const agentIds = useContactsStore(s => s.agentIds);
  const agentsMap = useContactsStore(s => s.agents);
  const conversationIds = useContactsStore(s => s.conversationIds);
  const conversationsMap = useContactsStore(s => s.conversations);
  const activeId = useConversationsStore(s => s.activeId);
  const setMobilePane = useUiStore(s => s.setMobilePane);
  const focusSearchTrigger = useUiStore(s => s.focusSearchTrigger);
  const theme = useUiStore(s => s.theme);
  const setTheme = useUiStore(s => s.setTheme);
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);

  // Ctrl+K / Cmd+K → focus the search input.
  useEffect(() => {
    searchInputRef.current?.focus();
  }, [focusSearchTrigger]);

  const sidebarConversations = conversationIds.map(id => conversationsMap[id]).filter(Boolean);
  const q = search.trim().toLowerCase();
  const filteredAgents = q
    ? agentIds
        .map(id => agentsMap[id])
        .filter(a => a.name.toLowerCase().includes(q) || (a.description ?? '').toLowerCase().includes(q))
    : agentIds.map(id => agentsMap[id]);

  function handleOpenConversation(id: string) {
    navigate(`/chat/${id}`);
    setMobilePane('conversation');
  }

  function handleOpenDm(agentId: string) {
    // Reuse NewConversationPage's auto-create DM path: ?agentId=<id> will
    // either return the existing DM with that agent or create a new one.
    navigate(`/chat/new?agentId=${encodeURIComponent(agentId)}`);
    setMobilePane('conversation');
  }

  const placeholder = tab === 'chats' ? '搜索消息…' : '搜索联系人…';

  return (
    <div className="flex h-full flex-col">
      {/* Search + add-contact */}
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-700 px-3 py-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <Input
            ref={searchInputRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={placeholder}
            className="pl-8 pr-8"
            aria-label="Search"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                searchInputRef.current?.focus();
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              aria-label="清除搜索"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div ref={plusRef} className="relative">
          <button
            type="button"
            aria-label="新建"
            title="新建"
            aria-haspopup="menu"
            aria-expanded={plusOpen}
            onClick={() => setPlusOpen(o => !o)}
            className="flex h-9 w-9 items-center justify-center rounded-md bg-[#07c160] text-white shadow-sm hover:bg-[#06ae57] transition-colors"
          >
            <Plus className="h-4 w-4" />
          </button>
          <div
            role="menu"
            aria-hidden={!plusOpen || undefined}
            className={`absolute right-0 top-11 z-20 min-w-[160px] overflow-hidden rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 py-1 shadow-lg dark:shadow-gray-900 transition-all duration-200 ${
              plusOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
            }`}
          >
              <button
                type="button"
                role="menuitem"
                tabIndex={plusOpen ? 0 : -1}
                onClick={() => {
                  setPlusOpen(false);
                  navigate('/chat/new?type=group');
                  setMobilePane('conversation');
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <UsersIcon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                发起群聊
              </button>
              <button
                type="button"
                role="menuitem"
                tabIndex={plusOpen ? 0 : -1}
                onClick={() => {
                  setPlusOpen(false);
                  void useDistillationStore.getState().openWizard();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <UserPlus className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                添加联系人
              </button>
            </div>
        </div>
      </div>

      {/* Tab body */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'chats' && (
          <ChatsTab
            messageHits={messageHits}
            conversationsMap={conversationsMap}
            agentMap={agentsMap}
            sidebarConversations={sidebarConversations}
            activeId={activeId}
            onOpen={handleOpenConversation}
          />
        )}
        {tab === 'contacts' && (
          <ContactsTab
            agents={filteredAgents}
            q={q}
            onSelect={handleOpenDm}
          />
        )}
      </div>

      {/* Footer tabs (WeChat-style) */}
      <nav
        className="flex items-stretch border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
        aria-label="Sidebar tabs"
      >
        <FooterTabButton
          active={tab === 'chats'}
          onClick={() => setTab('chats')}
          Icon={MessageCircle}
          label="会话"
          count={sidebarConversations.length}
        />
        <FooterTabButton
          active={tab === 'contacts'}
          onClick={() => setTab('contacts')}
          Icon={UsersIcon}
          label="联系人"
          count={agentIds.length}
        />
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="border-l border-gray-100 dark:border-gray-700 px-3 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <div ref={avatarMenuRef} className="relative flex items-center">
          <button
            type="button"
            onClick={() => setAvatarMenuOpen(o => !o)}
            className="border-l border-gray-100 dark:border-gray-700 px-2 flex items-center justify-center h-full hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            aria-label="用户菜单"
            aria-haspopup="menu"
            aria-expanded={avatarMenuOpen}
          >
            <img
              src={avatarFallback(user?.displayName || user?.username || '我')}
              alt={user?.displayName || user?.username || '我'}
              className="h-7 w-7 rounded-md object-cover"
            />
          </button>
          <div
            role="menu"
            aria-hidden={!avatarMenuOpen || undefined}
            className={`absolute bottom-full right-0 mb-1 min-w-[140px] overflow-hidden rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 py-1 shadow-lg dark:shadow-gray-900 transition-all duration-200 ${
              avatarMenuOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
            }`}
          >
            <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                {user?.displayName || user?.username || '我'}
              </div>
            </div>
            <button
              type="button"
              role="menuitem"
              tabIndex={avatarMenuOpen ? 0 : -1}
              onClick={() => {
                setAvatarMenuOpen(false);
                void logout();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              退出
            </button>
          </div>
        </div>
      </nav>
    </div>
  );
}

function FooterTabButton({
  active,
  onClick,
  Icon,
  label,
  count
}: {
  active: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 transition-colors',
        active ? 'font-semibold text-[#07c160]' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
      )}
    >
      <Icon className="h-5 w-5" />
      <span className="text-[11px] leading-none">
        {label}
        {typeof count === 'number' && count > 0 && (
          <span className="ml-1 text-[10px] text-gray-400 dark:text-gray-500">({count})</span>
        )}
      </span>
      {active && (
        <span
          aria-hidden
          className="absolute top-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-b bg-[#07c160]"
        />
      )}
    </button>
  );
}

interface ChatsTabProps {
  messageHits: MessageSearchHit[];
  conversationsMap: Record<string, ReturnType<typeof useContactsStore.getState>['conversations'][string]>;
  agentMap: ReturnType<typeof useContactsStore.getState>['agents'];
  sidebarConversations: ReturnType<typeof useContactsStore.getState>['conversations'][string][];
  activeId: string | null;
  onOpen: (id: string) => void;
}

function ChatsTab({
  messageHits,
  conversationsMap,
  agentMap,
  sidebarConversations,
  activeId,
  onOpen
}: ChatsTabProps) {
  const ws = useJchatWsClient();
  const navigate = useNavigate();
  const [openMenuConvId, setOpenMenuConvId] = useState<string | null>(null);
  const [deletingConvId, setDeletingConvId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; title: string | null } | null>(null);

  async function handleDelete(conv: { id: string; title: string | null }) {
    setOpenMenuConvId(null);
    setConfirmTarget(conv);
  }

  async function executeDelete() {
    if (!confirmTarget) return;
    const conv = confirmTarget;
    setDeletingConvId(conv.id);
    try {
      await ws.command('conversation.delete', { conversationId: conv.id });
      setConfirmTarget(null);
      if (activeId === conv.id) {
        navigate('/chat', { replace: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除失败';

      console.error('[ContactList] conversation.delete failed', err);
      setConfirmTarget(null);
      useToastStore.getState().addToast({ message: msg, variant: 'error' });
    } finally {
      setDeletingConvId(null);
    }
  }

  return (
    <>
      {messageHits.length > 0 && (
        <>
          <SectionHeader>消息匹配</SectionHeader>
          {messageHits.map(hit => {
            const conv = conversationsMap[hit.conversationId];
            const memberAgents = (conv?.members || [])
              .map(m => agentMap[m.agentId])
              .filter(Boolean);
            const title =
              conv?.title ||
              (conv?.type === 'dm'
                ? memberAgents[0]?.name || 'DM'
                : memberAgents.map(a => a.name).slice(0, 3).join('、')) ||
              '会话';
            return (
              <button
                key={hit.messageId}
                type="button"
                onClick={() => onOpen(hit.conversationId)}
                className="group flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
              >
                <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{title}</span>
                <span className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                  {renderSnippet(hit.snippet)}
                </span>
              </button>
            );
          })}
        </>
      )}
      {sidebarConversations.length === 0 && messageHits.length === 0 && (
        <div className="px-3 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
          <MessageCircle className="mx-auto mb-2 h-6 w-6 text-gray-300 dark:text-gray-600" />
          还没有会话——切到「联系人」开始聊
        </div>
      )}
      {sidebarConversations.map(conv => {
        const memberAgents = (conv.members || [])
          .map(m => agentMap[m.agentId])
          .filter(Boolean);
        const isGroup = conv.type === 'group';
        const title =
          conv.title ||
          (conv.type === 'dm'
            ? memberAgents[0]?.name || 'DM'
            : memberAgents.map(a => a.name).slice(0, 3).join('、') +
              (memberAgents.length > 3 ? '…' : ''));
        const avatar = memberAgents[0]?.avatarUrl || avatarFallback(title);
        const last = conv.lastMessage;
        const isActive = activeId === conv.id;
        const lastTime = last?.createdAt ?? conv.updatedAt;
        let preview = last?.content?.trim() || '';
        if (preview && isGroup && last) {
          if (last.senderType === 'user') preview = `我: ${preview}`;
          else if (last.senderType === 'agent') {
            const sa = agentMap[last.senderId];
            if (sa) preview = `${sa.name}: ${preview}`;
          }
        } else if (!preview && last?.attachments?.length) {
          const firstMime = last.attachments[0]?.mime ?? '';
          preview = firstMime.startsWith('image/') ? '[图片]' : '[文件]';
        }
        return (
          <div
            key={conv.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(conv.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen(conv.id);
              }
            }}
            aria-current={isActive ? 'true' : undefined}
            className={cn(
              'group relative flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer',
              isActive ? 'bg-[#ededed] dark:bg-gray-700' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
            )}
          >
            {isActive && (
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r bg-[#07c160]"
              />
            )}
            <div className="relative flex-shrink-0">
              <img
                src={avatar}
                alt={title}
                className="h-10 w-10 rounded-md object-cover"
              />
              {isGroup && (
                <span
                  aria-label="Group"
                  className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border border-white bg-[#07c160] text-white shadow-sm"
                >
                  <UsersRound className="h-2.5 w-2.5" />
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{title}</span>
                <span className="flex-shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
                  {formatRelativeDay(lastTime)}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <span
                  className={cn(
                    'truncate text-xs',
                    preview ? 'text-gray-500 dark:text-gray-400' : 'text-gray-400 dark:text-gray-500'
                  )}
                >
                  {preview ? truncate(preview, 40) : '暂无消息'}
                </span>
                {(conv.unread ?? 0) > 0 && (
                  <span className="flex-shrink-0 rounded-full bg-[#fa5151] px-1.5 py-0.5 text-[10px] font-medium leading-none text-white">
                    {(conv.unread ?? 0) > 99 ? '99+' : conv.unread}
                  </span>
                )}
              </div>
            </div>
            <div
              className="relative ml-2 flex h-6 w-6 shrink-0 items-center justify-center"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                // Only swallow Enter/Space (the row's activation keys) so
                // they don't open the conversation when interacting with the
                // menu trigger. Let Escape / Arrow keys bubble to the
                // document so RowMenu's keydown listener can dismiss.
                if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
              }}
            >
              <button
                type="button"
                aria-label="更多"
                className="flex h-6 w-6 items-center justify-center rounded text-gray-400 dark:text-gray-500 opacity-0 transition-opacity hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200 group-hover:opacity-100 focus:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuConvId(openMenuConvId === conv.id ? null : conv.id);
                }}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              <RowMenu
                open={openMenuConvId === conv.id}
                onClose={() => setOpenMenuConvId(null)}
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={deletingConvId === conv.id}
                  onClick={() => handleDelete({ id: conv.id, title: conv.title ?? null })}
                  className="block w-full px-3 py-1.5 text-left text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                >
                  {deletingConvId === conv.id ? '删除中…' : '删除会话'}
                </button>
              </RowMenu>
            </div>
          </div>
        );
      })}
      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => { if (!open) setConfirmTarget(null); }}
        title="删除会话"
        description={`确定删除『${confirmTarget?.title || '该会话'}』吗？此操作不可恢复。`}
        confirmLabel="删除"
        variant="danger"
        loading={deletingConvId !== null}
        onConfirm={executeDelete}
      />
    </>
  );
}

interface ContactsTabProps {
  agents: ReturnType<typeof useContactsStore.getState>['agents'][string][];
  q: string;
  onSelect: (agentId: string) => void;
}

function ContactsTab({ agents, q, onSelect }: ContactsTabProps) {
  if (agents.length === 0) {
    return (
      <div className="px-3 py-10 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
          <Search className="h-4 w-4 text-gray-400 dark:text-gray-500" />
        </div>
        <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          {q ? `未找到 "${truncate(q, 20)}"` : '还没有联系人'}
        </div>
        <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          {q ? '换个关键词试试' : '点右上角 + 添加联系人'}
        </div>
      </div>
    );
  }
  return (
    <>
      {agents.map(agent => (
        <button
          key={agent.id}
          type="button"
          onClick={() => onSelect(agent.id)}
          className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
        >
          <img
            src={agent.avatarUrl || avatarFallback(agent.name)}
            alt={agent.name}
            className="h-10 w-10 flex-shrink-0 rounded-md object-cover"
          />
          <div className="flex-1 min-w-0">
            <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{agent.name}</div>
            <div className="truncate text-xs text-gray-500 dark:text-gray-400">
              {agent.description || '无简介'}
            </div>
          </div>
        </button>
      ))}
    </>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
      {children}
    </div>
  );
}
