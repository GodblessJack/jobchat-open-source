// jchat/server/mcp/parse-x-url-mcp.ts
//
// Pure-regex X (Twitter) URL parser. No network IO. Used by Jack to gate
// distillation requests: only x_profile and x_tweet are accepted; thread,
// list, search, media, transparently-non-X URLs are rejected with a typed
// reason so Jack can produce a friendly explanation.
//
// Spec: §4.2.1



export type ParseResult =
  | { kind: 'x_profile';   handle: string; canonical_url: string }
  | { kind: 'x_tweet';     handle: string; tweet_id: string; canonical_url: string }
  | { kind: 'unsupported'; reason: 'thread' | 'list' | 'search' | 'media' | 'malformed' | 'not_x' };

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const TWEET_ID_RE = /^\d{1,20}$/;
const RESERVED_PATHS = new Set([
  'i', 'intent', 'hashtag', 'search', 'home', 'explore',
  'notifications', 'messages', 'compose', 'logout', 'login', 'signup',
]);

export function parseXUrl(input: string): ParseResult {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { kind: 'unsupported', reason: 'malformed' };
  }
  if (!/^https?:$/.test(url.protocol)) {
    return { kind: 'unsupported', reason: 'malformed' };
  }
  // Normalize host: strip www./mobile., accept twitter.com → x.com
  const host = url.hostname.replace(/^(www|mobile)\./, '').toLowerCase();
  if (host !== 'x.com' && host !== 'twitter.com') {
    return { kind: 'unsupported', reason: 'not_x' };
  }
  // Path: trim leading/trailing slash, split
  const segments = url.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (segments.length === 0) {
    return { kind: 'unsupported', reason: 'malformed' };
  }
  const first = segments[0]!;
  if (RESERVED_PATHS.has(first)) {
    if (first === 'search') return { kind: 'unsupported', reason: 'search' };
    if (first === 'i' && segments[1] === 'lists') return { kind: 'unsupported', reason: 'list' };
    return { kind: 'unsupported', reason: 'malformed' };
  }
  if (!HANDLE_RE.test(first)) {
    return { kind: 'unsupported', reason: 'malformed' };
  }
  const handle = first;

  // Profile (just handle)
  if (segments.length === 1) {
    return { kind: 'x_profile', handle, canonical_url: `https://x.com/${handle}` };
  }
  const second = segments[1]!;
  // Tweet
  if (second === 'status' && segments.length >= 3 && TWEET_ID_RE.test(segments[2]!)) {
    return {
      kind: 'x_tweet',
      handle,
      tweet_id: segments[2]!,
      canonical_url: `https://x.com/${handle}/status/${segments[2]}`,
    };
  }
  // Thread / replies
  if (second === 'with_replies') return { kind: 'unsupported', reason: 'thread' };
  // Media
  if (second === 'media' || second === 'photo' || second === 'video') {
    return { kind: 'unsupported', reason: 'media' };
  }
  return { kind: 'unsupported', reason: 'malformed' };
}

// ---------- MCP tool def ----------

export const parseXUrlInputSchema = {
  properties: {
    url: { type: 'string', description: 'X (Twitter) URL to classify' },
  },
  required: ['url'],
};

export const PARSE_X_URL_DESCRIPTION =
  'Parse an X (Twitter) URL and identify whether it is a public profile (x_profile), a single tweet (x_tweet), or unsupported (thread/list/search/media/malformed/not_x). Pure offline parsing — no network call.';

export interface ParseXUrlToolDef {
  name: 'parse_x_url';
  description: string;
  inputSchema: typeof parseXUrlInputSchema;
  handler: (args: { url: string }) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
}

export function getParseXUrlToolDef(): ParseXUrlToolDef {
  return {
    name: 'parse_x_url',
    description: PARSE_X_URL_DESCRIPTION,
    inputSchema: parseXUrlInputSchema,
    handler: async ({ url }) => {
      const r = parseXUrl(url);
      return { content: [{ type: 'text', text: JSON.stringify(r) }] };
    },
  };
}
