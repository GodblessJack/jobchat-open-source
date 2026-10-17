import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDb, mockSelect, mockUpdate } from '../../mock-db.js';

vi.mock('../../../server/lib/db.js', () => ({ db: mockDb }));

import { sweepStuckSessions } from '../../../server/call/sweeper.js';

describe('sweepStuckSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select = mockSelect([]);
    mockDb.update = mockUpdate();
  });

  it('marks ongoing sessions older than 2h as error', async () => {
    mockDb.select = mockSelect([{ id: 's1' }, { id: 's2' }]);
    const updateSpy = mockUpdate();
    mockDb.update = updateSpy;

    const n = await sweepStuckSessions(2 * 60 * 60 * 1000);
    expect(n).toBe(2);
    // update should have been called with the error status
    expect(updateSpy).toHaveBeenCalled();
  });

  it('returns 0 when no stuck rows', async () => {
    mockDb.select = mockSelect([]);
    const n = await sweepStuckSessions(2 * 60 * 60 * 1000);
    expect(n).toBe(0);
  });
});
