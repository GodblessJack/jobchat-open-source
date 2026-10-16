// jchat/server/mcp/ask-user-mcp.ts
//
// Ported from clay/lib/ask-user-mcp-server.js. Exposes a `ask_user_questions`
// tool that the Agent calls to render an inline multiple-choice card to the
// user. The handler delegates the actual UX to a caller-supplied `onAsk`
// callback (typically wired to ws-router so it pushes a permission_request
// event to the front-end and awaits the user's choice).

import { z } from 'zod';

export interface AskUserOption {
  label: string;
  description: string;
  markdown?: string;
}

export interface AskUserQuestion {
  header: string;
  question: string;
  multiSelect?: boolean;
  options: AskUserOption[];
}

export interface AskUserArgs {
  questions: AskUserQuestion[];
}

export interface AskUserResponse {
  questionIndex: number;
  selectedLabels: string[];
  freeText?: string;
}

export type OnAskHandler = (args: AskUserArgs) => Promise<AskUserResponse[]>;

const optionSchema = z
  .object({
    label: z
      .string()
      .min(1)
      .max(60)
      .describe('Short button label, 1-6 words. Shown as the primary option text.'),
    description: z
      .string()
      .min(1)
      .max(160)
      .describe('One-line clarifier shown under the label. Concrete example or scope.'),
    markdown: z
      .string()
      .optional()
      .describe('Optional longer markdown body shown on expand. Use sparingly.')
  })
  .passthrough();

const questionSchema = z
  .object({
    header: z
      .string()
      .min(1)
      .max(40)
      .describe(
        "Short ALL-CAPS-ish section header above the question (e.g. 'FIRST THINGS FIRST', 'SCOPE')."
      ),
    question: z.string().min(1).describe('The actual question in natural spoken tone. Be specific.'),
    multiSelect: z
      .boolean()
      .optional()
      .describe('Set true only when multiple answers genuinely make sense. Default false.'),
    options: z
      .array(optionSchema)
      .min(2)
      .max(6)
      .describe(
        'Concrete options. Aim for 4 by default (acceptable 2-6). Each option has label + description. Never include an "Other" option yourself — the UI renders one automatically.'
      )
  })
  .passthrough();

export const askUserInputSchema = {
  questions: z
    .array(questionSchema)
    .min(1)
    .max(3)
    .describe('One to three question objects. Prefer ONE focused question per call.')
};

export const ASK_USER_TOOL_DESCRIPTION = [
  'Ask the user a structured multiple-choice question. Renders as a card with',
  "a header, the question, 2-6 clickable option buttons, and an always-present 'Other...' free-text field.",
  '',
  'Use this when:',
  '- You need to narrow scope before acting on an ambiguous request.',
  '- The branching decision has 2-6 concrete choices that cover most cases.',
  '',
  'STRUCTURE:',
  '- header: short context label.',
  '- question: one specific question, natural tone.',
  '- options: aim for 4 (range 2-6), each with label + description. The UI',
  "  already shows an 'Other...' free-text field, so do NOT add one yourself.",
  '- multiSelect: omit/false unless multiple answers clearly apply.'
].join('\n');

export interface AskUserToolDef {
  name: 'ask_user_questions';
  description: string;
  inputSchema: typeof askUserInputSchema;
  handler: (args: AskUserArgs) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
}

export function getAskUserToolDef(onAsk: OnAskHandler): AskUserToolDef {
  return {
    name: 'ask_user_questions',
    description: ASK_USER_TOOL_DESCRIPTION,
    inputSchema: askUserInputSchema,
    handler: async (args) => {
      if (!args || !Array.isArray(args.questions) || args.questions.length === 0) {
        return {
          content: [{ type: 'text', text: 'Error: questions must be a non-empty array.' }],
          isError: true
        };
      }
      for (let i = 0; i < args.questions.length; i++) {
        const q = args.questions[i]!;
        if (!q || !Array.isArray(q.options) || q.options.length < 2) {
          return {
            content: [
              {
                type: 'text',
                text:
                  `Error: question ${i + 1} must include at least 2 options. ` +
                  'Provide concrete { label, description } choices (4 preferred). ' +
                  "The UI already shows an 'Other...' free-text field, so never add 'Other' yourself."
              }
            ],
            isError: true
          };
        }
      }
      const responses = await onAsk(args);
      const text = responses
        .map(
          (r, i) =>
            `Q${i + 1} (${r.questionIndex}): selected=${r.selectedLabels.join(' | ')}` +
            (r.freeText ? `; freeText="${r.freeText}"` : '')
        )
        .join('\n');
      return { content: [{ type: 'text', text: text || 'User answered.' }] };
    }
  };
}
