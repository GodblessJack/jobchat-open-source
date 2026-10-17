// jchat/server/agent/persona-builder.ts
//
// 9-layer system prompt builder. Returns string[] with SDK's
// SYSTEM_PROMPT_DYNAMIC_BOUNDARY between stable and dynamic blocks.
//
// Spec: specs/system-prompt-redesign/design.md

import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@anthropic-ai/claude-agent-sdk';
import type { AgentSummary, AgentIdentity, Uuid } from '@shared/domain.js';
import { recallMemory } from './agent-memory.js';
import { renderUserSection } from './user-profile.js';
import { renderIdentity } from './identity-renderer.js';
import { renderSafety, REPLY_FORMAT, renderDatetime } from './prompt-constants.js';
import {
  defendField,
  PER_FIELD_LIMIT, CUSTOM_INSTRUCTIONS_LIMIT, STABLE_TOTAL_LIMIT,
} from './prompt-defense.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export interface PersonaBuildInput {
  userId: Uuid;
  agentId: Uuid;
  agentName: string;
  personaMarkdown?: string | null;
  identity?: AgentIdentity | null;
  customInstructions?: string | null;
  conversationType: 'dm' | 'group';
  /** Other Agents in the same conversation (excluding self). Empty for DM. */
  groupPeers?: AgentSummary[];
  /** The latest user message text — used as the recall query. */
  recallQuery?: string;
  /** Override top-K for tests / special flows. */
  recallTopK?: number;
  /** Resolved skill contents to inject into the system prompt. */
  activeSkills?: Array<{ name: string; content: string }>;
}

function buildSoul(input: PersonaBuildInput): string {
  const persona = (input.personaMarkdown || '').trim();
  if (persona) return defendField(persona, 'soul', PER_FIELD_LIMIT);
  return `你是「${input.agentName}」。请始终以这个身份回复用户。`;
}

function buildGroup(input: PersonaBuildInput): string {
  if (input.conversationType !== 'group') return '';
  const peers = input.groupPeers ?? [];
  const lines: string[] = [
    '## Group context',
    '',
    'You are in a round-table discussion driven by the user.'
  ];
  if (peers.length > 0) {
    lines.push('', 'Other participants in this round-table:');
    for (const p of peers) {
      lines.push(`- @${p.name}${p.description ? ' — ' + p.description : ''}`);
    }
  }
  lines.push(
    '',
    "When you speak, you may build on or respectfully challenge what previous participants in THIS turn have already said — their replies precede yours in the conversation history.",
    '',
    'Never @-mention another participant. The user is the sole conductor; peers are read-only context for you.'
  );
  return lines.join('\n');
}

function buildCustomInstructions(input: PersonaBuildInput): string {
  const ci = (input.customInstructions || '').trim();
  if (!ci) return '';
  const safe = defendField(ci, 'custom_instructions', CUSTOM_INSTRUCTIONS_LIMIT);
  if (!safe) return '';
  return `## 用户对此联系人的自定指令\n\n${safe}`;
}

async function buildMemory(input: PersonaBuildInput): Promise<string> {
  const query = (input.recallQuery || '').trim();
  if (!query) return '';
  const topK = input.recallTopK ?? config.memoryTopK;
  const recalled = await recallMemory(input.userId, input.agentId, query, topK);
  if (recalled.length === 0) return '';
  const items = recalled.slice(0, topK).map((r, i) => `${i + 1}. ${r.chunk_text.replace(/\s+/g, ' ').trim()}`);
  return [
    '## Relevant context from past conversations',
    '',
    ...items,
    '',
    'Use this background only if it is genuinely relevant to the current message.',
  ].join('\n');
}

interface LabeledSegment { label: string; content: string }

function logIfOverflow(segments: LabeledSegment[]): void {
  const lengths: Record<string, number> = {};
  let total = 0;
  for (const s of segments) {
    lengths[s.label] = s.content.length;
    total += s.content.length;
  }
  if (total <= STABLE_TOTAL_LIMIT) return;
  // Per spec §7.2 the warn payload MUST include per-section lengths so future
  // tightening decisions can be data-driven.
  logger.warn({ total, limit: STABLE_TOTAL_LIMIT, lengths }, 'stable system-prompt budget exceeded');
}

function buildSkillsContent(input: PersonaBuildInput): string {
  const skills = input.activeSkills;
  if (!skills || skills.length === 0) return '';

  const lines: string[] = [
    '## Skills',
    '',
    'You have the following skills. Their instructions are part of your identity —',
    'follow their methodology naturally, without announcing which skill you are using.',
    ''
  ];

  for (const skill of skills) {
    lines.push(`### ${skill.name}`);
    lines.push('');
    lines.push(defendField(skill.content, `skill:${skill.name}`, PER_FIELD_LIMIT));
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export async function buildPersonaPrompt(input: PersonaBuildInput): Promise<string[]> {
  const stableSegments: LabeledSegment[] = [
    { label: 'soul',          content: buildSoul(input) },
    { label: 'identity',      content: renderIdentity(input.agentName, input.identity ?? null) },
    { label: 'safety',        content: renderSafety(input.agentName) },
    { label: 'reply_format',  content: REPLY_FORMAT },
    { label: 'group_context', content: buildGroup(input) },
  ];

  const { section: userSection, meta } = await renderUserSection(input.userId);
  const dynamicSegments: LabeledSegment[] = [
    { label: 'user',                content: userSection },
    { label: 'custom_instructions', content: buildCustomInstructions(input) },
    { label: 'skills',              content: buildSkillsContent(input) },
    { label: 'memory_recall',       content: await buildMemory(input) },
    { label: 'datetime',            content: renderDatetime(new Date(), meta.timezone || 'Asia/Shanghai') },
  ];

  const stable = stableSegments.filter((s) => s.content.length > 0);
  logIfOverflow(stable);

  const out: string[] = [];
  for (const s of stable) out.push(s.content);
  out.push(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
  for (const s of dynamicSegments) if (s.content.length > 0) out.push(s.content);
  return out;
}
