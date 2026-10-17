// jchat/src/lib/distillation-api.ts
//
// Browser-side helpers for the distillation wizard. Mirrors the
// server contracts in shared/distillation-types.ts.
//
// Plan: Task 9

import type {
  QuotaResponse,
  RunStatusResponse,
  StartRunErrorCode,
} from '@shared/distillation-types';

const X_PROFILE_RE = /^https?:\/\/(www\.)?(twitter|x)\.com\/([A-Za-z0-9_]{1,15})\/?(\?.*)?$/i;
const RESERVED = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings']);

export function validateXProfileUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  const m = X_PROFILE_RE.exec(trimmed);
  if (!m) return false;
  const handle = m[3]!.toLowerCase();
  if (RESERVED.has(handle)) return false;
  if (trimmed.includes('/status/')) return false;
  if (trimmed.includes('/i/')) return false;
  return true;
}

export async function getQuota(jwt: string): Promise<QuotaResponse> {
  const res = await fetch('/api/distillation/quota', {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error(`quota ${res.status}`);
  return res.json();
}

export type StartRunResult =
  | { ok: true; runId: string }
  | { ok: false; code: StartRunErrorCode | 'network'; message: string };

export async function startRun(jwt: string, xUrl: string): Promise<StartRunResult> {
  try {
    const res = await fetch('/api/distillation/run', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ x_url: xUrl }),
    });
    if (res.status === 202) {
      const body = await res.json();
      return { ok: true, runId: body.run_id };
    }
    if (res.status === 400) {
      const body = await res.json();
      return { ok: false, code: body.error, message: body.message ?? '' };
    }
    return { ok: false, code: 'network', message: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, code: 'network', message: (e as Error).message };
  }
}

export async function getRunStatus(jwt: string, runId: string): Promise<RunStatusResponse> {
  const res = await fetch(`/api/distillation/run/${runId}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (res.status === 404) {
    // The run-registry is process-memory; a server restart clears it.
    // Surface as a terminal error so the wizard doesn't poll forever.
    return {
      status: 'error',
      code: 'run_lost',
      message: '服务器重启了，蒸馏中断。刷新一下看看 ta 是不是已经在联系人里。',
    };
  }
  if (res.status === 403) {
    return { status: 'error', code: 'not_owner', message: '这个蒸馏不属于你。' };
  }
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}
