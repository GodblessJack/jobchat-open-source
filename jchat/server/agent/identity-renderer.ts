// jchat/server/agent/identity-renderer.ts
import { defendField } from './prompt-defense.js';
import type { AgentIdentity } from '@shared/domain.js';

const IDENTITY_FIELD_LIMIT = 500;

export function renderIdentity(agentName: string, identity: AgentIdentity | null | undefined): string {
  if (!identity) return '';
  const emoji = identity.emoji ? defendField(identity.emoji, 'identity.emoji', IDENTITY_FIELD_LIMIT) : '';
  const self = identity.self_address ? defendField(identity.self_address, 'identity.self_address', IDENTITY_FIELD_LIMIT) : '';
  const userAddr = identity.user_address ? defendField(identity.user_address, 'identity.user_address', IDENTITY_FIELD_LIMIT) : '';
  const style = identity.speaking_style ? defendField(identity.speaking_style, 'identity.speaking_style', IDENTITY_FIELD_LIMIT * 2) : '';
  const sigs = (identity.signature_phrases ?? [])
    .map((p, i) => defendField(p, `identity.signature_phrases[${i}]`, IDENTITY_FIELD_LIMIT))
    .filter(Boolean);

  const safeName = defendField(agentName, 'identity.agentName', IDENTITY_FIELD_LIMIT);
  const head: string[] = [`你叫 ${safeName}`];
  const desc: string[] = [];
  if (self)  desc.push(`自称"${self}"`);
  if (emoji) desc.push(`emoji ${emoji}`);
  if (desc.length) head.push(`（${desc.join('，')}）`);
  if (style) head.push(`，${style}`);
  head.push('。');

  const lines = [head.join('')];
  if (userAddr) lines.push(`对用户用"${userAddr}"称呼。`);
  if (sigs.length) lines.push(`常用语：${sigs.join(' / ')}`);
  return lines.join('\n');
}
