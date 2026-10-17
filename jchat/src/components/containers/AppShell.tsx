/**
 * AppShell — three-column layout with mobile collapse + auth gate.
 *
 * Auth gate (post-landing-modal):
 *   C1: unauth → window.location.replace('/?login=1&returnTo=<path>')
 *   C2: login success → handled in landing/App.tsx onAuthStateChange (cross-SPA jump back)
 *   C3: jwtInvalidated → same as C1
 *
 * Cross-SPA redirect uses window.location.replace, not react-router Navigate,
 * because the target ("/") is the landing SPA — not a jchat route.
 *
 * Layout:
 *   ≥ md   : 3-column flex (sidebar | conversation | detail panel-if-visible)
 *   < md   : single column controlled by `mobilePane` ('list' | 'conversation').
 *            DetailPanel becomes a full-screen overlay sliding in from the
 *            right when toggled.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { decideAuthGate } from '../../lib/auth-gate';
import { useAuthStore } from '../../store/auth';
import { useUiStore } from '../../store/ui';
import { useJchatWs } from '../../ws/JchatWsProvider';
import { ToastContainer } from './ToastContainer';
import { cn } from '../../lib/utils';

/**
 * Subscribe to the Tailwind `lg` breakpoint (1024px). We use this to render
 * the DetailPanel exactly once — either as a docked sidebar on lg+ screens
 * or as a full-screen overlay on smaller ones — instead of mounting both
 * copies and hiding one with CSS. CSS `display:none` does not unmount React
 * components, so the prior approach gave us two parallel DetailPanel trees
 * sharing every store subscription.
 */
function useIsLgUp(): boolean {
  const [isLg, setIsLg] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  );
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsLg(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return isLg;
}

interface AppShellProps {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
}

export function AppShell({ left, center, right }: AppShellProps) {
  const location = useLocation();
  const user = useAuthStore(s => s.user);
  const ready = useAuthStore(s => s.ready);
  const { jwtInvalidated, status: wsStatus } = useJchatWs();
  const detailPanelVisible = useUiStore(s => s.detailPanelVisible);
  const setDetailPanelVisible = useUiStore(s => s.setDetailPanelVisible);
  const detailPanelWidth = useUiStore(s => s.detailPanelWidth);
  const mobilePane = useUiStore(s => s.mobilePane);
  const isLgUp = useIsLgUp();

  // Run the auth gate. The target ("/") is the landing SPA — leaving the
  // jchat SPA entirely, so we use window.location.replace rather than
  // react-router navigate (which would stay inside jchat and infinite-loop).
  //
  // When the JWT has been invalidated (server told us AUTH_INVALID), the
  // persisted Supabase session in localStorage is stale but still present —
  // landing would see it as authenticated and bounce straight back, looping
  // forever. signOut() purges that storage before we hand off.
  useEffect(() => {
    if (!ready) return;
    const decision = decideAuthGate({
      isAuthenticated: !!user,
      jwtInvalidated,
      pathname: location.pathname,
      isProtected: true
    });
    if (decision.kind === 'redirect-login' && typeof window !== 'undefined') {
      const target = decision.returnTo;
      if (jwtInvalidated) {
        void useAuthStore.getState().logout().finally(() => window.location.replace(target));
      } else {
        window.location.replace(target);
      }
    }
  }, [user, ready, jwtInvalidated, location.pathname]);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-wechat-bg text-gray-500">
        正在加载…
      </div>
    );
  }

  if (!user) {
    // Render a tiny placeholder while the auth gate hands off to landing.
    return (
      <div className="flex h-screen items-center justify-center bg-wechat-bg text-sm text-gray-400">
        跳转登录中…
      </div>
    );
  }

  // Show reconnect banner only when actively reconnecting after the initial
  // open. 'idle' / 'connecting' before first open should not flash the banner.
  const reconnecting = wsStatus === 'reconnecting';

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-wechat-bg text-gray-800">
      {/* Reconnecting banner — small, semi-transparent, fixed top */}
      {reconnecting && (
        <div
          role="status"
          className="pointer-events-none absolute left-1/2 top-2 z-50 -translate-x-1/2 rounded-full bg-amber-500/90 px-3 py-1 text-xs font-medium text-white shadow-md"
        >
          正在重新连接…
        </div>
      )}

      {/* Left column — contact list */}
      <aside
        className={cn(
          'h-full border-r border-gray-200 bg-white',
          // Desktop: fixed width, always shown
          'md:flex md:w-72 md:flex-col',
          // Mobile: only when on 'list' pane
          mobilePane === 'list' ? 'flex w-full flex-col' : 'hidden md:flex'
        )}
        aria-label="Contact list"
      >
        {left}
      </aside>

      {/* Center column — conversation */}
      <main
        className={cn(
          'h-full flex-1 flex-col bg-wechat-chat',
          'md:flex',
          mobilePane === 'conversation' ? 'flex w-full' : 'hidden md:flex'
        )}
        aria-label="Conversation"
      >
        {center}
      </main>

      {/* Right column — detail panel.
          Single mount; layout switches between docked (lg+) and overlay
          (<lg) via matchMedia, so DetailPanel + its children only run one
          set of effects / store subscriptions. */}
      {detailPanelVisible && (
        isLgUp ? (
          <aside
            className="flex h-full flex-col border-l border-gray-200 bg-white"
            style={{ width: detailPanelWidth }}
            aria-label="Detail panel"
          >
            {right}
          </aside>
        ) : (
          <div
            className="absolute inset-0 z-40 flex"
            role="dialog"
            aria-label="Detail panel"
            aria-modal="true"
          >
            <button
              type="button"
              aria-label="Close detail panel"
              onClick={() => setDetailPanelVisible(false)}
              className="absolute inset-0 bg-transparent"
            />
            <aside className="relative z-10 ml-auto flex h-full w-full max-w-sm flex-col border-l border-gray-200 bg-white shadow-xl">
              {right}
            </aside>
          </div>
        )
      )}
      <ToastContainer />
    </div>
  );
}
