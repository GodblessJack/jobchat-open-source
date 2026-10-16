import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockDb, mockExecute, mockUpdate } from '../../../mock-db.js';

vi.mock('../../../../server/lib/db.js', () => ({ db: mockDb }));

import { createContact, type CreateContactInput } from '../../../../server/services/create-contact.js';

const validInput: CreateContactInput = {
  name: 'Naval',
  slug: 'naval',
  skill_md: '---\nname: naval\n---\n# Identity\n' + 'x'.repeat(150),
  persona_summary: 'I am Naval. ' + 'x'.repeat(220),
  initial_message: 'Hello, I am Naval.',
  source_type: 'x_profile',
  source_url: 'https://x.com/naval',
  x_handle: 'naval',
};

describe('createContact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.execute = mockExecute({ rows: [] });
    mockDb.update = mockUpdate();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    } as unknown as Response);
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns agent_id and slug_resolved on success without avatar', async () => {
    mockDb.execute = mockExecute({
      rows: [{ agent_id: 'a-uuid', slug_resolved: 'naval' }]
    });

    const r = await createContact('user-1', validInput);
    expect(r).toEqual({
      agent_id: 'a-uuid',
      slug_resolved: 'naval',
      avatar_url: null,
      name: 'Naval',
    });
  });

  it('uploads avatar when avatar_hint_url provided, returns file path', async () => {
    mockDb.execute = mockExecute({
      rows: [{ agent_id: 'a-uuid', slug_resolved: 'naval' }]
    });

    const r = await createContact('user-1', {
      ...validInput,
      avatar_hint_url: 'https://pbs.twimg.com/avatar.jpg',
    });
    expect(r.avatar_url).toBe('/files/avatars/user-1/naval.jpg');
    expect(r.agent_id).toBe('a-uuid');
  });

  it('returns avatar_url=null when avatar download fails (best-effort)', async () => {
    mockDb.execute = mockExecute({
      rows: [{ agent_id: 'a-uuid', slug_resolved: 'naval' }]
    });
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
    } as unknown as Response);

    const r = await createContact('user-1', {
      ...validInput,
      avatar_hint_url: 'https://blocked.example.com/avatar.jpg',
    });
    expect(r.avatar_url).toBeNull();
    expect(r.agent_id).toBe('a-uuid');  // contact was still created
  });

  it('throws with code=P0001 when stored function raises QUOTA_EXCEEDED', async () => {
    const err = new Error('QUOTA_EXCEEDED') as Error & { code?: string };
    err.code = 'P0001';
    mockDb.execute = vi.fn(() => { throw err; });

    await expect(createContact('user-1', validInput)).rejects.toMatchObject({
      code: 'P0001',
      message: 'QUOTA_EXCEEDED',
    });
  });

  it('calls broadcast callback after successful create', async () => {
    mockDb.execute = mockExecute({
      rows: [{ agent_id: 'a-uuid', slug_resolved: 'naval' }]
    });
    const broadcast = vi.fn();

    await createContact('user-1', validInput, broadcast);
    expect(broadcast).toHaveBeenCalledWith('user-1', 'contacts');
  });

  it('does not throw if broadcast callback throws', async () => {
    mockDb.execute = mockExecute({
      rows: [{ agent_id: 'a-uuid', slug_resolved: 'naval' }]
    });
    const broadcast = vi.fn(() => { throw new Error('broadcast failed'); });

    const r = await createContact('user-1', validInput, broadcast);
    expect(r.agent_id).toBe('a-uuid');
  });
});
