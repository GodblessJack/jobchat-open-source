// jchat/src/components/containers/CallStatusBar.tsx
//
// Amber status bar shown at the top of the conversation column while a call
// is active. Click → broadcasts `focus-call`, prompting the meeting tab to
// re-focus its window. Renders nothing when:
//   - no activeCall in useUiStore, OR
//   - activeCall.conversationId !== current conversationId.

import { Phone } from 'lucide-react';
import { useUiStore } from '../../store/ui';
import { useContactsStore } from '../../store/contacts';
import { postCallEvent } from '../../lib/call';

interface Props {
  conversationId: string | null;
}

export function CallStatusBar({ conversationId }: Props) {
  const activeCall = useUiStore(s => s.activeCall);
  const agent = useContactsStore(s => activeCall ? s.agents[activeCall.agentId] : undefined);

  if (!activeCall) return null;
  if (conversationId && activeCall.conversationId !== conversationId) return null;

  const name = agent?.name ?? '通话';

  function handleFocus() {
    postCallEvent({ type: 'focus-call', sessionId: activeCall!.sessionId });
  }

  return (
    <button
      type="button"
      onClick={handleFocus}
      className="flex w-full items-center justify-center gap-2 bg-amber-500/95 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 transition-colors"
      aria-label="切回视频通话窗口"
    >
      <Phone className="h-3.5 w-3.5" />
      <span>与 {name} 通话中…（点击切回通话窗口）</span>
    </button>
  );
}
