// jchat/server/mcp/index.ts
//
// Central MCP descriptor builder. Handlers that need user context inject
// it via closure here — never trust user_id passed in tool args
// (security boundary §8.1).
//
// Registered tool servers:
//   - jchat-core    : distillation toolchain (parse_x_url, check_quota, create_contact)
//   - browser       : browser_search + browser_fetch (only when ZHIPU_API_KEY
//                     or SERPAPI_KEY env is set)
//
// Note on web search: the SDK ships built-in `WebSearch` / `WebFetch` tools
// but those are Anthropic-server-side and our endpoint is BigModel-anthropic
// which does NOT implement them — the model would call WebSearch and hang
// forever waiting for a tool_result. The orchestrator pairs this MCP
// registration with `disallowedTools: ['WebSearch','WebFetch']` so the model
// can only see our working `browser_search`/`browser_fetch`.

import { getParseXUrlToolDef } from './parse-x-url-mcp.js';
import { getCheckQuotaToolDef } from './check-quota-mcp.js';
import { getCreateContactToolDef } from './create-contact-mcp.js';
import { getCreateAttachmentToolDef } from './create-attachment-mcp.js';
import { getSlackApprovalToolDef } from './slack-approval-mcp.js';
import { getBrowserToolDefs } from './browser-mcp.js';
import { getDistillationQuota } from '../services/quota.js';
import { createContact, type CreateContactInput } from '../services/create-contact.js';
import type { OrchestratorBroadcaster } from '../conversation/agent-reply-orchestrator.js';

export interface BuildMcpDescriptorsOpts {
  userId: string;
  agentId: string;
  conversationId: string;
  /** Optional: forwarded to create_contact for contacts-snapshot refresh. */
  broadcaster?: OrchestratorBroadcaster | null;
  /** Optional: invoked after a successful create_contact call. Used by the
   *  distillation wizard launcher to capture the result. */
  onContactCreated?: (result: { agent_id: string; slug_resolved: string; avatar_url: string | null; name: string }) => void;
  /** Optional: returns the SDK worker's workspace root path. Used by
   *  create_attachment to resolve agent workspace files. */
  getWorkspacePath?: () => string;
  /** Optional: invoked after a successful create_attachment call. Used by
   *  the orchestrator to collect attachment refs for the agent message. */
  onAttachmentCreated?: (ref: { filePath: string; mime: string; size: number }) => void;
}

/**
 * Returns MCP server descriptors that the SDK worker registers as MCP
 * servers. Each tool's handler closure binds the userId — args from the
 * SDK / skill never override the server-side user context.
 */
export function buildMcpDescriptors(opts: BuildMcpDescriptorsOpts) {
  const broadcastFn = opts.broadcaster
    ? (_uid: string, topic: string) => {
        opts.broadcaster!.broadcastTopicChanged(topic)?.catch(() => {});
      }
    : undefined;

  const descriptors: Array<{ serverName: string; tools: unknown[] }> = [
    {
      serverName: 'jchat-core',
      tools: [
        getParseXUrlToolDef(),
        getCheckQuotaToolDef({
          getQuota: () => getDistillationQuota(opts.userId),
        }),
        getCreateContactToolDef({
          createContact: (input: CreateContactInput) =>
            createContact(opts.userId, input, broadcastFn),
          onContactCreated: opts.onContactCreated,
        }),
        getCreateAttachmentToolDef({
          userId: opts.userId,
          conversationId: opts.conversationId,
          getWorkspacePath: opts.getWorkspacePath ?? (() => ''),
          onAttachmentCreated: opts.onAttachmentCreated,
        }),
        ...(process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN
          ? [getSlackApprovalToolDef()]
          : []),
      ],
    },
  ];

  // Web search: register only if a backing provider is configured. Without
  // this server, agents that try to do `WebSearch` / `WebFetch` against the
  // BigModel-anthropic endpoint would hang silently (Boss-reported "Elon
  // says he can't search the internet" symptom). Tavily is preferred —
  // Zhipu's web_search is a separate paid pack from the LLM credits, easy
  // to forget to top up.
  const tavilyKey = process.env.TAVILY_API_KEY;
  const zhipuKey = process.env.ZHIPU_API_KEY || process.env.ZAI_API_KEY;
  const serpKey = process.env.SERPAPI_KEY;
  if (tavilyKey || zhipuKey || serpKey) {
    const browser = getBrowserToolDefs({
      tavilyApiKey: tavilyKey,
      zaiApiKey: zhipuKey,
      serpApiKey: serpKey
    });
    descriptors.push({
      serverName: 'browser',
      tools: [browser.search, browser.fetch],
    });
  }

  return descriptors;
}
