// jchat/server/ws/envelope.ts
//
// Envelope codec + runtime guards for WS messages.
// Re-exports the shape guards from `@shared/protocol` and adds wire-level
// (string ↔ object) helpers used by the router and tests.
//
// We do NOT use zod here on purpose — `shared/protocol.ts` already exposes
// hand-written discriminated unions and type guards; the only extra runtime
// validation needed at this layer is "is this a syntactically valid envelope
// at the JSON level?". Per-command payload validation happens inside each
// command handler in `command-dispatcher.ts`, not here.

import {
  isClientEnvelope,
  isServerEnvelope,
  type ClientEnvelope,
  type ServerEnvelope
} from '@shared/protocol.js';

export { isClientEnvelope, isServerEnvelope };
export type { ClientEnvelope, ServerEnvelope };

/** Serialize a server envelope to a JSON string for `ws.send`. */
export function serializeEnvelope(env: ServerEnvelope): string {
  return JSON.stringify(env);
}

export type ParseResult =
  | { ok: true; envelope: ClientEnvelope }
  | { ok: false; reason: 'not-json' | 'not-object' | 'not-client-envelope'; raw: string };

/**
 * Parse a raw text frame into a typed `ClientEnvelope`.
 *
 * Returns a tagged-union result instead of throwing, so the router can map
 * the failure mode to a `VALIDATION_ERROR` reply without try/catch noise.
 */
export function parseEnvelope(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-json', raw: text };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'not-object', raw: text };
  }
  if (!isClientEnvelope(parsed)) {
    return { ok: false, reason: 'not-client-envelope', raw: text };
  }
  return { ok: true, envelope: parsed };
}
