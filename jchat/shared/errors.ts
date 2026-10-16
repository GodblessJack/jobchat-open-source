// jchat/shared/errors.ts — error code dictionary + error class

export const ErrorCodes = {
  AUTH_INVALID: 'AUTH_INVALID',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  WORKER_UNAVAILABLE: 'WORKER_UNAVAILABLE',
  SDK_ERROR: 'SDK_ERROR',
  SDK_QUOTA_EXCEEDED: 'SDK_QUOTA_EXCEEDED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND'
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class JchatError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'JchatError';
    this.code = code;
    this.details = details;
  }
}

export function toErrorPayload(err: unknown): { code: string; message: string; details?: unknown } {
  if (err instanceof JchatError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof Error) {
    return { code: ErrorCodes.INTERNAL_ERROR, message: err.message };
  }
  return { code: ErrorCodes.INTERNAL_ERROR, message: String(err) };
}
