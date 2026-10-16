/**
 * LoginPage — local JWT username+password sign-in.
 *
 * On success, redirect honours `?returnTo=<path>` per spec §5.4 (case C2).
 * If the user is already authenticated, AppShell redirects them away (case C4).
 */

import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { useUiStore } from '../store/ui';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

export function LoginPage() {
  const theme = useUiStore(s => s.theme);

  // Sync dark class on <html> — AppShell is not mounted when unauthenticated,
  // so LoginPage must manage this itself for dark mode to work on /login.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useAuthStore(s => s.login);
  const navigate = useNavigate();
  const [params] = useSearchParams();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(username.trim(), password);
      const returnTo = params.get('returnTo') || '/chat';
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请检查网络');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-wechat-bg dark:bg-gray-950 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white dark:bg-gray-800 p-8 shadow-md dark:shadow-gray-900/50">
        {/* Logo + brand */}
        <div className="mb-6 flex flex-col items-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#07c160] to-[#10b981] shadow-lg"
            aria-hidden
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-7 w-7 text-white"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-gray-800 dark:text-gray-100">jchat</h1>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">你的 AI 联系人，触手可及</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400" htmlFor="username">用户名</label>
            <Input
              id="username"
              type="text"
              autoComplete="username"
              required
              minLength={3}
              maxLength={30}
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="your_username"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400" htmlFor="password">密码</label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-700 dark:text-red-300" role="alert">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? '登录中…' : '登录'}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-400 dark:text-gray-500">
          使用用户名+密码登录
        </p>
      </div>
    </div>
  );
}
