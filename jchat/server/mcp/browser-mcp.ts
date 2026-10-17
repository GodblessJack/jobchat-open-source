// jchat/server/mcp/browser-mcp.ts
//
// Lightweight web-search + fetch toolkit. Spec §4.3 calls for "web search /
// fetch" rather than the full Chrome-extension automation surface that
// clay/lib/browser-mcp-server.js exposes — that version drives a real
// browser via a sidecar extension and is incompatible with our headless
// server-only deployment.
//
// Tools exposed:
//   - browser_search(query, count?)      → web search via configured provider
//   - browser_fetch(url, max_chars?)     → HTTP GET with HTML→text extraction
//
// Search backend selection (auto-detect, in priority order):
//   1. TAVILY_API_KEY — Tavily Search (LLM-optimized, returns clean snippets +
//      optional `answer`; used by jchat as primary because Zhipu Web Search
//      requires a separate paid resource pack apart from the LLM credits)
//   2. ZAI_API_KEY    — Zhipu Web Search API (kept as fallback for self-hosted)
//   3. SERPAPI_KEY    — SerpAPI fallback
//   4. none           — `browser_search` returns a "no provider configured"
//      error to the caller (the LLM) so it falls back to its own knowledge.

import { promises as dnsPromises } from 'node:dns';
import { logger } from '../logger.js';

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  search(query: string, count: number): Promise<SearchHit[]>;
  name: string;
}

interface ProviderConfig {
  tavilyKey?: string;
  zaiKey?: string;
  serpKey?: string;
}

function detectProvider(cfg: ProviderConfig): SearchProvider | null {
  if (cfg.tavilyKey) return tavilyProvider(cfg.tavilyKey);
  if (cfg.zaiKey) return zhipuProvider(cfg.zaiKey);
  if (cfg.serpKey) return serpApiProvider(cfg.serpKey);
  return null;
}

function tavilyProvider(apiKey: string): SearchProvider {
  return {
    name: 'tavily',
    async search(query, count) {
      const { signal, cancel } = withTimeout(SEARCH_TIMEOUT_MS);
      try {
        const r = await fetch('https://api.tavily.com/search', {
          signal,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            query,
            max_results: Math.min(Math.max(count, 1), 10),
            search_depth: 'basic',
            include_raw_content: false,
            include_answer: false
          })
        });
        const bodyText = await r.text();
        if (!r.ok) {
          let upstream = bodyText.slice(0, 240);
          try {
            const j = JSON.parse(bodyText) as { detail?: unknown; error?: unknown };
            if (j.detail) upstream = `detail=${JSON.stringify(j.detail).slice(0, 200)}`;
            else if (j.error) upstream = `error=${JSON.stringify(j.error).slice(0, 200)}`;
          } catch { /* keep raw */ }
          throw new Error(`tavily HTTP ${r.status} — ${upstream}`);
        }
        const j = JSON.parse(bodyText) as { results?: Array<{ title?: string; url?: string; content?: string }> };
        return (j.results ?? []).slice(0, count).map((x) => ({
          title: x.title ?? '',
          url: x.url ?? '',
          snippet: (x.content ?? '').slice(0, 400)
        }));
      } finally {
        cancel();
      }
    }
  };
}

function zhipuProvider(apiKey: string): SearchProvider {
  return {
    name: 'zhipu-web-search',
    async search(query, count) {
      const { signal, cancel } = withTimeout(SEARCH_TIMEOUT_MS);
      let r: Response, bodyText: string;
      try {
        r = await fetch('https://open.bigmodel.cn/api/paas/v4/web_search', {
          signal,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            search_engine: 'search_pro',
            search_query: query,
            count
          })
        });
        bodyText = await r.text();
      } finally {
        cancel();
      }
      if (!r.ok) {
        // Surface the upstream error code+message so the LLM (and Boss) can
        // tell apart "no money" (1113) / "bad key" / "rate limit" instead of
        // seeing a generic 400 and retrying forever. Zhipu wraps real codes
        // in HTTP 400 like `{"error":{"code":"1113","message":"余额不足..."}}`.
        let upstream = bodyText.slice(0, 200);
        try {
          const j = JSON.parse(bodyText) as { error?: { code?: string; message?: string } };
          if (j.error) upstream = `code=${j.error.code} msg=${j.error.message}`;
        } catch { /* keep raw */ }
        throw new Error(`zhipu web_search HTTP ${r.status} — ${upstream}`);
      }
      const j = JSON.parse(bodyText) as { search_result?: Array<{ title?: string; link?: string; content?: string }> };
      return (j.search_result ?? []).slice(0, count).map((x) => ({
        title: x.title ?? '',
        url: x.link ?? '',
        snippet: (x.content ?? '').slice(0, 400)
      }));
    }
  };
}

function serpApiProvider(apiKey: string): SearchProvider {
  return {
    name: 'serpapi',
    async search(query, count) {
      const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&num=${count}&api_key=${apiKey}`;
      const { signal, cancel } = withTimeout(SEARCH_TIMEOUT_MS);
      let r: Response;
      try {
        r = await fetch(url, { signal });
      } finally {
        cancel();
      }
      if (!r.ok) throw new Error(`serpapi ${r.status}`);
      const j = (await r.json()) as { organic_results?: Array<{ title?: string; link?: string; snippet?: string }> };
      return (j.organic_results ?? []).slice(0, count).map((x) => ({
        title: x.title ?? '',
        url: x.link ?? '',
        snippet: (x.snippet ?? '').slice(0, 400)
      }));
    }
  };
}

// --- HTML to readable text (very small, dependency-free heuristic) ---

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// --- Tool definitions ---

// IPC-safe JSON-Schema shape (consumed by sdk-worker `buildZodShape`).
// We intentionally do NOT use Zod here because the descriptor object travels
// JSON over a Unix socket to the worker; Zod instances lose their methods
// during JSON round-trip and the worker would re-register the tool with an
// empty parameter set (model args get stripped, handler receives {}).
export const browserSearchInputSchema = {
  properties: {
    query: { type: 'string', description: 'The web search query' },
    count: { type: 'integer', description: 'Number of results 1-10, default 5' }
  },
  required: ['query']
} as const;

export const browserFetchInputSchema = {
  properties: {
    url: { type: 'string', description: 'The URL to fetch (https only)' },
    max_chars: { type: 'integer', description: 'Max characters of extracted text; default 8000' }
  },
  required: ['url']
} as const;

export interface BrowserToolDefs {
  search: {
    name: 'browser_search';
    description: string;
    inputSchema: typeof browserSearchInputSchema;
    handler: (args: { query: string; count?: number }) => Promise<{
      content: Array<{ type: 'text'; text: string }>;
      isError?: boolean;
    }>;
  };
  fetch: {
    name: 'browser_fetch';
    description: string;
    inputSchema: typeof browserFetchInputSchema;
    handler: (args: { url: string; max_chars?: number }) => Promise<{
      content: Array<{ type: 'text'; text: string }>;
      isError?: boolean;
    }>;
  };
}

const SEARCH_DESC = [
  'Search the web and return ranked results with title / URL / snippet.',
  'Use when you need fresh information beyond your training data.',
  'Returns up to 10 results.'
].join(' ');

const FETCH_DESC = [
  'Fetch a URL over HTTPS and return readable text. HTML is stripped of',
  'scripts/styles/tags. Returns up to max_chars (default 8000).'
].join(' ');

export interface BrowserMcpOpts {
  tavilyApiKey?: string;
  zaiApiKey?: string;
  serpApiKey?: string;
  /** Optional fetch override for testing. */
  httpGet?: (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
}

// All outbound HTTP from the browser tools is bounded — the model's
// tool-call timeout (60s in sdk-worker) is our last-resort backstop, but
// before that we want individual tool calls to fail fast so the model can
// move on or retry. Search APIs return in <5s; fetching one URL should
// fit in 15s for any reasonable site.
const SEARCH_TIMEOUT_MS = 10_000;
const FETCH_TIMEOUT_MS = 15_000;

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, cancel: () => clearTimeout(t) };
}

// ---------------------------------------------------------------------------
// SSRF protection: validate that a URL resolves to a public IP before fetching.
// ---------------------------------------------------------------------------

function isPrivateIp(ip: string): boolean {
  // IPv4-mapped IPv6 (::ffff:x.x.x.x) — extract the embedded IPv4 address.
  if (ip.startsWith('::ffff:')) {
    const v4 = ip.slice(7);
    if (v4.includes('.')) return isPrivateIp(v4);
    // Pure-hex format: ::ffff:7f00:1 → 127.0.0.1
    const parts = v4.split(':');
    if (parts.length === 2) {
      const hi = parseInt(parts[0], 16);
      const lo = parseInt(parts[1], 16);
      if (!isNaN(hi) && !isNaN(lo)) {
        return isPrivateIp(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
      }
    }
  }
  // IPv4-compatible IPv6 (::127.0.0.1)
  if (ip.startsWith('::') && ip.includes('.') && !ip.startsWith('::ffff:')) {
    const v4 = ip.slice(2);
    if (v4.split('.').length === 4) return isPrivateIp(v4);
  }
  // Strip zone IDs for link-local comparisons
  const clean = ip.replace(/%.*$/, '');

  // IPv4 private ranges
  const v4Parts = clean.split('.');
  if (v4Parts.length === 4 && v4Parts.every(p => /^\d+$/.test(p))) {
    const b0 = Number(v4Parts[0]), b1 = Number(v4Parts[1]);
    if (b0 === 0 || b0 === 10 || b0 === 127) return true;
    if (b0 === 169 && b1 === 254) return true;
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    if (b0 === 192 && b1 === 168) return true;
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true; // CGNAT RFC 6598
    return false;
  }

  // IPv6 private ranges
  if (clean === '::1') return true;
  if (clean.startsWith('fe80:')) return true;
  if (clean.startsWith('fc') || clean.startsWith('fd')) return true;
  return false;
}

async function validatePublicUrl(rawUrl: string): Promise<void> {
  const parsed = new URL(rawUrl);
  const hostname = parsed.hostname;
  // Allow literal public IPv4 addresses but block private ones.
  if (hostname.split('.').every(p => /^\d+$/.test(p))) {
    if (isPrivateIp(hostname)) throw new Error('Blocked: private IP address');
    return;
  }
  // Resolve DNS and check all returned addresses.
  const result = await dnsPromises.lookup(hostname, { all: true, family: 0 });
  for (const addr of result) {
    if (isPrivateIp(addr.address)) throw new Error('Blocked: resolves to private IP');
  }
}

export function getBrowserToolDefs(opts: BrowserMcpOpts = {}): BrowserToolDefs {
  const provider = detectProvider({
    tavilyKey: opts.tavilyApiKey,
    zaiKey: opts.zaiApiKey,
    serpKey: opts.serpApiKey
  });
  const httpGet =
    opts.httpGet ?? (async (url: string) => {
      const { signal, cancel } = withTimeout(FETCH_TIMEOUT_MS);
      try {
        return await fetch(url, { redirect: 'error', signal });
      } finally {
        cancel();
      }
    });

  return {
    search: {
      name: 'browser_search',
      description: SEARCH_DESC,
      inputSchema: browserSearchInputSchema,
      handler: async (args) => {
        if (!provider) {
          return {
            content: [
              {
                type: 'text',
                text:
                  'No web-search provider configured (set ZAI_API_KEY or SERPAPI_KEY). ' +
                  'Cannot search the web from this server.'
              }
            ],
            isError: true
          };
        }
        const count = Math.min(args.count ?? 5, 10);
        try {
          const hits = await provider.search(args.query, count);
          if (hits.length === 0) {
            return { content: [{ type: 'text', text: `No results for "${args.query}".` }] };
          }
          const text = hits
            .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`)
            .join('\n\n');
          return { content: [{ type: 'text', text }] };
        } catch (err) {
          logger.error({ err }, 'browser_search failed');
          return {
            content: [{ type: 'text', text: 'Search failed: ' + (err as Error).message }],
            isError: true
          };
        }
      }
    },
    fetch: {
      name: 'browser_fetch',
      description: FETCH_DESC,
      inputSchema: browserFetchInputSchema,
      handler: async (args) => {
        if (!/^https:\/\//i.test(args.url)) {
          return {
            content: [{ type: 'text', text: 'Only https:// URLs are allowed.' }],
            isError: true
          };
        }
        try { await validatePublicUrl(args.url); } catch {
          return {
            content: [{ type: 'text', text: 'Only public URLs are allowed.' }],
            isError: true
          };
        }
        const maxChars = Math.min(args.max_chars ?? 8000, 50000);
        try {
          const r = await httpGet(args.url);
          if (!r.ok) {
            return {
              content: [{ type: 'text', text: `Fetch returned HTTP ${r.status}.` }],
              isError: true
            };
          }
          const body = await r.text();
          const text = htmlToText(body).slice(0, maxChars);
          return { content: [{ type: 'text', text }] };
        } catch (err) {
          logger.error({ err, url: args.url }, 'browser_fetch failed');
          return {
            content: [{ type: 'text', text: 'Fetch failed: ' + (err as Error).message }],
            isError: true
          };
        }
      }
    }
  };
}
