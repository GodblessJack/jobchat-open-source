// jchat/server/mcp/slack-progress-mcp.ts
//
// MCP tool definitions for agents to post updates and structured reports
// to Slack. Used by L1 (code task progress) and L4 (monitor reports).
//
// Two tools:
//   post_slack_update  — lightweight progress update (session-scoped, channel
//                         + thread_ts captured in closure)
//   post_slack_report  — structured report with sections/status/code blocks
//                         (globally registered, channel from input args)

import type { WebClient } from '@slack/web-api';

// ======================================================================
// post_slack_update (session-scoped, for L1 code task progress)
// ======================================================================

export interface SlackUpdateToolDeps {
  /** Slack WebClient instance (from slack-client.ts). */
  web: WebClient;
  /** Slack channel ID to post to. */
  channel: string;
  /** Optional Slack thread_ts to post in-thread. */
  threadTs?: string;
}

export function getPostSlackUpdateToolDef(deps: SlackUpdateToolDeps) {
  return {
    name: 'post_slack_update',
    description: [
      'Post a progress update to the Slack thread. Use this to show:',
      '- Intermediate milestones reached ("Found the bug — it\'s in auth.ts line 42")',
      '- What you\'re about to do next ("Now I\'ll write a test and fix the issue")',
      '- Final results and code snippets',
      '',
      'Call this whenever you have something meaningful to report, but don\'t',
      'flood — batch small updates together.'
    ].join('\n'),
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: {
          type: 'string' as const,
          description: 'Main update text. Supports Slack mrkdwn formatting (*bold*, `code`, etc.). Keep under 2000 chars per call.'
        },
        level: {
          type: 'string' as const,
          enum: ['info', 'progress', 'done', 'error'],
          description: 'Level: info (neutral), progress (working on it), done (completed), error (something went wrong).'
        },
        code_block: {
          type: 'string' as const,
          description: 'Optional code snippet to display in a formatted code block.'
        }
      },
      required: ['text']
    },
    handler: async (input: { text: string; level?: string; code_block?: string }) => {
      const level = input.level || 'info';
      const levelEmoji: Record<string, string> = {
        info: 'ℹ️',
        progress: '🔄',
        done: '✅',
        error: '❌'
      };

      const blocks: any[] = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn' as const,
            text: `${levelEmoji[level] || ''} ${input.text}`
          }
        }
      ];

      // If there's a code block, add it in a separate block
      if (input.code_block) {
        const code = input.code_block.length > 2800
          ? input.code_block.slice(0, 2800) + '\n... (truncated)'
          : input.code_block;
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn' as const,
            text: '```\n' + code + '\n```'
          }
        });
      }

      try {
        await deps.web.chat.postMessage({
          channel: deps.channel,
          thread_ts: deps.threadTs,
          text: input.text,
          blocks: deps.threadTs ? blocks : undefined, // blocks only in threads
          unfurl_links: false
        });
      } catch (err) {
        // Don't fail the agent task just because Slack posting failed.
        return {
          content: [{ type: 'text' as const, text: `Slack post failed: ${(err as Error).message}` }],
          isError: true
        };
      }

      return {
        content: [{ type: 'text' as const, text: 'Update posted to Slack.' }]
      };
    }
  };
}

// ======================================================================
// post_slack_report (global, for L4 monitor reports)
// ======================================================================

export interface SlackReportToolDeps {
  /** Slack WebClient instance. */
  web: WebClient;
}

interface SlackReportSection {
  heading: string;
  body: string;
  status: 'ok' | 'warn' | 'error' | 'info';
}

interface SlackReportCodeBlock {
  language: string;
  code: string;
}

export function getPostSlackReportToolDef(deps: SlackReportToolDeps) {
  return {
    name: 'post_slack_report',
    description: [
      'Post a structured report to a Slack channel. Use for periodic monitoring',
      'reports, code review summaries, deploy status, and usage analytics.',
      '',
      'The report appears as a formatted Slack message with:',
      '- A header with the report title',
      '- Summary text',
      '- Sections with status indicators (ok/warn/error/info)',
      '- Optional code blocks',
      '',
      'Call this once per report — don\'t fragment across multiple calls.'
    ].join('\n'),
    inputSchema: {
      type: 'object' as const,
      properties: {
        channel: {
          type: 'string' as const,
          description: 'Slack channel ID to post to (e.g. "C0BB3H732J2").'
        },
        title: {
          type: 'string' as const,
          description: 'Report title shown in the header (e.g. "🔍 Daily Code Review Report").'
        },
        summary: {
          type: 'string' as const,
          description: 'One-paragraph summary of key findings. Shown below the header.'
        },
        sections: {
          type: 'array' as const,
          description: 'Detailed sections of the report.',
          items: {
            type: 'object' as const,
            properties: {
              heading: { type: 'string' as const, description: 'Section heading.' },
              body: { type: 'string' as const, description: 'Section content (mrkdwn).' },
              status: {
                type: 'string' as const,
                enum: ['ok', 'warn', 'error', 'info'],
                description: 'Status indicator shown as emoji before the heading.'
              }
            },
            required: ['heading', 'body']
          }
        },
        code_blocks: {
          type: 'array' as const,
          description: 'Optional code blocks to include.',
          items: {
            type: 'object' as const,
            properties: {
              language: { type: 'string' as const },
              code: { type: 'string' as const }
            },
            required: ['language', 'code']
          }
        }
      },
      required: ['channel', 'title', 'summary']
    },
    handler: async (input: {
      channel: string;
      title: string;
      summary: string;
      sections?: SlackReportSection[];
      code_blocks?: SlackReportCodeBlock[];
    }) => {
      const statusEmoji: Record<string, string> = {
        ok: '🟢',
        warn: '🟡',
        error: '🔴',
        info: '🔵'
      };

      const truncatedTitle = input.title.length > 150 ? input.title.slice(0, 147) + '...' : input.title;
      const blocks: any[] = [
        {
          type: 'header',
          text: { type: 'plain_text' as const, text: truncatedTitle, emoji: true }
        },
        {
          type: 'section',
          text: { type: 'mrkdwn' as const, text: input.summary }
        }
      ];

      // Sections
      if (input.sections && input.sections.length > 0) {
        const sectionBlocks = input.sections.map((s) => ({
          type: 'section' as const,
          text: {
            type: 'mrkdwn' as const,
            text: `${statusEmoji[s.status || 'info']} *${s.heading}*\n${s.body}`
          }
        }));
        blocks.push(...sectionBlocks);
      }

      // Code blocks (max 2 to avoid huge messages)
      if (input.code_blocks && input.code_blocks.length > 0) {
        for (const cb of input.code_blocks.slice(0, 2)) {
          const code = cb.code.length > 2500
            ? cb.code.slice(0, 2500) + '\n... (truncated)'
            : cb.code;
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn' as const,
              text: `\`\`\`${cb.language || ''}\n${code}\n\`\`\``
            }
          });
        }
      }

      // Footer timestamp
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn' as const,
            text: `📊 Generated at ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`
          }
        ]
      });

      try {
        await deps.web.chat.postMessage({
          channel: input.channel,
          text: `${input.title}\n${input.summary}`,
          blocks,
          unfurl_links: false
        });
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Slack report failed: ${(err as Error).message}` }],
          isError: true
        };
      }

      return {
        content: [{ type: 'text' as const, text: `Report "${input.title}" posted to Slack channel ${input.channel}.` }]
      };
    }
  };
}
