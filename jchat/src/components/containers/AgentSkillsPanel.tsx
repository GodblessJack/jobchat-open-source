import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { useJchatWsClient } from '../../ws/JchatWsProvider';
import { Button } from '../ui/button';
import { clampLength, stripBidiOverride } from '../../utils/textSanitize';
import type { AgentSkillView } from '@shared/domain';
import type { AgentSkillsListResult } from '@shared/protocol';

interface Props {
  agentId: string | null;
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; skills: AgentSkillView[] }
  | { kind: 'error'; message: string };

const DESCRIPTION_MAX = 280;

function sanitizeDescription(raw: string | null): string {
  if (!raw) return '';
  return clampLength(stripBidiOverride(raw), DESCRIPTION_MAX);
}

export function AgentSkillsPanel({ agentId }: Props) {
  const ws = useJchatWsClient();
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!agentId) {
      setState({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'loading' });
    ws.command<AgentSkillsListResult>('agent.skills.list', { agentId })
      .then(res => {
        if (cancelled) return;
        setState({ kind: 'loaded', skills: res.skills });
      })
      .catch(err => {
        if (cancelled) return;
        setState({ kind: 'error', message: err?.message ?? '加载失败' });
      });
    return () => { cancelled = true; };
  }, [agentId, reloadKey, ws]);

  if (!agentId) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-gray-400 dark:text-gray-500">
        未选择联系人
      </div>
    );
  }

  if (state.kind === 'loading' || state.kind === 'idle') {
    return (
      <div className="flex h-full items-center justify-center p-4 text-gray-400 dark:text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm text-gray-500 dark:text-gray-400">
        <div>加载失败</div>
        <Button size="sm" variant="outline" onClick={() => setReloadKey(k => k + 1)}>
          重试
        </Button>
      </div>
    );
  }

  const { skills } = state;

  if (skills.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm text-gray-400 dark:text-gray-500">
        <Sparkles className="h-6 w-6 text-gray-300 dark:text-gray-600" />
        <div>该联系人暂未配置技能</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4 text-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
        <Sparkles className="h-3.5 w-3.5 text-[#07c160]" />
        <span>技能</span>
        <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-[10px] text-gray-500 dark:text-gray-300">
          {skills.length} 项
        </span>
      </div>
      <ul className="space-y-2">
        {skills.map(s => {
          const desc = sanitizeDescription(s.description);
          return (
            <li
              key={s.slug}
              className="rounded-md border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-3"
            >
              <div className="font-medium text-gray-800 dark:text-gray-200">{s.name}</div>
              {desc ? (
                <p
                  className="mt-1 line-clamp-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400"
                  title={desc.length > 80 ? desc : undefined}
                >
                  {desc}
                </p>
              ) : (
                <p className="mt-1 text-xs italic text-gray-400 dark:text-gray-500">未提供描述</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
