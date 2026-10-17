import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDb, mockSelect } from '../../../mock-db.js';

vi.mock('../../../../server/lib/db.js', () => ({ db: mockDb }));

import { getDistillationQuota } from '../../../../server/services/quota.js';

describe('getDistillationQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select = mockSelect([]);
  });

  it('returns used=0, allowed=true when no row for today', async () => {
    mockDb.select = mockSelect([]);
    const r = await getDistillationQuota('uid-1');
    expect(r).toMatchObject({ used: 0, limit: 3, allowed: true });
    expect(r.reset_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns used=2, allowed=true when count is 2', async () => {
    mockDb.select = mockSelect([{ count: 2 }]);
    const r = await getDistillationQuota('uid-2');
    expect(r).toMatchObject({ used: 2, limit: 3, allowed: true });
  });

  it('returns used=3, allowed=false when at limit', async () => {
    mockDb.select = mockSelect([{ count: 3 }]);
    const r = await getDistillationQuota('uid-3');
    expect(r).toMatchObject({ used: 3, limit: 3, allowed: false });
  });

  it('falls back to used=0 on supabase error', async () => {
    mockDb.select = mockSelect([]);
    const r = await getDistillationQuota('uid-4');
    expect(r.used).toBe(0);
    expect(r.allowed).toBe(true);
  });

  it('reset_at parses as a future ISO timestamp', async () => {
    mockDb.select = mockSelect([{ count: 1 }]);
    const r = await getDistillationQuota('uid-5');
    const resetMs = Date.parse(r.reset_at);
    expect(resetMs).toBeGreaterThan(Date.now());
  });
});
