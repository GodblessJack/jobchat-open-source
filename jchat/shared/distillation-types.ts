// jchat/shared/distillation-types.ts
//
// Wire types for the distillation wizard.
// Plan: Task 1

export type DistillationStatus = 'running' | 'done' | 'error';

export interface QuotaResponse {
  used: number;
  limit: 3;
  remaining: number;
  reset_at: string; // ISO8601
}

export interface StartRunRequest {
  x_url: string;
}

export interface StartRunResponse {
  run_id: string;
}

export type StartRunErrorCode = 'invalid_x_url' | 'quota_exhausted' | 'concurrent_running';

export interface StartRunError {
  error: StartRunErrorCode;
  message?: string;
}

export interface RunningStatus {
  status: 'running';
  started_at: string;
}

export interface DoneStatus {
  status: 'done';
  agent_id: string;
  name: string;
  avatar_url: string | null;
  slug: string;
}

export interface ErrorStatus {
  status: 'error';
  code: string;
  message: string;
}

export type RunStatusResponse = RunningStatus | DoneStatus | ErrorStatus;
