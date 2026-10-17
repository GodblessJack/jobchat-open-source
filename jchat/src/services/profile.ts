/**
 * profile.ts — fire-and-forget: push timezone + locale to /api/profile once
 * per browser session, immediately after the user is authenticated.
 *
 * Best-effort: any error (network failure, non-2xx, missing token) is silently
 * swallowed. A re-try will happen on the next browser session.
 */

/**
 * Push timezone + locale to /api/profile once per browser session per user.
 *
 * @param userId    The authenticated user's ID, used to scope the sessionStorage
 *                  flag so that a second user signing in the same tab still gets
 *                  their profile pushed.
 * @param getToken  Async callback that returns the Bearer token, or null if
 *                  the session is not yet available.  Must not throw.
 */
export async function pushProfileOnce(
  userId: string,
  getToken: () => Promise<string | null>,
): Promise<void> {
  const SENT_KEY = `jchat.profile.sent.${userId}`;
  if (sessionStorage.getItem(SENT_KEY) === '1') return;

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
  const lc = navigator.language || 'zh-CN';

  const token = await getToken();
  if (!token) return;

  try {
    const r = await fetch('/api/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ timezone: tz, locale: lc }),
    });
    if (r.ok) sessionStorage.setItem(SENT_KEY, '1');
  } catch {
    // best-effort; will retry next session
  }
}
