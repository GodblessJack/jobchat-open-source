import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/lib/distillation-api', () => ({
  getQuota: vi.fn(),
  startRun: vi.fn(),
  getRunStatus: vi.fn(),
  validateXProfileUrl: vi.fn(),
}));
vi.mock('../../../src/store/auth', () => ({
  useAuthStore: { getState: () => ({ getJwt: () => Promise.resolve('jwt-tok') }) },
}));

import {
  getQuota,
  startRun,
  getRunStatus,
  validateXProfileUrl,
} from '../../../src/lib/distillation-api';
import { useDistillationStore } from '../../../src/store/distillation';

describe('distillationStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDistillationStore.setState(useDistillationStore.getInitialState());
  });

  it('openWizard fetches quota and switches to input', async () => {
    (getQuota as any).mockResolvedValue({ used: 1, limit: 3, remaining: 2, reset_at: 'x' });
    await useDistillationStore.getState().openWizard();
    const s = useDistillationStore.getState();
    expect(s.open).toBe(true);
    expect(s.status).toBe('input');
    expect(s.quota?.remaining).toBe(2);
  });

  it('submit with invalid URL never calls startRun', async () => {
    (validateXProfileUrl as any).mockReturnValue(false);
    useDistillationStore.setState({ xUrl: 'bad' });
    await useDistillationStore.getState().submit();
    expect(startRun).not.toHaveBeenCalled();
    expect(useDistillationStore.getState().error?.code).toBe('invalid_x_url');
  });

  it('submit transitions to loading then success on done', async () => {
    (validateXProfileUrl as any).mockReturnValue(true);
    (startRun as any).mockResolvedValue({ ok: true, runId: 'rid-1' });
    (getRunStatus as any)
      .mockResolvedValueOnce({ status: 'running', started_at: 'x' })
      .mockResolvedValueOnce({
        status: 'done',
        agent_id: 'a1',
        name: 'Naval',
        avatar_url: 'http://x/a.png',
        slug: 'naval',
      });

    useDistillationStore.setState({ xUrl: 'https://x.com/naval' });
    const promise = useDistillationStore.getState().submit();
    // First tick — status should be loading.
    await Promise.resolve();
    expect(useDistillationStore.getState().status).toBe('loading');

    await promise;
    // Drain the polling loop until status is success.
    await new Promise((r) => setTimeout(r, 7000));
    const s = useDistillationStore.getState();
    expect(s.status).toBe('success');
    expect(s.result?.name).toBe('Naval');
  }, 15_000);

  it('submit maps server error code into store.error', async () => {
    (validateXProfileUrl as any).mockReturnValue(true);
    (startRun as any).mockResolvedValue({ ok: false, code: 'quota_exhausted', message: '没了' });
    useDistillationStore.setState({ xUrl: 'https://x.com/naval' });
    await useDistillationStore.getState().submit();
    const s = useDistillationStore.getState();
    expect(s.status).toBe('error');
    expect(s.error?.code).toBe('quota_exhausted');
  });
});
