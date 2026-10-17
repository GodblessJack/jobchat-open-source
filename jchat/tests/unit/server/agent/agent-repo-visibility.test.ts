// jchat/tests/unit/server/agent/agent-repo-visibility.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDb, mockSelect } from '../../../mock-db.js';

vi.mock('../../../../server/lib/db.js', () => ({ db: mockDb }));

import { assertAgentVisibleToUser } from '../../../../server/agent/agent-repo.js';
import { JchatError, ErrorCodes } from '../../../../shared/errors.js';

describe('assertAgentVisibleToUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select = mockSelect([]);
  });

  it('passes for shared agent (owner_user_id null)', async () => {
    mockDb.select = mockSelect([{ ownerUserId: null }]);
    await expect(assertAgentVisibleToUser('user-1', 'agent-shared')).resolves.toBeUndefined();
  });

  it('passes for own private agent', async () => {
    mockDb.select = mockSelect([{ ownerUserId: 'user-1' }]);
    await expect(assertAgentVisibleToUser('user-1', 'agent-mine')).resolves.toBeUndefined();
  });

  it('throws NOT_FOUND for someone else private agent (no existence leak)', async () => {
    mockDb.select = mockSelect([{ ownerUserId: 'user-2' }]);
    await expect(assertAgentVisibleToUser('user-1', 'agent-other')).rejects.toMatchObject({
      name: 'JchatError',
      code: ErrorCodes.NOT_FOUND
    });
  });

  it('throws NOT_FOUND when agent does not exist', async () => {
    mockDb.select = mockSelect([]);
    await expect(assertAgentVisibleToUser('user-1', 'agent-missing')).rejects.toBeInstanceOf(JchatError);
  });
});
