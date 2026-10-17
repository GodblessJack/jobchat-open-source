import { describe, it, expect } from 'vitest';
import { decideAuthGate } from '@/lib/auth-gate';

describe('decideAuthGate (spec §5.4 cases C1-C4)', () => {
  it('C1: unauth visit to protected path → redirect-login with returnTo', () => {
    const d = decideAuthGate({
      isAuthenticated: false,
      pathname: '/chat/abc',
      isProtected: true
    });
    expect(d).toEqual({
      kind: 'redirect-login',
      returnTo: '/login?returnTo=%2Fchat%2Fabc'
    });
  });

  it('C2: post-login redirect honours returnTo (handled by caller; gate allows)', () => {
    // After successful login, isAuthenticated flips true while on /login.
    // The gate routes it via C4.
    const d = decideAuthGate({
      isAuthenticated: true,
      pathname: '/login',
      returnTo: '/chat/abc',
      isProtected: false
    });
    expect(d).toEqual({ kind: 'redirect-app', to: '/chat/abc' });
  });

  it('C3: JWT invalidated → clear + redirect-login regardless of current path', () => {
    const d = decideAuthGate({
      isAuthenticated: true,
      jwtInvalidated: true,
      pathname: '/chat/xyz',
      isProtected: true
    });
    expect(d.kind).toBe('redirect-login');
    if (d.kind === 'redirect-login') {
      expect(d.returnTo).toBe('/login?returnTo=%2Fchat%2Fxyz');
    }
  });

  it('C3 edge: jwtInvalidated while on /login → just redirect to /login (no self-loop returnTo)', () => {
    const d = decideAuthGate({
      isAuthenticated: false,
      jwtInvalidated: true,
      pathname: '/login',
      isProtected: false
    });
    expect(d).toEqual({ kind: 'redirect-login', returnTo: '/login' });
  });

  it('C4: authed user on /login with returnTo → redirect-app to returnTo', () => {
    const d = decideAuthGate({
      isAuthenticated: true,
      pathname: '/login',
      returnTo: '/chat/abc',
      isProtected: false
    });
    expect(d).toEqual({ kind: 'redirect-app', to: '/chat/abc' });
  });

  it('C4: authed user on /login without returnTo → redirect to default landing', () => {
    const d = decideAuthGate({
      isAuthenticated: true,
      pathname: '/login',
      isProtected: false
    });
    expect(d).toEqual({ kind: 'redirect-app', to: '/chat' });
  });

  it('allows authed visit to protected paths', () => {
    const d = decideAuthGate({
      isAuthenticated: true,
      pathname: '/chat/123',
      isProtected: true
    });
    expect(d).toEqual({ kind: 'allow' });
  });

  it('allows unauth visit to /login', () => {
    const d = decideAuthGate({
      isAuthenticated: false,
      pathname: '/login',
      isProtected: false
    });
    expect(d).toEqual({ kind: 'allow' });
  });
});
