/**
 * AgentProfilePanel — right-rail "资料" tab content for DM conversations.
 *
 * Visual goals:
 *  - Hero: large avatar + name + role description
 *  - 互动数据: 你与这位 Agent 的对话数 / 总消息数
 *  - 简短能力提示 (best-effort from description)
 *  - 快捷操作: 发起新对话 / 复制 Agent ID
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, MessageCircle, MessageSquare, Sparkles } from 'lucide-react';
import type { AgentSummary } from '@shared/domain';
import { avatarFallback } from '../../utils/avatar';
import { useConversationsStore } from '../../store/conversations';
import { useMessagesStore } from '../../store/messages';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

interface Props {
  agent: AgentSummary | null;
}

export function AgentProfilePanel({ agent }: Props) {
  const navigate = useNavigate();
  const conversations = useConversationsStore(s => s.byId);
  const messagesByConv = useMessagesStore(s => s.byConvId);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Clean up copy timer on unmount.
  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  const stats = useMemo(() => {
    if (!agent) return { conversationCount: 0, messageCount: 0 };
    let conversationCount = 0;
    let messageCount = 0;
    for (const conv of Object.values(conversations)) {
      const isMine = conv.members?.some(m => m.agentId === agent.id);
      if (!isMine) continue;
      conversationCount += 1;
      const msgs = messagesByConv[conv.id] || [];
      // Count messages where this agent participated (sent OR received from user)
      messageCount += msgs.filter(
        m => m.senderId === agent.id || m.senderType === 'user'
      ).length;
    }
    return { conversationCount, messageCount };
  }, [agent, conversations, messagesByConv]);

  if (!agent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm text-gray-400 dark:text-gray-500">
        <Sparkles className="h-6 w-6 text-gray-300 dark:text-gray-600" />
        <div>未选择联系人</div>
      </div>
    );
  }

  function handleCopyId() {
    if (!agent) return;
    void navigator.clipboard.writeText(agent.id).then(() => {
      setCopied(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1200);
    });
  }

  function handleNewChat() {
    if (!agent) return;
    navigate(`/chat/new?agentId=${encodeURIComponent(agent.id)}`);
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 text-sm">
      {/* Hero */}
      <div className="flex flex-col items-center gap-2 pt-1">
        <div className="relative">
          <img
            src={agent.avatarUrl || avatarFallback(agent.name)}
            alt={agent.name}
            className="h-24 w-24 rounded-xl object-cover shadow-sm ring-1 ring-gray-200 dark:ring-gray-700"
          />
          <span
            aria-hidden
            className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white dark:border-gray-900 bg-[#07c160] shadow-sm"
            title="AI 联系人"
          >
            <Sparkles className="h-3 w-3 text-white" />
          </span>
        </div>
        <div className="text-center">
          <div className="text-base font-medium text-gray-800 dark:text-gray-200">{agent.name}</div>
          {agent.description && (
            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{agent.description}</div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          icon={<MessageCircle className="h-4 w-4 text-[#07c160]" />}
          label="会话数"
          value={stats.conversationCount}
        />
        <StatCard
          icon={<MessageSquare className="h-4 w-4 text-[#07c160]" />}
          label="消息数"
          value={stats.messageCount}
        />
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <Button
          onClick={handleNewChat}
          className="w-full justify-center bg-[#07c160] text-white hover:bg-[#06ae57]"
          size="sm"
        >
          发起新对话
        </Button>
        <button
          type="button"
          onClick={handleCopyId}
          className={cn(
            'flex w-full items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors',
            copied
              ? 'border-[#07c160] bg-[#07c160]/5 text-[#07c160]'
              : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500 hover:text-gray-700 dark:hover:text-gray-200'
          )}
        >
          <Copy className="h-3 w-3" />
          {copied ? '已复制 ID' : '复制联系人 ID'}
        </button>
      </div>

      {/* About */}
      {agent.description && (
        <div className="mt-2 rounded-md border border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/50 p-3">
          <div className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">关于</div>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-gray-600 dark:text-gray-300">
            {agent.description}
          </p>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-md border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
        {icon}
        {label}
      </div>
      <div className="text-lg font-semibold text-gray-800 dark:text-gray-200">{value}</div>
    </div>
  );
}
