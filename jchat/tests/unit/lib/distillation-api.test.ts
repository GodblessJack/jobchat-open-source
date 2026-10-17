import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getQuota,
  startRun,
  getRunStatus,
  validateXProfileUrl,
} from '../../../src/lib/distillation-api';

describe('validateXProfileUrl', () => {
  it.each([
    ['https://x.com/naval', true],
    ['https://www.x.com/naval', true],
    ['https://twitter.com/naval', true],
    ['https://x.com/Naval_R_', true],
    ['https://x.com/naval?some=query', true],
    ['https://x.com/naval/status/123', false],
    ['https://x.com/i/lists/123', false],
    ['https://x.com/home', false],
    ['https://x.com/', false],
    ['https://example.com/naval', false],
    ['not-a-url', false],
    ['', false],
  ])('%s → %s', (url, expected) => {
    expect(validateXProfileUrl(url)).toBe(expected);
  });
});

describe('distillation-api fetch helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('getQuota calls /api/distillation/quota with Bearer header', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ used: 1, limit: 3, remaining: 2, reset_at: 'x' }),
    });
    const r = await getQuota('jwt-tok');
    expect(fetch).toHaveBeenCalledWith(
      '/api/distillation/quota',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer jwt-tok' }) })
    );
    expect(r.remaining).toBe(2);
  });

  it('startRun POSTs with the x_url body', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      status: 202,
      json: () => Promise.resolve({ run_id: 'rid-1' }),
    });
    const r = await startRun('jwt-tok', 'https://x.com/naval');
    expect(fetch).toHaveBeenCalledWith(
      '/api/distillation/run',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ x_url: 'https://x.com/naval' }),
      })
    );
    expect(r).toEqual({ ok: true, runId: 'rid-1' });
  });

  it('startRun maps 400 errors to typed error result', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'quota_exhausted', message: '今日次数已用完' }),
    });
    const r = await startRun('jwt-tok', 'https://x.com/naval');
    expect(r).toEqual({ ok: false, code: 'quota_exhausted', message: '今日次数已用完' });
  });

  it('getRunStatus polls the GET endpoint', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'running', started_at: 'x' }),
    });
    const r = await getRunStatus('jwt-tok', 'rid-1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/distillation/run/rid-1',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer jwt-tok' }) })
    );
    expect(r.status).toBe('running');
  });
});
