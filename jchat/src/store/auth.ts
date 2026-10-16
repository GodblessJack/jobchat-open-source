/**
 * authStore — local JWT-based auth state (no Supabase).
 *
 * The store holds the canonical user/jwt; UI components and the WS client
 * read from here. All API calls go to the local auth endpoints.
 *
 * Auth flow:
 *   bootstrap() → POST /api/auth/refresh (cookie) → GET /api/auth/me → set state
 *   login()     → POST /api/auth/login → set state
 *   register()  → POST /api/auth/register → set state
 *   logout()    → POST /api/auth/logout → clear state
 *   refreshSession() → POST /api/auth/refresh (cookie) → update accessToken
 */

import { create } from 'zustand';

export interface AppUser {
  id: string;
  username: string;
  displayName?: string;
}

export interface AuthState {
  user: AppUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  bootstrap: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  getJwt: () => string | null;
  clear: () => void;
}

async function apiPost(path: string, body?: Record<string, unknown>): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function apiGet(path: string, token: string): Promise<Response> {
  return fetch(path, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export const useAuthStore = create<AuthState & { jwt: string | null; ready: boolean }>((set, get) => ({
  user: null,
  accessToken: null,
  jwt: null, // alias for accessToken — kept for backward compat
  isAuthenticated: false,
  ready: false, // alias for !isLoading — kept for backward compat
  isLoading: true,

  async bootstrap() {
    try {
      // Step 1: Try cookie-based refresh to get an access token.
      const refreshRes = await apiPost('/api/auth/refresh');
      let token: string | null = null;
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        token = refreshData.accessToken ?? null;
      }

      // Step 2: If we got a token, fetch user info.
      let user: AppUser | null = null;
      if (token) {
        const meRes = await apiGet('/api/auth/me', token);
        if (meRes.ok) {
          const meData = await meRes.json();
          user = meData.user ?? null;
        }
      }

      // Guard: if login()/register() already established auth state while
      // bootstrap was in-flight, don't overwrite it.
      const current = get();
      if (current.isAuthenticated) {
        set({ ready: true, isLoading: false });
        return;
      }

      set({
        user,
        accessToken: token,
        jwt: token,
        isAuthenticated: !!user,
        ready: true,
        isLoading: false,
      });
    } catch (err) {

      console.warn('[authStore.bootstrap] failed', err);
      // Same guard: don't clobber state that login()/register() already set.
      const current = get();
      if (current.isAuthenticated) {
        set({ ready: true, isLoading: false });
        return;
      }
      set({ user: null, accessToken: null, jwt: null, isAuthenticated: false, ready: true, isLoading: false });
    }
  },

  async login(username, password) {
    try {
      const res = await apiPost('/api/auth/login', { username, password });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: 'Login failed' }));
        throw new Error(errBody.message || errBody.error || `Login failed (${res.status})`);
      }
      const data = await res.json();
      const user: AppUser = data.user;
      const token: string = data.accessToken;
      set({
        user,
        accessToken: token,
        jwt: token,
        isAuthenticated: true,
        ready: true,
        isLoading: false,
      });
    } catch (err) {

      console.warn('[authStore.login] failed', err);
      throw err;
    }
  },

  async register(username, password) {
    try {
      const res = await apiPost('/api/auth/register', { username, password });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: 'Registration failed' }));
        throw new Error(errBody.message || errBody.error || `Registration failed (${res.status})`);
      }
      const data = await res.json();
      const user: AppUser = data.user;
      const token: string = data.accessToken;
      set({
        user,
        accessToken: token,
        jwt: token,
        isAuthenticated: true,
        ready: true,
        isLoading: false,
      });
    } catch (err) {

      console.warn('[authStore.register] failed', err);
      throw err;
    }
  },

  async logout() {
    try {
      await apiPost('/api/auth/logout');
    } catch {
      // Best-effort; clear state regardless.
    }
    set({ user: null, accessToken: null, jwt: null, isAuthenticated: false, ready: true, isLoading: false });
  },

  async refreshSession() {
    try {
      const res = await apiPost('/api/auth/refresh');
      // Guard: if logout()/clear() fired while refresh was in-flight, discard.
      if (!get().isAuthenticated) return;
      if (res.ok) {
        const data = await res.json();
        const token: string = data.accessToken;
        // Double-check after JSON parse — logout could fire during parse.
        if (!get().isAuthenticated) return;
        set({ accessToken: token, jwt: token });
      } else if (res.status === 401) {
        if (!get().isAuthenticated) return;
        console.warn('[authStore.refreshSession] refresh cookie expired, clearing auth state');
        set({ user: null, accessToken: null, jwt: null, isAuthenticated: false });
      } else {
        console.warn('[authStore.refreshSession] unexpected status', res.status);
      }
    } catch {
      // Silent — refresh is best-effort (network error, no state change).
    }
  },

  clear() {
    set({ user: null, accessToken: null, jwt: null, isAuthenticated: false, ready: true, isLoading: false });
  },

  getJwt() {
    return get().jwt;
  },
}));
