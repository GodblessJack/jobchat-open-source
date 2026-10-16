import { useEffect } from 'react';
import { useAuthStore } from '../store/auth';

/**
 * Auto-refresh the JWT every 10 minutes while the user is authenticated.
 * Mount this once at the app root (e.g. in App.tsx).
 */
export function useAuthRefresh() {
  const refreshSession = useAuthStore(s => s.refreshSession);
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(refreshSession, 10 * 60 * 1000); // every 10 min
    return () => clearInterval(interval);
  }, [isAuthenticated, refreshSession]);
}
