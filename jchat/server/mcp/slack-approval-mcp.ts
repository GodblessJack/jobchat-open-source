// jchat/server/mcp/slack-approval-mcp.ts
//
// MCP tool definition for L3 human-in-the-loop approval via Slack.
// Registered into the jchat-core MCP server alongside existing tools.
//
// The handler blocks (async) until the human approves/denies via Slack
// button, or the timeout expires.

import { slackClient } from '../lib/slack-client.js';
import { logger } from '../logger.js';

/** Slack channel to send approval requests to. Set via SLACK_APPROVAL_CHANNEL env var. */
const APPROVAL_CHANNEL = process.env.SLACK_APPROVAL_CHANNEL || process.env.SLACK_CHANNEL_ID || '';

export interface SlackApprovalToolOpts {
  /** Override the channel for testing. */
  channel?: string;
}

const TOOL_NAME = 'ask_approval';
const TOOL_DESCRIPTION = [
  'Send an approval request to a human via Slack and wait for their response.',
  'Use BEFORE executing any sensitive or irreversible operation: deleting data,',
  'creating contacts, sending emails, modifying production config, or making',
  'purchases. The call will block until the human clicks Approve or Deny, or',
  'the timeout (default 5 min) expires.',
  '',
  'Parameters:',
  '- title: Short title for the approval (e.g. "Create new contact: Sales Bot")',
  '- message: Detailed explanation of what is about to happen, including risks',
  '- fields (optional): Key-value context pairs shown in the Slack message',
  '',
  'Returns: { approved: boolean, timedOut: boolean, respondedBy?: string }'
].join('\n');

const INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: {
      type: 'string' as const,
      description: 'Short title shown in the Slack message header. Keep it under 60 chars.'
    },
    message: {
      type: 'string' as const,
      description: 'Detailed explanation of the action awaiting approval. Include what, why, and risks.'
    },
    fields: {
      type: 'object' as const,
      description: 'Optional key-value pairs shown as context fields in the Slack message (e.g. {"agent_name":"Sales Bot","skills":"email,web-search"}).'
    }
  },
  required: ['title', 'message']
};

export function getSlackApprovalToolDef(opts: SlackApprovalToolOpts = {}) {
  const channel = opts.channel || APPROVAL_CHANNEL;

  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    inputSchema: INPUT_SCHEMA,
    handler: async (input: { title: string; message: string; fields?: Record<string, string> }) => {
      if (!slackClient.enabled) {
        logger.warn('ask_approval called but Slack L3 is not configured — auto-denying');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ approved: false, timedOut: true, reason: 'slack-not-configured' }) }]
        };
      }

      if (!channel) {
        logger.warn('ask_approval called but no SLACK_APPROVAL_CHANNEL set — auto-denying');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ approved: false, timedOut: true, reason: 'no-channel-configured' }) }]
        };
      }

      logger.info({ title: input.title }, 'ask_approval: sending to Slack');
      const result = await slackClient.askApproval({
        title: input.title,
        message: input.message,
        channel,
        fields: input.fields
      });

      logger.info(
        { title: input.title, approved: result.approved, timedOut: result.timedOut },
        'ask_approval: result'
      );

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            approved: result.approved,
            timedOut: result.timedOut,
            respondedBy: result.respondedBy
          })
        }]
      };
    }
  };
}
