// jchat/server/mcp/create-contact-mcp.ts
//
// MCP wrapper for create-contact service. Maps Postgres raise_exception
// (P0001) error messages to user-facing Chinese friendly strings; other
// errors propagate up to the SDK transport.
//
// SECURITY (spec §8.1): user_id is NOT in the input schema. The handler
// receives a closure-injected createContact() that already binds userId
// from the WS-verified JWT context.

import { z } from 'zod';
import type { CreateContactInput, CreateContactResult } from '../services/create-contact.js';

// Loose schema for SDK tool-registration. The SDK's bundled CLI
// strictly enforces this schema *before* invoking the handler;
// smoke showed that when the model sends args that fail the strict
// `.min()`/`.regex()` constraints, the SDK reports tool success but
// passes an empty object to the handler — and the model interprets
// that as "tool schema is broken". By registering only the TYPES
// here, the SDK always passes the model's args through verbatim,
// and the real validation lives in the handler (createContactInputSchemaStrict
// below), which can return a model-readable error.
export const createContactInputSchema = {
  properties: {
    name: { type: 'string' },
    slug: { type: 'string' },
    skill_md: { type: 'string', description: 'Full SKILL.md markdown body (≥100 chars, ≤50000).' },
    persona_summary: { type: 'string', description: 'First-person identity card (≥50 chars, ≤2000). Stored as agents.persona_description.' },
    initial_message: { type: 'string', description: 'Greeting message shown when user first opens this contact (≥10 chars, ≤1000).' },
    source_type: { type: 'string', enum: ['x_profile', 'x_tweet'] },
    source_url: { type: 'string' },
    x_handle: { type: 'string' },
    avatar_hint_url: { type: 'string' },
    bio: { type: 'string' },
  },
  required: ['name', 'slug', 'skill_md', 'persona_summary', 'initial_message', 'source_type', 'source_url', 'x_handle'],
};

// Strict schema for handler-side validation. Length / regex constraints
// live here so a failed parse returns a clear, model-readable error.
export const createContactInputSchemaStrict = {
  name: z.string().min(1).max(80),
  slug: z.string().regex(/^[a-z0-9-]{1,40}$/),
  // Aligned with stored function (sql/025): skill_md ≥ 100 chars
  skill_md: z.string().min(100).max(50_000),
  // Aligned with stored function (sql/025): persona_summary ≥ 50 chars
  persona_summary: z.string().min(50).max(2000),
  initial_message: z.string().min(10).max(1000),
  source_type: z.enum(['x_profile', 'x_tweet']),
  source_url: z.string().url(),
  x_handle: z.string().regex(/^[A-Za-z0-9_]{1,15}$/),
  avatar_hint_url: z.string().url().optional(),
  bio: z.string().max(500).optional(),
};

export const FRIENDLY_ERROR: Record<string, string> = {
  QUOTA_EXCEEDED: '今天的蒸馏额度（3 次）用完了，明天重置后再试。',
  SLUG_EXHAUSTED: '联系人 slug 冲突过多，请稍后重试。',
  SKILL_MD_INVALID_LENGTH: '蒸馏产出格式异常（长度超限或为空），请重新启动流程。',
  INVALID_SLUG: '名字解析异常，请重新启动流程。',
  INVALID_SOURCE_TYPE: '链接类型异常，请重新启动流程。',
  USER_ID_REQUIRED: '会话异常，请重新登录。',
  // 2026-04-29 spec §5.4 新增
  PERSONA_SUMMARY_TOO_SHORT: '蒸馏产出的身份摘要太短（< 50 字），请重新启动流程。',
  NO_ENABLED_SKILL: '蒸馏产出未生成有效能力包，请重新启动流程。',
};

export interface CreateContactToolDef {
  name: 'create_contact';
  description: string;
  inputSchema: typeof createContactInputSchema;
  handler: (
    args: CreateContactInput
  ) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
}

export function getCreateContactToolDef(deps: {
  createContact: (input: CreateContactInput) => Promise<CreateContactResult>;
  /** Optional hook invoked AFTER a successful create. Used by the wizard
   *  launcher to capture the result into the run-registry. Errors thrown
   *  from the hook are swallowed (best-effort). */
  onContactCreated?: (result: CreateContactResult) => void;
}): CreateContactToolDef {
  return {
    name: 'create_contact',
    description:
      'Persist a distilled persona as a private contact for the current user. Atomic: increments quota, resolves slug conflicts (-2/-3), inserts agents/agent_skills/user_agents rows, downloads avatar (best-effort), and broadcasts a contacts-snapshot refresh. The current user is bound by the server — do not pass user_id.',
    inputSchema: createContactInputSchema,
    handler: async (args) => {
      // Diagnostic — log only field lengths to avoid dumping huge skill_md
      // into the log. Helps diagnose why a wizard-mode create_contact
      // call rejects (most often: persona_summary too short, skill_md
      // out of bounds, slug regex fail, x_handle malformed).

      console.log('[create_contact:in]', {
        name: args?.name,
        slug: args?.slug,
        skill_md_len: typeof args?.skill_md === 'string' ? args.skill_md.length : null,
        persona_summary_len: typeof args?.persona_summary === 'string' ? args.persona_summary.length : null,
        initial_message_len: typeof args?.initial_message === 'string' ? args.initial_message.length : null,
        source_type: args?.source_type,
        x_handle: args?.x_handle,
      });

      // Strict input validation. The SDK's Zod shape registration is
      // not reliably enforced before the handler runs (observed during
      // smoke: model called with {} and Zod did not reject), so we
      // parse here and return a model-readable explanation of every
      // failing field. Without this, the model sees a vague Postgres
      // signature error and gives up.
      const validation = z.object(createContactInputSchemaStrict).safeParse(args);
      if (!validation.success) {
        const issues = (validation.error.issues as Array<{ path: PropertyKey[]; message: string }>)
          .map((e) =>
            `- ${e.path.map(String).join('.') || '<root>'}: ${e.message}`
          )
          .join('\n');
        const help =
          'IMPORTANT: This is NOT an SDK transport issue. The tool received your args, ' +
          'but one or more failed length / format requirements. Do NOT switch to Bash or ' +
          'try a different tool — just call create_contact AGAIN with the listed fields fixed.\n\n' +
          '调用 create_contact 必须传入这些字段：\n' +
          '- name: 1-80 字，例如 "Naval Ravikant"\n' +
          '- slug: 1-40 字符 [a-z0-9-]，例如 "naval"\n' +
          '- skill_md: ≥100 字，≤50000 字。完整的 SKILL.md markdown\n' +
          '- persona_summary: ≥50 字，≤2000 字。第一人称身份摘要（"我是 ... 我相信 ..."）\n' +
          '- initial_message: 10-1000 字，ta 的第一句问候\n' +
          '- source_type: 字面量 "x_profile"\n' +
          '- source_url: 完整 URL\n' +
          '- x_handle: 1-15 字符 [A-Za-z0-9_]\n' +
          '- avatar_hint_url (可选)\n' +
          '- bio (可选)\n\n' +
          '常见错误：persona_summary 或 skill_md 长度不够 → 把内容再扩写一些即可，不是工具坏了。';
        return {
          content: [
            {
              type: 'text',
              text: `create_contact 参数校验未通过：\n${issues}\n\n${help}`,
            },
          ],
          isError: true,
        };
      }
      const safeArgs = validation.data as CreateContactInput;

      try {
        const r = await deps.createContact(safeArgs);

        console.log('[create_contact:ok]', { agent_id: r.agent_id, slug: r.slug_resolved });
        if (deps.onContactCreated) {
          try {
            deps.onContactCreated(r);
          } catch (hookErr) {
            // hook failure must not affect tool result

            console.warn('[create_contact:hook_err]', (hookErr as Error).message);
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify(r) }] };
      } catch (e: unknown) {
        const err = e as { code?: string; message?: string };

        console.log('[create_contact:err]', { code: err.code, message: err.message });
        if (err.code === 'P0001' && err.message && err.message in FRIENDLY_ERROR) {
          return {
            content: [{ type: 'text', text: FRIENDLY_ERROR[err.message]! }],
            isError: true,
          };
        }
        throw e;
      }
    },
  };
}
