/**
 * useSignedUrl / useSignedUrls
 *
 * Resolve file URLs to serving paths. With local filesystem storage,
 * files are served directly via /files/ paths — no signed URLs needed.
 *
 * supabase://<path> URLs (legacy) are converted to /files/<path>.
 * Plain HTTP(S) and /files/ URLs pass through.
 */
const SUPABASE_PREFIX = 'supabase://';

export function isSupabasePath(url: unknown): boolean {
  return typeof url === 'string' && url.startsWith(SUPABASE_PREFIX);
}

function resolveUrl(inputUrl: string): string {
  if (!isSupabasePath(inputUrl)) {
    // Block known-broken legacy Supabase staging URLs from ever loading
    if (/jobchat\.zhipin\.cn\/buster-stage\/supabase\/storage/.test(inputUrl)) {
      return '';
    }
    return inputUrl;
  }
  // Strip supabase:// prefix, remove bucket segment, prepend /files/
  // Old format: supabase://chat-files/jchat/<userId>/...
  // New format: /files/<userId>/...
  const path = inputUrl.slice(SUPABASE_PREFIX.length);
  // If path starts with a known bucket name, skip it
  const knownBuckets = ['skill-assets', 'chat-files', 'avatars'];
  const firstSlash = path.indexOf('/');
  const firstSegment = firstSlash === -1 ? path : path.slice(0, firstSlash);
  const restPath = firstSlash === -1 ? '' : path.slice(firstSlash + 1);
  if (knownBuckets.includes(firstSegment)) {
    return `/files/${restPath}`;
  }
  return `/files/${path}`;
}

interface SignedUrlResult {
  url: string | null;
  loading: boolean;
  error: string | null;
}

export function useSignedUrl(inputUrl: string | null | undefined): SignedUrlResult {
  const resolved = inputUrl ? resolveUrl(inputUrl) : null;
  return { url: resolved, loading: false, error: null };
}

interface SignedUrlsResult {
  urls: string[];
  loading: boolean;
  error: string | null;
}

export function useSignedUrls(inputUrls: string[]): SignedUrlsResult {
  const urls = inputUrls.map(resolveUrl);
  return { urls, loading: false, error: null };
}
