// jchat/tests/unit/server/agent/embed-provider.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createEmbedProvider } from '@/server/agent/embed-provider.js';

describe('embed-provider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stub mode returns 1536-dim zero vector', async () => {
    const p = createEmbedProvider({ provider: 'stub-zero-vector', model: 'n/a' });
    const v = await p.embed('hello');
    expect(v).toHaveLength(1536);
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it('falls back to stub when provider=openai but apiKey missing', async () => {
    const p = createEmbedProvider({ provider: 'openai', model: 'text-embedding-3-small' });
    const v = await p.embed('hello');
    expect(v).toHaveLength(1536);
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it('openai mode posts to /v1/embeddings (mocked)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: new Array(1536).fill(0.1) }] })
    });
    vi.stubGlobal('fetch', fetchMock);
    const p = createEmbedProvider({
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test'
    });
    const v = await p.embed('hello');
    expect(v).toHaveLength(1536);
    expect(v[0]).toBeCloseTo(0.1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/v1/embeddings');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ model: 'text-embedding-3-small', input: 'hello' });
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test');
  });

  it('openai mode uses custom baseUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: new Array(1536).fill(0) }] })
    });
    vi.stubGlobal('fetch', fetchMock);
    const p = createEmbedProvider({
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
      baseUrl: 'https://example.test'
    });
    await p.embed('x');
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://example.test/v1/embeddings');
  });

  it('openai mode throws on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    );
    const p = createEmbedProvider({
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test'
    });
    await expect(p.embed('x')).rejects.toThrow(/embedding api 500/);
  });
});
