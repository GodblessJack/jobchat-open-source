// meeting/src/components/AuthContext.tsx

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
}

interface AuthContextType {
  user: User | null;
  jwt: string | null;
  isAuthenticated: boolean;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function fromApiUser(u: any): User {
  return {
    id: u.id,
    name: u.displayName ?? u.username ?? '我',
    email: u.email ?? '',
    avatar: '',
  };
}

async function apiPost(path: string): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
}

async function apiGet(path: string, token: string): Promise<Response> {
  return fetch(path, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [jwt, setJwt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // Step 1: Try cookie-based refresh
        const refreshRes = await apiPost('/api/auth/refresh');
        if (!refreshRes.ok) {
          setLoading(false);
          return;
        }

        const refreshData = await refreshRes.json();
        const token: string | undefined = refreshData.accessToken;
        if (!token) {
          setLoading(false);
          return;
        }

        // Step 2: Fetch user info
        const meRes = await apiGet('/api/auth/me', token);
        if (!meRes.ok) {
          setLoading(false);
          return;
        }

        const meData = await meRes.json();
        if (meData.user) {
          setUser(fromApiUser(meData.user));
          setJwt(token);
        }
      } catch {
        // Not authenticated — leave default state
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <AuthContext.Provider value={{ user, jwt, isAuthenticated: !!user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
