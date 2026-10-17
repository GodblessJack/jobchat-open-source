//
// Pure utility module for system prompt defense:
//   - scanForInjection(): regex + invisible-Unicode check; returns [已拦截:...] placeholder on hit
//   - truncate(): per-field 12K cap with 75/25 head/tail split, surrogate-pair safe
//   - escapeBoundary(): replace literal SDK boundary marker so user-supplied content
//     cannot break the cache split
//
// All callers must pipe untrusted content through escapeBoundary -> scanForInjection -> truncate
// before joining into the system prompt array.

export const PER_FIELD_LIMIT = 12_000;
export const CUSTOM_INSTRUCTIONS_LIMIT = 4_000;
export const STABLE_TOTAL_LIMIT = 60_000;
const HEAD_RATIO = 0.75;

const BOUNDARY_LITERAL = '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__';
const BOUNDARY_REPLACEMENT = '__BLOCKED_BOUNDARY__';

const THREAT_PATTERNS: Array<[RegExp, string]> = [
  [/ignore\s+(previous|all|above|prior)\s+instructions/i, 'prompt_injection'],
  [/do\s+not\s+tell\s+the\s+user/i, 'deception_hide'],
  [/system\s+prompt\s+override/i, 'sys_prompt_override'],
  [/disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i, 'disregard_rules'],
  [/act\s+as\s+(if|though)\s+you\s+(have\s+no|don['']t\s+have)\s+(restrictions|limits|rules)/i, 'bypass_restrictions'],
  [/<!--[^>]*(?:ignore|override|system|secret|hidden)[^>]*-->/i, 'html_comment_injection'],
  [/<\s*div\s+style\s*=\s*["'][\s\S]*?display\s*:\s*none/i, 'hidden_div'],
  [/translate\s+.*\s+into\s+.*\s+(execute|run|eval)/i, 'translate_execute'],
  [/curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, 'exfil_curl'],
  [/cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass)/i, 'read_secrets'],
  [/忽[略视].{0,3}(以上|上面|之前|前面|所有|全部).{0,3}(指令|规则|提示|限制)/, 'cn_ignore'],
  [/无视.{0,3}(你的|所有|全部|上面的).{0,3}(指令|规则|限制|约束)/, 'cn_disregard'],
  [/(现在|从现在起|从此).{0,5}你.{0,5}(不再是|不是).{0,30}(你是|改为|变成)/, 'cn_persona_swap'],
  [/扮演.{0,20}(没有|不受).{0,5}(限制|规则|约束|管制)/, 'cn_unrestricted'],
  [/(假装|假设|伪装).{0,10}你是.{0,30}(没有|无).{0,5}(规则|限制|约束)/, 'cn_pretend'],
  [/(DAN|越狱|jailbreak).{0,5}模式/i, 'cn_dan'],
  [/(把|给|告诉).{0,5}你的.{0,5}(系统|初始|完整|全部).{0,5}(提示|指令|规则|prompt)/i, 'cn_leak_request'],
  [/(输出|说出|展示).{0,5}你的.{0,5}(prompt|提示词|系统提示|规则原文)/i, 'cn_dump_request'],
  [/(开发者|管理员|debug|developer).{0,5}模式/i, 'cn_dev_mode'],
];

const INVISIBLE_CHARS = /[​‌‍⁠﻿‪‫‬‭‮]/;

export function scanForInjection(content: string, label: string): string {
  if (!content) return content;
  const findings = new Set<string>();
  for (const [re, name] of THREAT_PATTERNS) {
    if (re.test(content)) findings.add(name);
  }
  if (INVISIBLE_CHARS.test(content)) findings.add('invisible_unicode');
  if (findings.size === 0) return content;
  return `[已拦截：${label} 检测到潜在的 prompt injection (${[...findings].join(', ')})。原内容未加载。]`;
}

export function truncate(content: string, label: string, maxChars = PER_FIELD_LIMIT): string {
  if (content.length <= maxChars) return content;
  const marker = `\n\n[…已截断 ${label}：保留 head+tail，原文 ${content.length} chars。需要完整内容请告知。]\n\n`;
  const budget = maxChars - marker.length;
  if (budget < 200) {
    return content.slice(0, maxChars - 12) + '\n[…截断…]';
  }
  const headLen = Math.floor(budget * HEAD_RATIO);
  const tailLen = budget - headLen;
  const head = content.slice(0, headLen);
  // surrogate-pair safe: if last char of head is a high surrogate, drop one char
  const safeHead = /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head;
  const tail = content.slice(-tailLen);
  // surrogate-pair safe: if first char of tail is a low surrogate, drop one char
  const safeTail = /^[\uDC00-\uDFFF]/.test(tail) ? tail.slice(1) : tail;
  return safeHead + marker + safeTail;
}

export function escapeBoundary(s: string): string {
  return s.includes(BOUNDARY_LITERAL) ? s.split(BOUNDARY_LITERAL).join(BOUNDARY_REPLACEMENT) : s;
}

export function defendField(content: string | null | undefined, label: string, maxChars = PER_FIELD_LIMIT): string {
  if (!content) return '';
  return truncate(scanForInjection(escapeBoundary(content), label), label, maxChars);
}
