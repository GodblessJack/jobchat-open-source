// meeting/src/App.tsx
import { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { ShareArea } from './components/ShareArea';
import { VideoPanel } from './components/VideoPanel';
import { useAudioCall } from './hooks/useAudioCall';
import { AuthProvider, useAuth } from './components/AuthContext';
import type {
  CallPersonaResponse,
  CallSessionMeta,
  CallStartResponse,
  CallBroadcastMessage
} from '../../jchat/shared/call-types';

function MeetingContent() {
  const { user, jwt, isAuthenticated, loading: authLoading } = useAuth();
  const [shareMode, setShareMode] = useState<'whiteboard' | 'screen'>('whiteboard');
  const [prevShareMode, setPrevShareMode] = useState<'whiteboard' | 'screen'>('whiteboard');
  const [meta, setMeta] = useState<CallSessionMeta | null>(null);
  const [systemInstruction, setSystemInstruction] = useState<string>('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const callState = useAudioCall({ user, systemInstruction, sessionId, jwt });

  function getConversationId(): string | null {
    const params = new URLSearchParams(window.location.search);
    return params.get('conversationId');
  }

  // Bootstrap: fetch persona + start session
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated || !jwt) {
      setBootstrapping(false);
      return;
    }
    const conversationId = getConversationId();
    if (!conversationId) {
      setErrorMessage('Missing conversationId. Please launch from jchat.');
      setBootstrapping(false);
      return;
    }
    (async () => {
      try {
        const personaRes = await fetch(
          `/api/call/persona?conversationId=${encodeURIComponent(conversationId)}`,
          { headers: { Authorization: `Bearer ${jwt}` } }
        );
        if (!personaRes.ok) throw new Error(`persona ${personaRes.status}`);
        const persona: CallPersonaResponse = await personaRes.json();
        setMeta(persona.session);
        setSystemInstruction(persona.systemInstruction);

        const startRes = await fetch('/api/call/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ conversationId })
        });
        if (!startRes.ok) throw new Error(`start ${startRes.status}`);
        const start: CallStartResponse = await startRes.json();
        setSessionId(start.sessionId);

        // Broadcast started
        try {
          const bc = new BroadcastChannel('jchat-call');
          const msg: CallBroadcastMessage = {
            type: 'started',
            sessionId: start.sessionId,
            conversationId,
            agentId: persona.session.agentId
          };
          bc.postMessage(msg);
          bc.close();
        } catch { /* BroadcastChannel may be unsupported in old browsers */ }
      } catch (err) {
        console.error('bootstrap failed', err);
        setErrorMessage('Failed to start call. Try again.');
      } finally {
        setBootstrapping(false);
      }
    })();
  }, [authLoading, isAuthenticated, jwt]);

  // Listen for focus-call broadcast (jchat tab clicks the bar)
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('jchat-call');
      bc.onmessage = (e) => {
        const msg = e.data as CallBroadcastMessage;
        if (msg.type === 'focus-call' && msg.sessionId === sessionId) window.focus();
      };
    } catch { /* unsupported */ }
    return () => { try { bc?.close(); } catch {} };
  }, [sessionId]);

  // Broadcast 'ended' when call status terminates
  useEffect(() => {
    if (callState.status === 'idle' && sessionId && meta) {
      try {
        const bc = new BroadcastChannel('jchat-call');
        bc.postMessage({
          type: 'ended',
          sessionId,
          conversationId: meta.conversationId
        } as CallBroadcastMessage);
        bc.close();
      } catch {}
    }
  }, [callState.status, sessionId, meta]);

  // Screen-sharing → switch shareMode
  useEffect(() => {
    if (callState.isScreenSharing) {
      if (shareMode !== 'screen') {
        setPrevShareMode(shareMode);
        setShareMode('screen');
      }
    } else if (shareMode === 'screen') {
      setShareMode(prevShareMode === 'screen' ? 'whiteboard' : prevShareMode);
    }
  }, [callState.isScreenSharing]);

  if (authLoading || bootstrapping) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-zinc-900 text-white">
        <div className="animate-pulse">Loading…</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-zinc-900 text-white gap-4">
        <p className="text-lg">请先在 jchat 中登录</p>
        <button
          onClick={() => window.close()}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-md"
        >
          关闭
        </button>
      </div>
    );
  }

  // Adapt the new persona meta into the legacy contact shape that
  // VideoPanel / ShareArea expect (name / role / avatar_url).
  // role MUST be a short label — never fall back to persona_description here,
  // VideoPanel renders it as a single-line subtitle and 11000-char markdown
  // would push the avatar + control buttons off-screen.
  const legacyContact = meta
    ? {
        id: meta.agentId,
        name: meta.agentName,
        role: meta.agentRole || '联系人',
        avatar_url: meta.agentAvatarUrl,
        persona_description: meta.agentDescription
      }
    : null;

  return (
    <div className="h-screen w-screen flex flex-col bg-white overflow-hidden relative">
      <Header contactName={meta?.agentName} />
      <div className="flex-1 flex overflow-hidden">
        <ShareArea
          shareMode={shareMode}
          onShareModeChange={setShareMode}
          callState={callState}
          contact={legacyContact as any}
        />
        {legacyContact ? (
          <VideoPanel callState={callState} contact={legacyContact as any} user={user as any} />
        ) : (
          <div className="w-[450px] bg-zinc-900 flex items-center justify-center text-zinc-500 italic border-l border-zinc-800">
            Waiting…
          </div>
        )}
      </div>
      {errorMessage && (
        <div className="absolute bottom-0 left-0 right-0 bg-red-500 text-white p-4 text-center z-50">
          {errorMessage}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MeetingContent />
    </AuthProvider>
  );
}
