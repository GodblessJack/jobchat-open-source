// jchat/tests/unit/server/distillation-mcp-hook.test.ts
import { describe, it, expect, vi } from 'vitest';
import { getCreateContactToolDef } from '../../../server/mcp/create-contact-mcp.js';

describe('create_contact MCP tool — onContactCreated hook', () => {
  it('invokes onContactCreated with the successful result', async () => {
    const hook = vi.fn();
    const fakeCreate = vi.fn().mockResolvedValue({
      agent_id: 'a-123',
      slug_resolved: 'naval',
      avatar_url: 'http://x.test/naval.png',
      name: 'Naval Ravikant',
    });
    const tool = getCreateContactToolDef({
      createContact: fakeCreate,
      onContactCreated: hook,
    });
    const result = await tool.handler({
      name: 'Naval Ravikant',
      slug: 'naval',
      skill_md: 'x'.repeat(150),
      persona_summary: 'y'.repeat(300),
      initial_message: 'hi there friend',
      source_type: 'x_profile',
      source_url: 'https://x.com/naval',
      x_handle: 'naval',
    });
    expect(result.isError).toBeFalsy();
    expect(hook).toHaveBeenCalledWith({
      agent_id: 'a-123',
      slug_resolved: 'naval',
      avatar_url: 'http://x.test/naval.png',
      name: 'Naval Ravikant',
    });
  });

  it('does NOT invoke onContactCreated on error', async () => {
    const hook = vi.fn();
    const err = Object.assign(new Error('QUOTA_EXCEEDED'), { code: 'P0001' });
    const fakeCreate = vi.fn().mockRejectedValue(err);
    const tool = getCreateContactToolDef({
      createContact: fakeCreate,
      onContactCreated: hook,
    });
    const result = await tool.handler({
      name: 'Naval',
      slug: 'naval',
      skill_md: 'x'.repeat(150),
      persona_summary: 'y'.repeat(300),
      initial_message: 'hi there friend',
      source_type: 'x_profile',
      source_url: 'https://x.com/naval',
      x_handle: 'naval',
    });
    expect(result.isError).toBe(true);
    expect(hook).not.toHaveBeenCalled();
  });

  it('omitting onContactCreated is allowed (backward-compat)', async () => {
    const fakeCreate = vi.fn().mockResolvedValue({
      agent_id: 'a-123',
      slug_resolved: 'naval',
      avatar_url: null,
      name: 'Naval',
    });
    const tool = getCreateContactToolDef({ createContact: fakeCreate });
    const result = await tool.handler({
      name: 'Naval',
      slug: 'naval',
      skill_md: 'x'.repeat(150),
      persona_summary: 'y'.repeat(300),
      initial_message: 'hi there friend',
      source_type: 'x_profile',
      source_url: 'https://x.com/naval',
      x_handle: 'naval',
    });
    expect(result.isError).toBeFalsy();
  });
});
