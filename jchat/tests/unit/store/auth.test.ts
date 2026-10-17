/**
 * authStore basic state-transition tests.
 * Exercises the synchronous helpers (`clear`, `getJwt`, state transitions via
 * direct store manipulation).
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { useAuthStore } from '@/store/auth';

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
  });

  it('starts with no user / no jwt after clear', () => {
    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.jwt).toBeNull();
    expect(s.isAuthenticated).toBe(false);
  });

  it('clear() wipes user + jwt + accessToken', () => {
    // Manually set state to simulate a logged-in scenario
    useAuthStore.setState({
      user: { id: 'u1', username: 'testuser' },
      jwt: 'JWT-TOKEN',
      accessToken: 'JWT-TOKEN',
      isAuthenticated: true,
      isLoading: false,
      ready: true,
    });
    expect(useAuthStore.getState().user?.id).toBe('u1');
    expect(useAuthStore.getState().getJwt()).toBe('JWT-TOKEN');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    useAuthStore.getState().clear();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().jwt).toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
