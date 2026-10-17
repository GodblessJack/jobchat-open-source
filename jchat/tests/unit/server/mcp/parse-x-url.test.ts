import { describe, it, expect } from 'vitest';
import { parseXUrl } from '@/server/mcp/parse-x-url-mcp.js';

describe('parseXUrl', () => {
  describe('x_profile', () => {
    it.each([
      'https://x.com/naval',
      'https://twitter.com/naval',
      'https://x.com/naval/',
      'https://www.x.com/naval',
      'https://mobile.twitter.com/naval',
      'http://x.com/naval',
    ])('parses profile: %s', (url) => {
      const r = parseXUrl(url);
      expect(r.kind).toBe('x_profile');
      if (r.kind === 'x_profile') {
        expect(r.handle).toBe('naval');
        expect(r.canonical_url).toBe('https://x.com/naval');
      }
    });
  });

  describe('x_tweet', () => {
    it.each([
      ['https://x.com/elonmusk/status/1234567890', 'elonmusk', '1234567890'],
      ['https://twitter.com/elonmusk/status/1234567890', 'elonmusk', '1234567890'],
      ['https://x.com/elonmusk/status/1234567890?s=20', 'elonmusk', '1234567890'],
    ])('parses tweet: %s', (url, handle, tweet_id) => {
      const r = parseXUrl(url);
      expect(r.kind).toBe('x_tweet');
      if (r.kind === 'x_tweet') {
        expect(r.handle).toBe(handle);
        expect(r.tweet_id).toBe(tweet_id);
        expect(r.canonical_url).toBe(`https://x.com/${handle}/status/${tweet_id}`);
      }
    });
  });

  describe('unsupported (typed reasons)', () => {
    it.each([
      ['https://x.com/naval/with_replies', 'thread'],
      ['https://x.com/i/lists/123', 'list'],
      ['https://x.com/search?q=naval', 'search'],
      ['https://x.com/naval/media', 'media'],
      ['https://x.com/naval/photo/1', 'media'],
      ['https://x.com/naval/video/1', 'media'],
      ['https://x.com/i/web/status/123', 'malformed'],
      ['https://x.com/intent/tweet', 'malformed'],
      ['https://x.com/hashtag/naval', 'malformed'],
    ])('rejects %s as %s', (url, reason) => {
      const r = parseXUrl(url);
      expect(r.kind).toBe('unsupported');
      if (r.kind === 'unsupported') expect(r.reason).toBe(reason);
    });

    it.each([
      'https://example.com/naval',
      'https://facebook.com/naval',
      'https://t.me/naval',
    ])('rejects non-X URL: %s', (url) => {
      const r = parseXUrl(url);
      expect(r.kind).toBe('unsupported');
      if (r.kind === 'unsupported') expect(r.reason).toBe('not_x');
    });

    it.each([
      'not a url',
      'http:///naval',
      'https://x.com/',
      'https://x.com',
      'https://x.com/' + 'a'.repeat(50),
      'https://x.com/中文用户',
      'https://x.com/foo bar',
      'https://x.com/../etc/passwd',
      'ftp://x.com/naval',
      'javascript:alert(1)',
    ])('rejects malformed: %s', (url) => {
      const r = parseXUrl(url);
      expect(r.kind).toBe('unsupported');
      if (r.kind === 'unsupported') {
        expect(['malformed', 'not_x']).toContain(r.reason);
      }
    });
  });
});
