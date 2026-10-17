/// <reference types="vite/client" />

export interface User {
  id: string;
  username: string;
  displayName?: string;
  /** Backward-compat alias for `displayName` */
  name?: string;
  /** Backward compat — always '' for local auth */
  email?: string;
  /** Backward compat — always '' for local auth */
  avatar?: string;
  /** Backward compat — always 'local' for local auth */
  provider?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  user?: User;
}

// ── API helpers ──────────────────────────────────────────────────────────────

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

function toUser(raw: { id: string; username: string; displayName?: string }): User {
  return {
    id: raw.id,
    username: raw.username,
    displayName: raw.displayName,
    name: raw.displayName ?? raw.username,
    email: '',
    avatar: '',
    provider: 'local',
  };
}

// ── Auth service ─────────────────────────────────────────────────────────────

export const authService = {
  /** Login with username + password. Returns the user on success. */
  login: async (username: string, password: string): Promise<User> => {
    const res = await apiPost('/api/auth/login', { username, password });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(errBody.error ?? `Login failed (${res.status})`);
    }
    const data = await res.json();
    return toUser(data.user);
  },

  /** Register a new account. Returns the user on success. */
  register: async (username: string, password: string): Promise<User> => {
    const res = await apiPost('/api/auth/register', { username, password });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: 'Registration failed' }));
      throw new Error(errBody.error ?? `Registration failed (${res.status})`);
    }
    const data = await res.json();
    return toUser(data.user);
  },

  /** Check existing session via cookie refresh + /me. */
  checkSession: async (): Promise<AuthState> => {
    try {
      const refreshRes = await apiPost('/api/auth/refresh');
      if (!refreshRes.ok) return { isAuthenticated: false };

      const refreshData = await refreshRes.json();
      const token: string | undefined = refreshData.access_token;
      if (!token) return { isAuthenticated: false };

      const meRes = await apiGet('/api/auth/me', token);
      if (!meRes.ok) return { isAuthenticated: false };

      const meData = await meRes.json();
      if (!meData.user) return { isAuthenticated: false };

      return { isAuthenticated: true, user: toUser(meData.user) };
    } catch {
      return { isAuthenticated: false };
    }
  },

  /** Logout. */
  logout: async () => {
    try {
      await apiPost('/api/auth/logout');
    } catch {
      // Best-effort.
    }
  },

  /** Subscribe to auth state changes (stub — only fires when bootstrapped manually). */
  onAuthStateChange: (_callback: (event: string, _session: unknown) => void) => {
    // Local JWT auth does not have real-time auth state events.
    // Return a no-op subscription for interface compatibility.
    return { data: { subscription: { unsubscribe: () => {} } } };
  },
};

/**
 * Legacy alias — persisted avatar was a Supabase-only feature.
 * Now a no-op that resolves to null.
 */
export async function persistAvatar(): Promise<string | null> {
  return null;
}

/**
 * Legacy alias — Supabase OAuth callback handler. No-op for local auth.
 */
export async function handleCallback(): Promise<User | null> {
  return null;
}
