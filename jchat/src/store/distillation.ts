// jchat/src/store/distillation.ts
//
// Wizard state. Single-flight: only one distillation can be in flight at a
// time per browser tab. Server enforces the same per-user constraint
// via the run-registry.
//
// Plan: Task 10

import { create } from 'zustand';
import {
  getQuota,
  startRun,
  getRunStatus,
  validateXProfileUrl,
} from '../lib/distillation-api';
import type { QuotaResponse, StartRunErrorCode } from '@shared/distillation-types';
import { useAuthStore } from './auth';

export type WizardStatus = 'idle' | 'input' | 'loading' | 'success' | 'error';

export interface DistillationResult {
  agentId: string;
  name: string;
  avatarUrl: string | null;
  slug: string;
}

export interface DistillationError {
  code: StartRunErrorCode | 'invalid_x_url' | 'client_timeout' | 'NO_CONTACT_CREATED' | 'SDK_ERROR' | 'network' | 'unknown';
  message: string;
}

interface State {
  open: boolean;
  status: WizardStatus;
  xUrl: string;
  runId: string | null;
  quota: QuotaResponse | null;
  result: DistillationResult | null;
  error: DistillationError | null;

  openWizard: () => Promise<void>;
  closeWizard: () => void;
  setXUrl: (v: string) => void;
  submit: () => Promise<void>;
  reset: () => void;
}

const POLL_INTERVAL_MS = 3000;
// Has to outlive the server-side SDK watchdog (25min in launcher.ts).
// Phase 1 (6-agent parallel research) + Phase 2 synthesis dominates
// the wall time; v2 will trim Phase 1.
const CLIENT_TIMEOUT_MS = 26 * 60 * 1000;

async function getJwt(): Promise<string> {
  // getJwt() is synchronous in production (returns string | null),
  // but the test mock returns a Promise — await handles both.
  const tok = await useAuthStore.getState().getJwt();
  if (!tok) throw new Error('no jwt');
  return tok as string;
}

const initialState = {
  open: false,
  status: 'idle' as WizardStatus,
  xUrl: '',
  runId: null,
  quota: null,
  result: null,
  error: null,
};

export const useDistillationStore = create<State>((set, get) => ({
  ...initialState,

  openWizard: async () => {
    set({ open: true, status: 'input', error: null, result: null, runId: null, xUrl: '' });
    try {
      const jwt = await getJwt();
      const q = await getQuota(jwt);
      set({ quota: q });
    } catch {
      // Quota fetch failure is non-fatal — Step 1 still renders, button
      // gets enabled, server-side check catches the real state.
    }
  },

  closeWizard: () => set({ ...initialState }),

  setXUrl: (v) => set({ xUrl: v }),

  submit: async () => {
    if (get().status === 'loading') return;
    const { xUrl } = get();
    if (!validateXProfileUrl(xUrl)) {
      set({ status: 'error', error: { code: 'invalid_x_url', message: '这看起来不是 X 主页 URL' } });
      return;
    }
    set({ status: 'loading', error: null, runId: null, result: null });

    let jwt: string;
    try {
      jwt = await getJwt();
    } catch {
      set({ status: 'error', error: { code: 'network', message: '请重新登录' } });
      return;
    }

    const res = await startRun(jwt, xUrl);
    if (!res.ok) {
      set({ status: 'error', error: { code: res.code as DistillationError['code'], message: res.message } });
      return;
    }
    set({ runId: res.runId });

    const started = Date.now();
    const myRunId = res.runId;
    const tick = async (): Promise<void> => {
      // Bail if the user has closed the wizard or started a new run.
      // Otherwise a late tick from a previous distillation could clobber
      // the new wizard state.
      if (get().runId !== myRunId) return;

      if (Date.now() - started > CLIENT_TIMEOUT_MS) {
        set({
          status: 'error',
          error: { code: 'client_timeout', message: '等太久了，刷新页面看看 ta 是不是已经在你的联系人里。' },
        });
        return;
      }
      let status;
      try {
        status = await getRunStatus(jwt, myRunId);
      } catch {
        setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }
      if (get().runId !== myRunId) return;
      if (status.status === 'running') {
        setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }
      if (status.status === 'done') {
        set({
          status: 'success',
          result: {
            agentId: status.agent_id,
            name: status.name,
            avatarUrl: status.avatar_url,
            slug: status.slug,
          },
        });
        return;
      }
      set({
        status: 'error',
        error: { code: status.code as DistillationError['code'], message: status.message },
      });
    };
    setTimeout(tick, POLL_INTERVAL_MS);
  },

  reset: () => set({ status: 'input', error: null, result: null, runId: null }),
}));

// Expose initial state for test resets.
(useDistillationStore as any).getInitialState = () => initialState;
