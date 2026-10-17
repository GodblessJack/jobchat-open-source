// jchat/server/mcp/spawn-subagent-mcp.ts
//
// MCP tool: spawn_subagent — allows an agent running in Slack L1 to spawn
// a sub-agent SDK session for parallel work. The sub-agent completes its
// task and returns its result. This is the foundation of multi-agent
// collaboration from Slack.
//
// Usage from a Slack L1 agent:
//   1. Main agent receives user request
//   2. Decomposes into sub-tasks
//   3. Calls spawn_subagent for each sub-task
//   4. Collects results and synthesizes response

import { runQuery, getWorkerManager } from '../sdk/sdk-bridge.js';
import type { WorkerKey } from '../sdk/worker-manager.js';
import { getAgent } from '../agent/agent-repo.js';
import { buildPersonaPrompt } from '../agent/persona-builder.js';
import type { Uuid } from '@shared/domain.js';

// ======================================================================
// Config
// ======================================================================

const SLACK_USER_ID = process.env.SLACK_USER_ID || 'a0000000-0000-0000-0000-000000000001';

export interface SpawnSubagentToolDeps {
  userId: Uuid;
  conversationId: Uuid;
}

export function getSpawnSubagentToolDef(deps: SpawnSubagentToolDeps) {
  return {
    name: 'spawn_subagent',
    description: [
      'Spawn a sub-agent SDK session to handle a specific sub-task in parallel.',
      'Use this when a complex task can be decomposed into independent sub-tasks.',
      '',
      'Examples:',
      '- "Review the auth module for security issues" → spawn a security reviewer',
      '- "Check the code style in all .ts files" → spawn a style checker',
      '- "Write unit tests for the new API endpoint" → spawn a test writer',
      '',
      'The sub-agent gets its own Claude Code session with file access, shell,',
      'and all MCP tools. It runs independently and returns its result.',
      '',
      'IMPORTANT: Use this for truly independent sub-tasks. The sub-agent CANNOT',
      'see your conversation context — give it a complete, self-contained prompt.',
      '',
      'Returns the sub-agent\'s final text output.'
    ].join('\n'),
    inputSchema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string' as const,
          description: 'UUID of the agent to spawn. Leave empty to use the same agent type as the caller. Use specific agent UUIDs for specialized roles (e.g. Karpathy for architecture, Code Reviewer for style).'
        },
        task: {
          type: 'string' as const,
          description: 'Complete, self-contained task description for the sub-agent. Include ALL context needed — the sub-agent starts with a clean conversation.'
        },
        label: {
          type: 'string' as const,
          description: 'Human-readable label for this sub-agent (e.g. "Security Review", "Style Check"). Used in progress reporting.'
        }
      },
      required: ['task']
    },
    handler: async (input: {
      agent_id?: string;
      task: string;
      label?: string;
    }) => {
      const agentId = (input.agent_id || process.env.SLACK_CODE_CONTACT_ID || 'e2000001-0000-0000-0000-000000000001') as Uuid;
      const label = input.label || 'Sub-agent';

      // Build minimal persona prompt for the sub-agent
      let systemPrompt: string[] = [
        `你是一个子任务执行器。你的任务：${input.task}`,
        '请直接执行任务并返回结果。不要问问题——给你任务的人已经在主线程里处理了用户交互。',
        '用中文回复。完成后清晰标记"任务完成"并总结。',
        '你可以使用所有可用的工具来完成工作。'
      ];

      try {
        const agentRow = await getAgent(agentId);
        if (agentRow) {
          const personaPrompt = await buildPersonaPrompt({
            userId: SLACK_USER_ID as Uuid,
            agentId,
            agentName: agentRow.name || 'Sub-agent',
            personaMarkdown: agentRow.personaMarkdown || undefined,
            identity: agentRow.identity || null,
            conversationType: 'dm',
            recallQuery: input.task,
          });
          systemPrompt = personaPrompt;
        }
      } catch { /* use fallback */ }

      const workerKey: WorkerKey = {
        userId: SLACK_USER_ID as Uuid,
        agentId,
        conversationId: deps.conversationId,
      };

      try {
        const emitter = await runQuery({
          key: workerKey,
          prompt: input.task,
          sdkOptions: {
            systemPrompt,
            includePartialMessages: true,
            settingSources: ['project'],
            permissionMode: 'bypassPermissions',
            disallowedTools: ['WebSearch', 'WebFetch'],
            maxTurns: 30,
          },
          singleTurn: true,
        });

        // Collect all text output
        let textBuffer = '';
        emitter.on('event', (sdkEvent: any) => {
          try {
            if (sdkEvent?.type === 'stream_event' && sdkEvent?.event?.type === 'content_block_delta') {
              const delta = sdkEvent.event.delta;
              if (delta?.type === 'text_delta' && delta.text) {
                textBuffer += delta.text;
              }
            }
          } catch { /* ignore */ }
        });

        // Wait for completion
        const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
          emitter.once('done', () => resolve({ ok: true }));
          emitter.once('error', (err: Error) => resolve({ ok: false, error: err?.message }));
        });

        // Release worker
        try {
          const mgr = getWorkerManager();
          mgr.release(workerKey);
        } catch { /* best-effort */ }

        if (!result.ok) {
          return {
            content: [{
              type: 'text' as const,
              text: `❌ [${label}] 子任务失败: ${result.error || 'unknown error'}`
            }],
            isError: true
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: `✅ [${label}] 任务完成:\n\n${textBuffer.trim() || '(sub-agent produced no text output)'}`
          }]
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: `❌ [${label}] 无法启动子 agent: ${(err as Error).message.slice(0, 500)}`
          }],
          isError: true
        };
      }
    }
  };
}
