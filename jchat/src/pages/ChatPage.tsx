/**
 * ChatPage — main 3-column app shell with active conversation routing.
 */

import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { AppShell } from '../components/containers/AppShell';
import { ContactList } from '../components/containers/ContactList';
import { ConversationView } from '../components/containers/ConversationView';
import { DetailPanel } from '../components/containers/DetailPanel';
import { useConversationsStore } from '../store/conversations';

export function ChatPage() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const open = useConversationsStore(s => s.open);

  useEffect(() => {
    open(conversationId ?? null);
  }, [conversationId, open]);

  return (
    <AppShell
      left={<ContactList />}
      center={<ConversationView conversationId={conversationId ?? null} />}
      right={<DetailPanel conversationId={conversationId ?? null} />}
    />
  );
}
