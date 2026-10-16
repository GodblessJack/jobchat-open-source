export const MAX_HISTORY_MESSAGES = 30;
export const MAX_HISTORY_CHARS = 12000;
// persona_description fallback (used when identity + bootstrap_md are both
// empty). Truncated so identity-less agents don't blow Gemini Live context.
export const MAX_PERSONA_CHARS = 6000;

export interface PersonaInput {
  agent: {
    name: string;
    identity: string;
    bootstrapMd: string;
    personaDescription?: string | null;
  };
  history: { sender: 'user' | 'agent'; text: string }[];
}

const VOICE_CONSTRAINT = `本次为视频通话，请用口语化、简短表达，避免大段输出/列表/代码块。`;

export function buildSystemInstruction(input: PersonaInput): string {
  const parts: string[] = [];
  if (input.agent.identity) parts.push(input.agent.identity);
  if (input.agent.bootstrapMd) parts.push(input.agent.bootstrapMd);

  // Fallback: many existing agents store the full persona only in
  // persona_description (a markdown blob). If neither identity nor
  // bootstrap_md is set, use persona_description so Gemini Live actually
  // knows who the agent is — without this, the agent introduces itself
  // as a generic chatbot.
  const personaDesc = input.agent.personaDescription?.trim();
  if (!input.agent.identity && !input.agent.bootstrapMd && personaDesc) {
    const truncated = personaDesc.length > MAX_PERSONA_CHARS
      ? personaDesc.slice(0, MAX_PERSONA_CHARS) + '\n…[人设描述过长，已截断]'
      : personaDesc;
    parts.push(truncated);
  }

  // Pick last N messages, drop oldest until we fit MAX_HISTORY_CHARS budget.
  const lastN = input.history.slice(-MAX_HISTORY_MESSAGES);
  const lines: string[] = [];
  let totalChars = 0;
  // walk newest→oldest, accumulate lines until budget; reverse to chronological at the end
  for (let i = lastN.length - 1; i >= 0; i--) {
    const m = lastN[i];
    const role = m.sender === 'user' ? '用户' : input.agent.name || 'Agent';
    const line = `${role}: ${m.text}`;
    if (totalChars + line.length > MAX_HISTORY_CHARS) break;
    lines.unshift(line);
    totalChars += line.length;
  }
  if (lines.length > 0) {
    parts.push(`[最近的对话片段]\n${lines.join('\n')}`);
  }
  parts.push(VOICE_CONSTRAINT);
  return parts.join('\n\n');
}
