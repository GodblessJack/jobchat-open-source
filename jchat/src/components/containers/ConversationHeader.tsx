import { useEffect, useRef, useState } from 'react';
import { Settings2, Video } from 'lucide-react';
import { Button } from '../ui/button';
import { useUiStore } from '../../store/ui';
import { useContactsStore } from '../../store/contacts';
import { useJchatWsClient } from '../../ws/JchatWsProvider';
import type { ConversationSummary } from '@shared/domain';

interface Props {
  conversation: ConversationSummary;
}

export function ConversationHeader({ conversation }: Props) {
  const toggleDetail = useUiStore(s => s.toggleDetailPanel);
  const agents = useContactsStore(s => s.agents);
  const ws = useJchatWsClient();

  const memberAgents = (conversation.members || [])
    .map(m => agents[m.agentId])
    .filter(Boolean);
  const title =
    conversation.title ||
    (conversation.type === 'dm'
      ? memberAgents[0]?.name || 'DM'
      : `群聊 (${memberAgents.length})`);
  const subtitle =
    conversation.type === 'dm'
      ? memberAgents[0]?.description || ''
      : memberAgents.map(a => a.name).slice(0, 5).join('、');

  const canEdit = conversation.type === 'group';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title ?? '');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(conversation.title ?? '');
  }, [conversation.title, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  async function commit() {
    const next = draft.trim();
    const current = conversation.title ?? '';
    if (next === current || next === '') {
      setEditing(false);
      setDraft(current);
      return;
    }
    setSaving(true);
    try {
      await ws.command('conversation.rename', {
        conversationId: conversation.id,
        title: next
      });
    } catch (err) {
      console.error('Rename failed:', err);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  return (
    <header className="flex items-center justify-between bg-white px-4 py-3">
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { commit().catch(err => console.error('Rename failed:', err)); }}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur();
              else if (e.key === 'Escape') {
                setDraft(conversation.title ?? '');
                setEditing(false);
              }
            }}
            disabled={saving}
            className="w-full truncate rounded border border-gray-300 bg-white px-2 py-0.5 text-base font-medium text-gray-800 outline-none focus:border-gray-400"
          />
        ) : (
          <div
            className={`truncate text-base font-medium text-gray-800 ${canEdit ? 'cursor-text hover:bg-gray-50 rounded px-1 -mx-1' : ''}`}
            onDoubleClick={canEdit ? () => setEditing(true) : undefined}
            title={canEdit ? '双击修改群名' : undefined}
          >
            {title}
          </div>
        )}
        {subtitle && !editing && (
          <div className="truncate text-xs text-gray-500">{subtitle}</div>
        )}
      </div>
      <div className="flex items-center gap-1">
        {conversation.type === 'dm' && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="视频通话"
            onClick={() => {
              useUiStore.getState().setDetailPanelActiveTab('call');
              useUiStore.getState().setDetailPanelVisible(true);
              useUiStore.getState().setDetailPanelWidth(400);
            }}
          >
            <Video className="h-4 w-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" aria-label="联系人资料" onClick={toggleDetail}>
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
