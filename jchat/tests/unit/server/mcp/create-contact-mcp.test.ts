import { describe, it, expect, vi } from 'vitest';
import { getCreateContactToolDef } from '@/server/mcp/create-contact-mcp.js';
import type { CreateContactInput, CreateContactResult } from '@/server/services/create-contact.js';

const validArgs: CreateContactInput = {
  name: 'Naval',
  slug: 'naval',
  skill_md: '---\nname: naval\n---\n# Identity\n' + 'x'.repeat(150),
  persona_summary: 'I am Naval. ' + 'x'.repeat(220),
  initial_message: 'Hello, I am Naval.',
  source_type: 'x_profile',
  source_url: 'https://x.com/naval',
  x_handle: 'naval',
};

describe('create_contact MCP tool', () => {
  it('returns JSON result on success', async () => {
    const result: CreateContactResult = {
      agent_id: 'a-uuid',
      slug_resolved: 'naval',
      avatar_url: null,
      name: 'Naval',
    };
    const tool = getCreateContactToolDef({ createContact: vi.fn().mockResolvedValue(result) });

    const r = await tool.handler(validArgs);
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0]!.text)).toEqual(result);
  });

  it('maps QUOTA_EXCEEDED to friendly Chinese message + isError=true', async () => {
    const err = new Error('QUOTA_EXCEEDED') as Error & { code: string };
    err.code = 'P0001';
    const tool = getCreateContactToolDef({ createContact: vi.fn().mockRejectedValue(err) });

    const r = await tool.handler(validArgs);
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('额度');
    expect(r.content[0]!.text).toContain('明天');
  });

  it('maps SLUG_EXHAUSTED to friendly message', async () => {
    const err = new Error('SLUG_EXHAUSTED') as Error & { code: string };
    err.code = 'P0001';
    const tool = getCreateContactToolDef({ createContact: vi.fn().mockRejectedValue(err) });
    const r = await tool.handler(validArgs);
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('冲突');
  });

  it('rethrows unknown errors (not P0001)', async () => {
    const err = new Error('PGRST socket closed') as Error & { code: string };
    err.code = 'NETWORK';
    const tool = getCreateContactToolDef({ createContact: vi.fn().mockRejectedValue(err) });

    await expect(tool.handler(validArgs)).rejects.toThrow('PGRST socket closed');
  });

  it('rethrows P0001 with unknown message', async () => {
    const err = new Error('SOMETHING_NEW') as Error & { code: string };
    err.code = 'P0001';
    const tool = getCreateContactToolDef({ createContact: vi.fn().mockRejectedValue(err) });

    await expect(tool.handler(validArgs)).rejects.toThrow('SOMETHING_NEW');
  });
});
