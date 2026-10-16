import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { LoginPage } from './pages/LoginPage';
import { ChatPage } from './pages/ChatPage';
import { NewConversationPage } from './pages/NewConversationPage';
import { useAuthStore } from './store/auth';
import { JchatWsProvider } from './ws/JchatWsProvider';
import { AppShell } from './components/containers/AppShell';
import { ContactList } from './components/containers/ContactList';
import { DetailPanel } from './components/containers/DetailPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { pushProfileOnce } from './services/profile';
import { useCallBroadcast } from './hooks/useCallBroadcast';
import { useAuthRefresh } from './hooks/useAuthRefresh';
import { AddContactWizard } from './components/wizard/AddContactWizard';

/**
 * AuthGuard — redirects to /login if the user is not authenticated.
 * Prevents ConversationView (which calls useJchatWsClient) from rendering
 * without a WS client when bootstrapping finds no session cookie.
 */
function AuthGuard({ children }: { children: ReactNode }) {
  const ready = useAuthStore(s => s.ready);
  const user = useAuthStore(s => s.user);
  const location = useLocation();

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center gap-2 bg-wechat-bg dark:bg-gray-950 text-sm text-gray-400 dark:text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载中…
      </div>
    );
  }

  if (!user) {
    return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
  }

  return <>{children}</>;
}

function NewConversationRoute() {
  return (
    <AppShell
      left={<ContactList />}
      center={<NewConversationPage />}
      right={<DetailPanel conversationId={null} />}
    />
  );
}

function LoginRoute() {
  // C4: authed user on /login → redirect to returnTo (or /chat).
  const user = useAuthStore(s => s.user);
  const ready = useAuthStore(s => s.ready);
  const location = useLocation();
  const params = new URLSearchParams(location.search);

  if (ready && user) {
    const returnTo = params.get('returnTo') || '/chat';
    return <Navigate to={returnTo} replace />;
  }
  return <LoginPage />;
}

export default function App() {
  const bootstrap = useAuthStore(s => s.bootstrap);
  const userId = useAuthStore(s => s.user?.id ?? null);
  const getJwt = useAuthStore(s => s.getJwt);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Fire-and-forget: push timezone + locale once per browser session after auth.
  useEffect(() => {
    if (!userId) return;
    void pushProfileOnce(userId, async () => getJwt());
  }, [userId, getJwt]);

  useCallBroadcast();
  useAuthRefresh();

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <JchatWsProvider>
          <AddContactWizard />
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route
              path="/chat"
              element={
                <AuthGuard>
                  <ChatPage />
                </AuthGuard>
              }
            />
            <Route
              path="/chat/new"
              element={
                <AuthGuard>
                  <NewConversationRoute />
                </AuthGuard>
              }
            />
            <Route
              path="/chat/:conversationId"
              element={
                <AuthGuard>
                  <ChatPage />
                </AuthGuard>
              }
            />
            <Route path="/" element={<Navigate to="/chat" replace />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </JchatWsProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
