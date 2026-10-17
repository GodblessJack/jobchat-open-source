/**
 * JchatWsProvider — owns the JchatWsClient singleton and wires snapshots /
 * deltas / presence into the right Zustand stores. Route-level auth guards
 * decide which children are allowed once auth bootstrap has completed.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { Loader2 } from 'lucide-react';
import { JchatWsClient, type ConnectionStatus, isAuthInvalidCode } from './jchat-ws-client';
import { useAuthStore } from '../store/auth';
import { useContactsStore } from '../store/contacts';
import { useConversationsStore } from '../store/conversations';
import { useMessagesStore } from '../store/messages';
import { usePresenceStore } from '../store/presence';
import { useAgentSessionStore } from '../store/agent-session';
import type {
  AgentStatusSnapshot,
  ContactsSnapshot,
  ConversationSnapshot,
  PresenceSnapshot
} from '@shared/domain';

interface JchatWsContextValue {
  client: JchatWsClient | null;
  status: ConnectionStatus;
  jwtInvalidated: boolean;
}

const JchatWsContext = createContext<JchatWsContextValue>({
  client: null,
  status: 'idle',
  jwtInvalidated: false
});

export function useJchatWs(): JchatWsContextValue {
  return useContext(JchatWsContext);
}

export function useJchatWsClient(): JchatWsClient {
  const ctx = useContext(JchatWsContext);
  if (!ctx.client) throw new Error('JchatWsClient not initialized — wrap component in <JchatWsProvider>');
  return ctx.client;
}

interface ProviderProps {
  /** WS endpoint URL. Defaults to `${origin}/ws`. */
  url?: string;
  children: ReactNode;
}

function defaultUrl(): string {
  if (typeof window === 'undefined') return '/ws';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export function JchatWsProvider({ url, children }: ProviderProps) {
  const jwt = useAuthStore(s => s.jwt);
  const ready = useAuthStore(s => s.ready);
  const clearAuth = useAuthStore(s => s.clear);

  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [jwtInvalidated, setJwtInvalidated] = useState(false);
  // Use state, not ref, so context value updates when client is created.
  const [client, setClient] = useState<JchatWsClient | null>(null);
  // Track whether the connection has ever been open with the current client.
  // Prevents children from sending WS commands before the first handshake.
  const [connectionEverOpened, setConnectionEverOpened] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!jwt) {
      // No auth — tear down any existing client.
      setClient(prev => {
        prev?.close();
        return null;
      });
      setStatus('idle');
      setConnectionEverOpened(false);
      return;
    }

    const wsUrl = url ?? defaultUrl();
    const client = new JchatWsClient({ url: wsUrl, jwt });
    setClient(client);
    setJwtInvalidated(false);
    setConnectionEverOpened(false);
    // Dev-only debug hook for inspecting the active WS client from the console.
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      (window as unknown as { __JCHAT_WS__: JchatWsClient }).__JCHAT_WS__ = client;
    }

    const offConn = client.onConnectionChange(s => {
      setStatus(s);
      if (s === 'open') setConnectionEverOpened(true);
    });

    const offSnapshot = client.onSnapshot('contacts', snap => {
      useContactsStore.getState().applySnapshot(snap.data as ContactsSnapshot);
      // Fold conversations into the conversations store too for fast lookup.
      const data = snap.data as ContactsSnapshot;
      for (const c of data.conversations) {
        useConversationsStore.getState().upsert(c);
      }
      // Then reconcile: drop any local entries the server no longer reports
      // (e.g. conversations the user deleted from another tab). Drafts stay.
      useConversationsStore.getState().reconcile(data.conversations.map(c => c.id));
    });

    const offPresence = client.onPresence(p => {
      usePresenceStore.getState().set(p.devices, p.otherTabs);
    });

    const offAgentStatus = client.onSnapshot('agent-status', snap => {
      useAgentSessionStore.getState().applySnapshot(snap.data as AgentStatusSnapshot);
    });

    // Fallback: capture any conversation:<id> snapshot that arrives before
    // the ConversationView has registered, by listening for the generic
    // delta + finalize events on the messagesStore.
    const offDelta = client.onDelta(delta => {
      useMessagesStore.getState().applyDelta(
        delta.conversationId,
        delta.messageId,
        delta.agentId,
        delta.textChunk
      );
      if (delta.isFinal) {
        useMessagesStore.getState().finalize(
          delta.conversationId,
          delta.messageId,
          (useMessagesStore.getState().selectStreaming(delta.conversationId)[delta.messageId]?.text) ?? ''
        );
      }
    });

    const offThinking = client.onThinking(t => {
      useMessagesStore.getState().applyThinkingDelta(t.conversationId, t.messageId, t.agentId, t.textChunk);
    });

    // Route tool_call events into the thinking event stream for ThinkingBar.
    // Security: strip tool args and results — only show tool name and status.
    // Users see WHAT tool was called, not its parameters or output content.
    const offToolCall = client.onToolCall(tc => {
      const store = useMessagesStore.getState();
      const elapsed = tc.result && typeof tc.result === 'object' && 'elapsed' in tc.result
        ? (tc.result as { elapsed: number }).elapsed
        : undefined;
      store.applyThinkingEvent(tc.conversationId, tc.messageId, tc.agentId, {
        ts: Date.now(),
        type: tc.status === 'result' ? 'tool_result' : tc.status === 'progress' ? 'tool_progress' : 'tool_call',
        text: tc.toolName,
        toolName: tc.toolName,
        // detail intentionally omitted — tool args/results may contain file paths, SQL, URLs, etc.
        elapsed,
        status: tc.status === 'result' ? 'done' : tc.status === 'error' ? 'error' : 'running',
      });
    });

    const offError = client.onError(err => {
      if (isAuthInvalidCode(err.code)) {
        setJwtInvalidated(true);
        clearAuth();
      }
    });

    // Subscribe to global topics by default.
    const unsubContacts = client.subscribe('contacts');
    const unsubAgentStatus = client.subscribe('agent-status');
    const unsubPresence = client.subscribe('presence');

    client.start();

    return () => {
      unsubContacts();
      unsubAgentStatus();
      unsubPresence();
      offConn();
      offSnapshot();
      offPresence();
      offAgentStatus();
      offDelta();
      offThinking();
      offToolCall();
      offError();
      client.close();
      setClient(prev => (prev === client ? null : prev));
    };
  }, [jwt, ready, url, clearAuth]);

  const value = useMemo<JchatWsContextValue>(
    () => ({ client, status, jwtInvalidated }),
    [client, status, jwtInvalidated]
  );

  // Gate 1: still bootstrapping auth store (refresh cookie → /auth/me).
  // Avoids rendering children while we don't know the auth state yet.
  if (!ready) {
    return (
      <JchatWsContext.Provider value={value}>
        <div className="flex h-screen items-center justify-center bg-wechat-bg dark:bg-gray-950 text-sm text-gray-400 dark:text-gray-500 gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中…
        </div>
      </JchatWsContext.Provider>
    );
  }

  // Gate 2: user is authenticated but WS client hasn't been created yet.
  // Prevents downstream `useJchatWsClient()` from throwing on first render
  // (the StrictMode double-mount + useEffect async path means client briefly null).
  if (jwt && !client) {
    return (
      <JchatWsContext.Provider value={value}>
        <div className="flex h-screen items-center justify-center bg-wechat-bg dark:bg-gray-950 text-sm text-gray-400 dark:text-gray-500 gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          连接中…
        </div>
      </JchatWsContext.Provider>
    );
  }

  // Gate 3: client object exists but the WebSocket handshake hasn't completed
  // for the first time yet. Without this gate, child components like
  // NewConversationPage immediately call ws.command() which fails with
  // "WebSocket not open" because the async handshake is still in-flight.
  // Once the connection has been open at least once (connectionEverOpened=true),
  // children stay mounted through reconnections — the JchatWsClient will queue
  // or reject commands as appropriate.
  if (client && !connectionEverOpened) {
    return (
      <JchatWsContext.Provider value={value}>
        <div className="flex h-screen items-center justify-center bg-wechat-bg dark:bg-gray-950 text-sm text-gray-400 dark:text-gray-500 gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          连接中…
        </div>
      </JchatWsContext.Provider>
    );
  }

  // Unauthenticated: render children so route-level auth guards can redirect
  // to /login and the login page itself can render.
  return <JchatWsContext.Provider value={value}>{children}</JchatWsContext.Provider>;
}

/** Hook used by ConversationView to subscribe to a specific conversation topic. */
export function useConversationSnapshot(
  conversationId: string | null,
  onSnapshot: (data: ConversationSnapshot) => void
) {
  const ctx = useContext(JchatWsContext);
  useEffect(() => {
    if (!ctx.client || !conversationId) return;
    const topic = `conversation:${conversationId}`;
    const off = ctx.client.onSnapshot(topic, snap => onSnapshot(snap.data as ConversationSnapshot));
    const unsub = ctx.client.subscribe(topic);
    return () => {
      off();
      unsub();
    };
  }, [ctx.client, conversationId, onSnapshot]);
}

/** Helper for components needing a `PresenceSnapshot` — exists for type re-export. */
export type { PresenceSnapshot };
