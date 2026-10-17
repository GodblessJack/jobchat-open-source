/**
 * DetailPanel — right column.
 *  - DM: tabs between 资料 / 技能.
 *  - Group: delegates entirely to RoundtableInfoPanel (no tab system).
 */

import { type ComponentType } from 'react';
import { User, Sparkles, Phone, X } from 'lucide-react';
import { useConversationsStore } from '../../store/conversations';
import { useContactsStore } from '../../store/contacts';
import { AgentProfilePanel } from './AgentProfilePanel';
import { AgentSkillsPanel } from './AgentSkillsPanel';
import { RoundtableInfoPanel } from '../group/RoundtableInfoPanel';
import { CallPanel } from '../call/CallPanel';
import { useUiStore } from '../../store/ui';
import { cn } from '../../lib/utils';

interface Props {
  conversationId: string | null;
}

export function DetailPanel({ conversationId }: Props) {
  const conv = useConversationsStore(s => (conversationId ? s.byId[conversationId] : null));
  const agents = useContactsStore(s => s.agents);
  const tab = useUiStore(s => s.detailPanelActiveTab);
  const setTab = useUiStore(s => s.setDetailPanelActiveTab);
  const setDetailPanelVisible = useUiStore(s => s.setDetailPanelVisible);

  if (!conv) {
    return <div className="p-4 text-sm text-gray-400">未选择会话</div>;
  }

  if (conv.type === 'group') {
    return (
      <div className="flex h-full flex-col">
        <nav className="sticky top-0 z-10 flex items-center border-b border-gray-200 bg-white text-xs" aria-label="Detail panel header">
          <span className="flex-1 px-3 py-2.5 text-[11px] font-medium text-gray-500 tracking-wider uppercase">
            群聊信息
          </span>
          <button
            type="button"
            onClick={() => setDetailPanelVisible(false)}
            className="px-3 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
            aria-label="关闭面板"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </nav>
        <div className="flex-1 overflow-y-auto">
          <RoundtableInfoPanel conversationId={conv.id} />
        </div>
      </div>
    );
  }

  const dmAgent = agents[conv.members[0]?.agentId] ?? null;

  return (
    <div className="flex h-full flex-col">
      <nav
        className="sticky top-0 z-10 flex items-stretch border-b border-gray-200 bg-white text-xs"
        aria-label="Detail panel tabs"
      >
        <TabButton
          active={tab === 'profile'}
          onClick={() => setTab('profile')}
          Icon={User}
          label="资料"
        />
        <TabButton
          active={tab === 'skills'}
          onClick={() => setTab('skills')}
          Icon={Sparkles}
          label="技能"
        />
        <TabButton
          active={tab === 'call'}
          onClick={() => setTab('call')}
          Icon={Phone}
          label="通话"
        />
        <button
          type="button"
          onClick={() => setDetailPanelVisible(false)}
          className="ml-auto px-3 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
          aria-label="关闭面板"
          title="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </nav>

      <div className="flex-1 overflow-y-auto">
        {tab === 'profile' && <AgentProfilePanel agent={dmAgent} />}
        {tab === 'skills' && <AgentSkillsPanel agentId={dmAgent?.id ?? null} />}
        {dmAgent && (
          <div style={{ display: tab === 'call' ? undefined : 'none' }}>
            <CallPanel
              conversationId={conv.id}
              agentId={dmAgent.id}
              agentName={dmAgent.name}
              agentRole={dmAgent.description}
              agentAvatarUrl={dmAgent.avatarUrl}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  Icon,
  label
}: {
  active: boolean;
  onClick: () => void;
  Icon: ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex flex-1 flex-col items-center justify-center gap-0.5 px-2 py-2.5 transition-colors',
        active
          ? 'font-semibold text-[#07c160]'
          : 'text-gray-500 hover:text-gray-700'
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="text-[11px] leading-none">{label}</span>
      {active && (
        <span
          aria-hidden
          className="absolute bottom-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-t bg-[#07c160]"
        />
      )}
    </button>
  );
}
