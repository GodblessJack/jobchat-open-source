// jchat/server/sdk/sdk-worker.ts
//
// SDK worker subprocess. **Runs as a Node child process** — receives a Unix
// socket path on argv, connects, then awaits commands from the daemon and
// streams SDK events back as JSON lines.
//
// Stripped from clay/lib/yoke/adapters/claude-worker.js + sdk-worker.js:
//   - Codex adapter (jchat is Claude-only)
//   - Linux UID/GID switching (jchat is single-user-namespace)
//   - OS-level user resolution
//
// Kept:
//   - JSON-lines protocol over Unix domain socket
//   - Async message queue for streaming user input
//   - SDK `query()` invocation with abortController
//   - `canUseTool` permission flow (delegates to daemon)
//   - `onElicitation` flow (delegates to daemon)
//   - Reconstruction of SDK MCP servers from descriptors with IPC-proxied
//     tool handlers (so the daemon owns the real MCP servers)
//
// **Build target**: this file ships compiled at `dist/server/sdk/sdk-worker.js`
// and is spawned via `node dist/server/sdk/sdk-worker.js <socket>`. In dev
// `tsx` can run the TS source directly. The `worker-manager.ts` resolves the
// correct path based on `NODE_ENV`.
//
// Env: this process MUST be launched with the allowlisted env from
// `worker-env.ts` — never the daemon's full env.

import net, { type Socket } from 'node:net';
import crypto from 'node:crypto';
import { writeSync } from 'node:fs';

// ======================================================================
// Boot diagnostics — write directly to fd2 so we get logs even if the
// stderr stream is buffered/closed early.
// ======================================================================

const _bootTs = Date.now();
function diag(msg: string): void {
  try {
    writeSync(2, `[sdk-worker] ${msg}\n`);
  } catch {
    /* fd 2 closed */
  }
}
diag(`BOOT pid=${process.pid} argv=${process.argv.slice(1).join(' ')} bootTs=${_bootTs}`);

const socketPath = process.argv[2];
if (!socketPath) {
  diag('Missing socket path argument');
  process.exit(1);
}

// ======================================================================
// State
// ======================================================================

type SdkModule = typeof import('@anthropic-ai/claude-agent-sdk');

let sdkModulePromise: Promise<SdkModule> | null = null;
// Note: SDK types are referenced loosely here to keep this file standalone;
// production builds re-introduce strong typing from the SDK.
let queryInstance: { [k: string]: unknown } | null = null;
let messageQueue: AsyncMessageQueue<unknown> | null = null;
let abortController: AbortController | null = null;
const pendingPermissions = new Map<string, (v: unknown) => void>();
const pendingAskUser = new Map<string, (v: unknown) => void>();
const pendingElicitations = new Map<string, (v: unknown) => void>();
const pendingMcpCalls = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let queryInFlight = false;
let conn: Socket | null = null;
let buffer = '';

// ======================================================================
// Async message queue (push() to producer, async-iterate to consumer)
// ======================================================================

interface AsyncMessageQueue<T> extends AsyncIterable<T> {
  push: (msg: T) => void;
  end: () => void;
}

function createMessageQueue<T>(): AsyncMessageQueue<T> {
  const queue: T[] = [];
  let waiting: ((r: IteratorResult<T>) => void) | null = null;
  let ended = false;
  return {
    push(msg) {
      if (waiting) {
        const r = waiting;
        waiting = null;
        r({ value: msg, done: false });
      } else {
        queue.push(msg);
      }
    },
    end() {
      ended = true;
      if (waiting) {
        const r = waiting;
        waiting = null;
        r({ value: undefined as unknown as T, done: true });
      }
    },
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift() as T, done: false });
          }
          if (ended) {
            return Promise.resolve({ value: undefined as unknown as T, done: true });
          }
          return new Promise((resolve) => {
            waiting = resolve;
          });
        }
      };
    }
  };
}

// ======================================================================
// SDK loader
// ======================================================================

function getSdk(): Promise<SdkModule> {
  if (!sdkModulePromise) {
    sdkModulePromise = import('@anthropic-ai/claude-agent-sdk');
  }
  return sdkModulePromise;
}

// ======================================================================
// IPC helpers
// ======================================================================

function sendToDaemon(msg: Record<string, unknown>): void {
  if (!conn || conn.destroyed) return;
  try {
    conn.write(JSON.stringify(msg) + '\n');
  } catch (e) {
    diag(`Failed to send: ${(e as Error).message}`);
  }
}

// ======================================================================
// Permission / elicitation / ask-user delegation
// ======================================================================

function canUseTool(
  toolName: string,
  input: unknown,
  opts: { toolUseID?: string; decisionReason?: string; signal?: AbortSignal }
): Promise<unknown> {
  const requestId = crypto.randomUUID();
  sendToDaemon({
    type: 'permission_request',
    requestId,
    toolName,
    input,
    toolUseId: opts.toolUseID || '',
    decisionReason: opts.decisionReason || ''
  });
  return new Promise((resolve) => {
    pendingPermissions.set(requestId, resolve);
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => {
        if (pendingPermissions.delete(requestId)) {
          resolve({ behavior: 'deny', message: 'Cancelled' });
        }
      });
      if (opts.signal.aborted) {
        pendingPermissions.delete(requestId);
        resolve({ behavior: 'deny', message: 'Cancelled' });
      }
    }
  });
}

function onElicitation(
  request: {
    serverName: string;
    message?: string;
    mode?: string;
    url?: string | null;
    elicitationId?: string | null;
    requestedSchema?: unknown;
  },
  opts: { signal?: AbortSignal }
): Promise<unknown> {
  const requestId = crypto.randomUUID();
  sendToDaemon({
    type: 'elicitation_request',
    requestId,
    serverName: request.serverName,
    message: request.message,
    mode: request.mode || 'form',
    url: request.url ?? null,
    elicitationId: request.elicitationId ?? null,
    requestedSchema: request.requestedSchema ?? null
  });
  return new Promise((resolve) => {
    pendingElicitations.set(requestId, resolve);
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => {
        if (pendingElicitations.delete(requestId)) {
          resolve({ action: 'reject' });
        }
      });
      if (opts.signal.aborted) {
        pendingElicitations.delete(requestId);
        resolve({ action: 'reject' });
      }
    }
  });
}

// ======================================================================
// MCP descriptor → SDK MCP server (IPC-proxied tool handlers)
// ======================================================================

interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, { type?: string; enum?: string[]; description?: string }>; required?: string[] };
}
interface McpServerDescriptor {
  serverName: string;
  tools: McpToolDescriptor[];
}

function buildZodShape(z: typeof import('zod').z, inputSchema?: McpToolDescriptor['inputSchema']): Record<string, unknown> {
  if (!inputSchema) return {};
  // Two accepted shapes:
  //   (a) JSON-Schema-style:   { properties: { foo: {type, enum?, description?} }, required?: string[] }
  //   (b) Zod-shape pass-through: a plain object whose values are already
  //       Zod schemas (have a `_def` property). All jchat tool defs use (b).
  // Without the (b) branch the SDK registers every MCP tool with an empty
  // input schema → model args get stripped before reaching the handler →
  // tools silently receive `{}` and fail upstream.
  const isJsonSchema = typeof (inputSchema as { properties?: unknown }).properties === 'object' && (inputSchema as { properties?: unknown }).properties !== null;
  if (!isJsonSchema) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(inputSchema as Record<string, unknown>)) {
      if (v && typeof v === 'object' && ('_def' in (v as object) || 'def' in (v as object))) out[k] = v;
    }
    return out;
  }
  const props = (inputSchema as { properties: Record<string, { type?: string; enum?: string[]; description?: string }>; required?: string[] }).properties;
  const required = new Set((inputSchema as { required?: string[] }).required || []);
  const shape: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(props)) {
    let field: import('zod').ZodTypeAny;
    if (p.type === 'number' || p.type === 'integer') {
      field = z.number();
    } else if (p.type === 'boolean') {
      field = z.boolean();
    } else if (p.type === 'array') {
      field = z.array(z.any());
    } else if (p.type === 'object') {
      field = z.record(z.string(), z.any());
    } else if (p.enum && p.enum.length > 0) {
      // zod 4: z.enum needs the runtime list as-is.
      field = z.enum(p.enum as [string, ...string[]]);
    } else {
      field = z.string();
    }
    if (p.description) field = field.describe(p.description);
    if (!required.has(k)) field = field.optional();
    shape[k] = field;
  }
  return shape;
}

/**
 * Hard ceiling on a single MCP tool call. The daemon's reply path catches
 * sendCommand failures and only logs — without a timeout here the worker
 * would wait forever and the SDK query would hang until the orchestrator's
 * 5-min watchdog killed the whole reply. 60s is enough headroom for legit
 * tool work (browser_fetch of a slow page, multi-step distillation) while
 * keeping a single dropped IPC reply from torching the user's turn.
 */
const MCP_TOOL_TIMEOUT_MS = 60_000;

function createMcpProxyHandler(serverName: string, toolName: string) {
  return (args: unknown) => {
    if (toolName === 'create_contact') {
      // diagnostic: log what the SDK CLI hands to our proxy
      const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
      diag(`[mcp-proxy:create_contact] keys=${Object.keys(a).join(',')} name=${typeof a.name === 'string' ? a.name.slice(0, 30) : '<missing>'} skill_md_len=${typeof a.skill_md === 'string' ? a.skill_md.length : 'null'}`);
    }
    return new Promise((resolve, reject) => {
      const requestId = `mcp_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
      const timer = setTimeout(() => {
        if (pendingMcpCalls.delete(requestId)) {
          reject(new Error(`MCP tool ${serverName}::${toolName} timed out after ${MCP_TOOL_TIMEOUT_MS}ms`));
        }
      }, MCP_TOOL_TIMEOUT_MS);
      timer.unref?.();
      const wrapped = {
        resolve: (v: unknown) => { clearTimeout(timer); resolve(v); },
        reject: (e: Error) => { clearTimeout(timer); reject(e); }
      };
      pendingMcpCalls.set(requestId, wrapped);
      sendToDaemon({
        type: 'mcp_tool_call',
        requestId,
        serverName,
        toolName,
        args
      });
    });
  };
}

async function buildMcpServersFromDescriptors(
  sdk: SdkModule,
  descriptors: McpServerDescriptor[] | undefined
): Promise<Record<string, unknown> | null> {
  if (!descriptors || descriptors.length === 0) return null;
  const zodMod = await import('zod');
  const z = zodMod.z;
  const createSdkMcpServer = (sdk as unknown as { createSdkMcpServer?: (cfg: unknown) => unknown }).createSdkMcpServer;
  const toolFn = (sdk as unknown as { tool?: (...a: unknown[]) => unknown }).tool;
  if (!createSdkMcpServer || !toolFn) {
    diag('SDK missing createSdkMcpServer or tool helper');
    return null;
  }
  const servers: Record<string, unknown> = {};
  for (const desc of descriptors) {
    const tools: unknown[] = [];
    for (const td of desc.tools) {
      const shape = buildZodShape(z, td.inputSchema);
      tools.push(toolFn(td.name, td.description || td.name, shape, createMcpProxyHandler(desc.serverName, td.name)));
    }
    if (tools.length > 0) {
      servers[desc.serverName] = createSdkMcpServer({ name: desc.serverName, version: '1.0.0', tools });
    }
  }
  return Object.keys(servers).length > 0 ? servers : null;
}

// ======================================================================
// Query handling
// ======================================================================

interface QueryStartMsg {
  type: 'query_start';
  prompt?: unknown;
  options?: Record<string, unknown>;
  mcpDescriptors?: McpServerDescriptor[];
  singleTurn?: boolean;
}

async function handleQueryStart(msg: QueryStartMsg): Promise<void> {
  if (queryInFlight) {
    sendToDaemon({
      type: 'query_error',
      error: 'Worker is busy processing a query',
      exitCode: null,
      stderr: null
    });
    return;
  }
  queryInFlight = true;

  let sdk: SdkModule;
  try {
    sdk = await getSdk();
  } catch (e) {
    queryInFlight = false;
    sendToDaemon({
      type: 'query_error',
      error: `Failed to load SDK: ${(e as Error).message}`,
      exitCode: null,
      stderr: null
    });
    return;
  }

  messageQueue = createMessageQueue<unknown>();
  abortController = new AbortController();

  if (msg.prompt !== undefined) {
    messageQueue.push(msg.prompt);
  }
  diag(`prompt pushed, building MCP servers... mcpDescriptors=${msg.mcpDescriptors ? (msg.mcpDescriptors as Array<unknown>).length : 0} servers`);

  let mcpServers: Record<string, unknown> | null;
  try {
    mcpServers = await buildMcpServersFromDescriptors(sdk, msg.mcpDescriptors);
  } catch (e) {
    queryInFlight = false;
    sendToDaemon({
      type: 'query_error',
      error: `Failed to build MCP servers: ${(e as Error).message}`,
      exitCode: null,
      stderr: null
    });
    return;
  }
  diag(`MCP servers built: ${mcpServers ? Object.keys(mcpServers).join(',') : 'none'}`);

  const options: Record<string, unknown> = { ...(msg.options || {}) };
  if (mcpServers) options.mcpServers = mcpServers;
  options.abortController = abortController;

  // Only install canUseTool when permissionMode is NOT bypassPermissions.
  // When bypassPermissions is set, the SDK handles auto-allow internally,
  // and an explicit canUseTool callback overrides it, causing every tool
  // call to hang waiting for a permission_response that never arrives.
  const permMode = (msg.options as Record<string, unknown> | undefined)?.permissionMode as string | undefined;
  const bypass = permMode === 'bypassPermissions';
  diag(`permissionMode=${permMode || 'default'} bypass=${bypass}`);

  if (!bypass) {
    options.canUseTool = (toolName: string, input: unknown, toolOpts: { toolUseID?: string; signal?: AbortSignal }) => {
      if (toolName === 'AskUserQuestion') {
        const toolUseId = toolOpts.toolUseID || '';
        sendToDaemon({ type: 'ask_user_request', toolUseId, input });
        return new Promise((resolve) => {
          pendingAskUser.set(toolUseId, resolve);
          if (toolOpts.signal) {
            toolOpts.signal.addEventListener('abort', () => {
              if (pendingAskUser.delete(toolUseId)) {
                resolve({ behavior: 'deny', message: 'Cancelled' });
              }
            });
            if (toolOpts.signal.aborted) {
              pendingAskUser.delete(toolUseId);
              resolve({ behavior: 'deny', message: 'Cancelled' });
            }
          }
        });
      }
      return canUseTool(toolName, input, toolOpts);
    };
  }
  options.onElicitation = (request: {
    serverName: string;
    message?: string;
    mode?: string;
    url?: string | null;
    elicitationId?: string | null;
    requestedSchema?: unknown;
  }, elicitOpts: { signal?: AbortSignal }) =>
    onElicitation(request, elicitOpts);

  diag(`calling sdk.query() with options keys: ${Object.keys(options).join(',')}`);
  try {
    queryInstance = (sdk as unknown as { query: (cfg: unknown) => Record<string, unknown> }).query({
      prompt: messageQueue,
      options
    });
    diag('sdk.query() returned, starting iteration');
  } catch (e) {
    queryInFlight = false;
    sendToDaemon({
      type: 'query_error',
      error: `Failed to create query: ${(e as Error).message}`,
      exitCode: null,
      stderr: null
    });
    queryInstance = null;
    messageQueue = null;
    abortController = null;
    return;
  }

  if (msg.singleTurn) {
    messageQueue.end();
    diag('messageQueue.end() called (singleTurn)');
  }

  try {
    for await (const event of queryInstance as unknown as AsyncIterable<unknown>) {
      sendToDaemon({ type: 'sdk_event', event });
    }
    // Try to fetch context usage breakdown before clearing queryInstance.
    try {
      const q = queryInstance as { getContextUsage?: () => Promise<unknown> } | null;
      if (q && typeof q.getContextUsage === 'function') {
        const ctxUsage = await q.getContextUsage();
        sendToDaemon({ type: 'context_usage', data: ctxUsage });
      }
    } catch (e) {
      diag(`getContextUsage failed (non-fatal): ${(e as Error).message}`);
    }
    sendToDaemon({ type: 'query_done' });
  } catch (err) {
    const e = err as { message?: string; exitCode?: number; stderr?: string };
    sendToDaemon({
      type: 'query_error',
      error: e.message || String(err),
      exitCode: e.exitCode ?? null,
      stderr: e.stderr ?? null
    });
  } finally {
    queryInFlight = false;
    queryInstance = null;
    messageQueue = null;
    abortController = null;
    pendingPermissions.clear();
    pendingAskUser.clear();
    pendingElicitations.clear();
    pendingMcpCalls.clear();
  }
}

// ======================================================================
// Message handler
// ======================================================================

function handleMessage(msg: { type?: string; [k: string]: unknown }): void {
  diag(`MSG: ${msg.type || '?'}`);
  switch (msg.type) {
    case 'query_start':
      void handleQueryStart(msg as unknown as QueryStartMsg).catch((e) =>
        diag(`handleQueryStart rejected: ${(e as Error).message}`)
      );
      break;
    case 'push_message':
      if (messageQueue) messageQueue.push((msg as { content?: unknown }).content);
      break;
    case 'end_messages':
      if (messageQueue) messageQueue.end();
      break;
    case 'abort':
      if (abortController) abortController.abort();
      break;
    case 'permission_response': {
      const r = pendingPermissions.get((msg as { requestId: string }).requestId);
      if (r) {
        pendingPermissions.delete((msg as { requestId: string }).requestId);
        r((msg as { result: unknown }).result);
      }
      break;
    }
    case 'ask_user_response': {
      const r = pendingAskUser.get((msg as { toolUseId: string }).toolUseId);
      if (r) {
        pendingAskUser.delete((msg as { toolUseId: string }).toolUseId);
        r((msg as { result: unknown }).result);
      }
      break;
    }
    case 'elicitation_response': {
      const r = pendingElicitations.get((msg as { requestId: string }).requestId);
      if (r) {
        pendingElicitations.delete((msg as { requestId: string }).requestId);
        r((msg as { result: unknown }).result);
      }
      break;
    }
    case 'mcp_tool_result': {
      // daemon (sdk-bridge.ts) spreads `...result` at the top level, so the
      // envelope is `{type, requestId, content, isError}` on success or
      // `{type, requestId, error}` on failure — there is no nested `result`
      // key. Reading `m.result` always yielded undefined, so the SDK MCP
      // helper resolved every tool call with undefined and the model saw
      // empty tool output. Read content/isError directly.
      const m = msg as {
        requestId: string;
        error?: string;
        content?: Array<{ type: 'text'; text: string }>;
        isError?: boolean;
      };
      const p = pendingMcpCalls.get(m.requestId);
      if (!p) break;
      pendingMcpCalls.delete(m.requestId);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve({ content: m.content ?? [], ...(m.isError ? { isError: true } : {}) });
      break;
    }
    case 'shutdown':
      gracefulExit(0);
      break;
    default:
      diag(`Unknown message type: ${msg.type}`);
  }
}

// ======================================================================
// Lifecycle
// ======================================================================

let _exitScheduled = false;
const _keepAlive: NodeJS.Timeout = setInterval(() => { /* noop */ }, 30000);

function cleanup(): void {
  try {
    clearInterval(_keepAlive);
  } catch { /* */ }
  try {
    abortController?.abort();
  } catch { /* */ }
  try {
    messageQueue?.end();
  } catch { /* */ }
  try {
    if (conn && !conn.destroyed) conn.end();
  } catch { /* */ }
}

function gracefulExit(code: number): void {
  if (_exitScheduled) return;
  _exitScheduled = true;
  cleanup();
  // Grace period so the SDK can flush session state to disk.
  setTimeout(() => process.exit(code), 800).unref();
}

// ======================================================================
// Connect to daemon socket
// ======================================================================

diag(`Connecting to socket: ${socketPath} +${Date.now() - _bootTs}ms since boot`);
conn = net.connect(socketPath, () => {
  diag(`Connected, sending ready +${Date.now() - _bootTs}ms`);
  sendToDaemon({ type: 'ready' });
});

conn.on('data', (chunk: Buffer) => {
  buffer += chunk.toString('utf8');
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch (e) {
      diag(`Failed to parse message: ${(e as Error).message}`);
    }
  }
});

conn.on('error', (err: Error) => {
  diag(`Socket error: ${err.message}`);
  gracefulExit(1);
});

conn.on('close', () => {
  diag('EXIT REASON: socket closed');
  gracefulExit(0);
});

process.on('SIGTERM', () => {
  diag('EXIT REASON: SIGTERM');
  gracefulExit(0);
});
process.on('SIGINT', () => {
  diag('EXIT REASON: SIGINT');
  gracefulExit(0);
});
