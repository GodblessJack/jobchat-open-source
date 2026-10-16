import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchXProfile } from '@/server/services/x-profile.js';

const sampleHtml = `
<html><head>
<meta property="og:title" content="Naval (@naval) on X">
<meta property="og:description" content="Hosts Naval Podcast. Investor.">
<meta property="og:image" content="https://pbs.twimg.com/profile_images/123/naval_400x400.jpg">
<meta name="twitter:image" content="https://pbs.twimg.com/profile_images/123/naval_400x400.jpg">
</head><body></body></html>
`;

describe('fetchXProfile', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(sampleHtml),
    } as unknown as Response);
  });
  afterEach(() => vi.restoreAllMocks());

  it('extracts handle, display_name, bio, profile_image_url', async () => {
    const r = await fetchXProfile('naval');
    expect(r).toEqual({
      handle: 'naval',
      display_name: 'Naval',
      bio: 'Hosts Naval Podcast. Investor.',
      profile_image_url: 'https://pbs.twimg.com/profile_images/123/naval_400x400.jpg',
    });
  });

  it('returns null on non-200', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as unknown as Response);
    const r = await fetchXProfile('nonexistent');
    expect(r).toBeNull();
  });

  it('returns partial on missing meta tags', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('<html></html>'),
    } as unknown as Response);
    const r = await fetchXProfile('empty');
    expect(r).toEqual({
      handle: 'empty',
      display_name: null,
      bio: null,
      profile_image_url: null,
    });
  });

  it('falls back to twitter:image when og:image missing', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(`
        <meta name="twitter:image" content="https://pbs.twimg.com/twitter-only.jpg">
      `),
    } as unknown as Response);
    const r = await fetchXProfile('twitteronly');
    expect(r?.profile_image_url).toBe('https://pbs.twimg.com/twitter-only.jpg');
  });

  it('returns null when fetch throws', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network down'));
    const r = await fetchXProfile('throwy');
    expect(r).toBeNull();
  });
});
