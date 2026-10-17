/**
 * auth-gate.ts — pure decision function for §5.4 auth-redirect logic.
 *
 * Used by AppShell and LoginPage. Pure function so it is testable without
 * mounting React components.
 *
 * Cases:
 *  C1: unauthenticated visit to a protected path → redirect to login with returnTo
 *  C2: login success while a returnTo is present → redirect to returnTo
 *  C3: JWT invalid (e.g. AUTH_INVALID error) → clear store + redirect to login
 *  C4: already-authenticated visit to /login → redirect to returnTo or default
 */

export interface AuthGateInput {
  isAuthenticated: boolean;
  /** True when an inbound error (HTTP 401 or WS AUTH_INVALID) has invalidated the JWT. */
  jwtInvalidated?: boolean;
  /** Current pathname (e.g. '/chat/abc' or '/login'). */
  pathname: string;
  /** Current ?returnTo= search param (decoded). null if absent. */
  returnTo?: string | null;
  /** True for routes the gate should protect (not /login itself). */
  isProtected: boolean;
  /** Where to land when the user has no returnTo. Default '/chat'. */
  defaultLanding?: string;
}

export type AuthGateDecision =
  | { kind: 'allow' }
  | { kind: 'redirect-login'; returnTo: string }
  | { kind: 'redirect-app'; to: string };

const DEFAULT_LANDING = '/chat';
const LOGIN_PATH = '/login';

function buildLoginUrl(returnTo: string | null): string {
  if (!returnTo || returnTo === LOGIN_PATH) return LOGIN_PATH;
  return `${LOGIN_PATH}?returnTo=${encodeURIComponent(returnTo)}`;
}

export function decideAuthGate(input: AuthGateInput): AuthGateDecision {
  const landing = input.defaultLanding ?? DEFAULT_LANDING;
  const safeReturnTo = input.returnTo ?? null;

  // C3: JWT invalidated — always force re-login, regardless of current page.
  if (input.jwtInvalidated) {
    const target = input.pathname && input.pathname !== LOGIN_PATH ? input.pathname : null;
    return { kind: 'redirect-login', returnTo: buildLoginUrl(target) };
  }

  // C1: unauth visit to a protected path
  if (!input.isAuthenticated && input.isProtected) {
    return { kind: 'redirect-login', returnTo: buildLoginUrl(input.pathname) };
  }

  // C4: authenticated user lands on /login
  if (input.isAuthenticated && !input.isProtected && input.pathname === LOGIN_PATH) {
    return { kind: 'redirect-app', to: safeReturnTo || landing };
  }

  // C2: login success (caller drives this — given the returnTo we redirect home)
  // For caller convenience: when `isAuthenticated` flips true while still on /login,
  // we already cover this via C4 above.

  return { kind: 'allow' };
}
