// jchat/server/services/x-profile.ts
//
// Best-effort X profile fetcher: pulls handle / display_name / bio /
// profile_image_url from public profile HTML via OG and Twitter meta tags.
// No login required; uses no-cookies fetch.
//
// Used by createContact (§4.3, §4.2.3 step 2) only when the persona-distillation
// skill's DISTILL_RESULT didn't include a working avatar_hint_url. Returns null
// on any HTTP error / network failure / missing data — caller continues without
// avatar (best-effort per §7 error matrix).
//
// Spec: §4.3.1

import { logger } from '../logger.js';

export interface XProfile {
  handle: string;
  display_name: string | null;
  bio: string | null;
  profile_image_url: string | null;
}

function extractMeta(html: string, attr: 'property' | 'name', value: string): string | null {
  // <meta property="og:title" content="...">
  // <meta name="twitter:image" content="...">
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<meta\\s+(?:property|name)\\s*=\\s*"${escaped}"\\s+content\\s*=\\s*"([^"]*)"`,
    'i'
  );
  void attr;
  const m = re.exec(html);
  return m?.[1] ?? null;
}

function parseDisplayName(ogTitle: string | null): string | null {
  if (!ogTitle) return null;
  // Pattern: "Naval (@naval) on X"
  const m = /^(.+?)\s+\(@/.exec(ogTitle);
  return m?.[1] ?? ogTitle;
}

export async function fetchXProfile(handle: string): Promise<XProfile | null> {
  const url = `https://x.com/${handle}`;
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; jchat-distill/1.0)',
        'Accept': 'text/html',
      },
    });
    if (!resp.ok) {
      logger.warn({ handle, status: resp.status }, 'x-profile fetch non-200');
      return null;
    }
    const html = await resp.text();
    const ogTitle = extractMeta(html, 'property', 'og:title');
    const ogDesc = extractMeta(html, 'property', 'og:description');
    const ogImage =
      extractMeta(html, 'property', 'og:image') ?? extractMeta(html, 'name', 'twitter:image');
    return {
      handle,
      display_name: parseDisplayName(ogTitle),
      bio: ogDesc,
      profile_image_url: ogImage,
    };
  } catch (e) {
    logger.warn({ handle, err: (e as Error).message }, 'x-profile fetch threw');
    return null;
  }
}
