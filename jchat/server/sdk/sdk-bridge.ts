// jchat/server/sdk/sdk-bridge.ts
//
// Main-process entry for SDK interactions. Owns the default worker spawner
// (which initializes the workspace via skill-loader, builds the env via
// worker-env, forks the worker subprocess, and wires up its IPC socket) and
// re-exports the singleton `WorkerManager` consumed by the conversation
// dispatcher.
//
// Stream contract:
//   `runQuery(...)` returns an EventEmitter-flavored object that emits
//   `event` (raw SDK event), `done`, and `error`. The conversation layer
//   bridges these to WS deltas/snapshots.

import { spawn as childSpawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import net, { type Server, type Socket } from 'node:net';
import { unlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { config } from '../config.js';
import { logger } from '../logger.js';
import { initializeWorkspace, type ActiveSkill } from './skill-loader.js';
import { buildWorkerEnv } from './worker-env.js';
import {
  createWorkerManager,
  type WorkerHandle,
  type WorkerKey,
  type WorkerManager
} from './worker-manager.js';

// ----------------------------------------------------------------------
// Constants & paths
// ----------------------------------------------------------------------

/** `dirname(import.meta.url)`-equivalent for ESM. */
function moduleDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

/**
 * Resolve the worker script path. In production we run compiled JS at
 * `dist/server/sdk/sdk-worker.js`; in dev (tsx) we run the TS source.
 */
function resolveWorkerScript(): string {
  // If this module itself is .js (compiled), the sibling worker is .js too.
  const here = moduleDir();
  const isCompiled = here.includes(`${path.sep}dist${path.sep}`) || here.endsWith(`${path.sep}dist`);
  return path.join(here, isCompiled ? 'sdk-worker.js' : 'sdk-worker.ts');
}

/** Path to the project's skills root used by `initializeWorkspace`. */
function skillsRoot(): string {
  // <repo>/jchat/server/skills/
  return path.resolve(moduleDir(), '..', 'skills');
}

// ----------------------------------------------------------------------
// Default spawner — fork a real subprocess per worker
// ----------------------------------------------------------------------

interface SpawnerDeps {
  /** Override skills root (tests). */
  skillsRoot?: string;
  /** Override sessions root (tests). */
  sessionsRoot?: string;
  /** Override worker script path (tests). */
  workerScript?: string;
  /** Override active-skill resolver (tests/dev). Defaults to []. */
  resolveActiveSkills?: (key: WorkerKey) => Promise<ActiveSkill[]>;
}

type WorkerMessageHandler = (msg: Record<string, unknown>) => void;

interface SpawnedWorker extends WorkerHandle {
  process: ChildProcess;
  server: Server;
  /** The workspace root directory where the agent's files live. */
  workspacePath: string;
  /** Fired when the worker reports `{ type: 'ready' }`. */
  readyPromise: Promise<void>;
  /** Subscribe a handler to every JSON-line message coming from the worker. */
  subscribe: (handler: WorkerMessageHandler) => () => void;
}

export function defaultWorkerSpawner(deps: SpawnerDeps = {}) {
  const sessionsRootPath = deps.sessionsRoot || config.sessionsRoot;
  const skillsRootPath = deps.skillsRoot || skillsRoot();
  const workerScriptPath = deps.workerScript || resolveWorkerScript();
  const resolveActiveSkills = deps.resolveActiveSkills || (async () => [] as ActiveSkill[]);

  return async function spawnOne(key: WorkerKey): Promise<WorkerHandle> {
    const sessionId = `${key.userId}-${key.agentId}-${key.conversationId}-${crypto.randomUUID().slice(0, 8)}`;
    const activeSkills = await resolveActiveSkills(key);

    const wsPath = await initializeWorkspace({
      sessionsRoot: sessionsRootPath,
      sessionId,
      activeSkills,
      skillsRoot: skillsRootPath
    });

    const socketId = crypto.randomUUID();
    const socketPath = path.join(os.tmpdir(), `jchat-worker-${socketId}.sock`);
    try {
      await unlink(socketPath);
    } catch { /* ENOENT */ }

    const messageHandlers = new Set<WorkerMessageHandler>();

    const handle: SpawnedWorker = {
      id: socketId,
      socketPath,
      pid: undefined,
      workspacePath: wsPath,
      server: net.createServer(),
      process: undefined as unknown as ChildProcess,
      readyPromise: undefined as unknown as Promise<void>,
      sendCommand: async () => ({ ok: false, error: 'not yet ready' }),
      dispose: async () => { /* replaced below */ },
      subscribe: (handler) => {
        messageHandlers.add(handler);
        return () => {
          messageHandlers.delete(handler);
        };
      }
    };

    // Wire up server BEFORE spawning the child.
    let conn: Socket | null = null;
    let buf = '';
    let readyResolved = false;
    let resolveReady: () => void = () => undefined;
    let rejectReady: (err: Error) => void = () => undefined;
    handle.readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    handle.server.on('connection', (c: Socket) => {
      conn = c;
      c.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.type === 'ready') { readyResolved = true; resolveReady(); }
          for (const h of messageHandlers) h(msg);
        }
      });
      c.on('error', () => { /* ignore */ });
    });

    await new Promise<void>((resolve, reject) => {
      handle.server.once('error', reject);
      handle.server.listen(socketPath, () => resolve());
    });

    const env = buildWorkerEnv({ JCHAT_SESSIONS_ROOT: sessionsRootPath });
    // In dev / tests the worker script is the .ts source; node can't run TS
    // directly, so we register tsx as an ESM loader. In production the worker
    // is .js (compiled) and runs without the loader.
    const isTsSource = workerScriptPath.endsWith('.ts');
    const nodeArgs: string[] = [];
    if (isTsSource) {
      try {
        const tsxLoader = path.resolve(moduleDir(), '..', '..', 'node_modules', 'tsx', 'dist', 'loader.mjs');
        const tsxPreflight = path.resolve(moduleDir(), '..', '..', 'node_modules', 'tsx', 'dist', 'preflight.cjs');
        nodeArgs.push('--require', tsxPreflight, '--import', `file://${tsxLoader}`);
      } catch (e) {
        logger.warn({ err: (e as Error).message }, 'failed to set up tsx loader for worker; .ts worker may not start');
      }
    }
    nodeArgs.push(workerScriptPath, socketPath);
    const child = childSpawn(process.execPath, nodeArgs, {
      env,
      cwd: wsPath,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    handle.process = child;
    handle.pid = child.pid;

    child.stdout?.on('data', (d: Buffer) => logger.debug({ workerId: socketId }, `[worker stdout] ${d.toString().trim()}`));
    child.stderr?.on('data', (d: Buffer) => logger.debug({ workerId: socketId }, `[worker stderr] ${d.toString().trim()}`));
    child.on('exit', (code, signal) => {
      logger.info({ workerId: socketId, code, signal }, 'worker exited');
      if (!readyResolved) {
        // Startup crash before the 'ready' handshake — reject the
        // readyPromise so the spawnPromise settles and the inflight
        // map is cleaned up. Do NOT call notifyWorkerExit because
        // the pool entry doesn't exist yet.
        rejectReady(new Error(`worker exited before ready (code=${code} signal=${signal})`));
        return;
      }
      // Tell the pool the worker is gone so the dead handle gets evicted
      // immediately. Otherwise the entry survives until idleMs and the next
      // acquire() returns it, whose sendCommand throws "worker socket not
      // connected" and forces a v1 fallback even though spawning a fresh
      // worker would have worked.
      try {
        _manager?.notifyWorkerExit(socketId);
      } catch (e) {
        logger.warn({ workerId: socketId, err: (e as Error).message }, 'notifyWorkerExit failed');
      }
    });

    handle.sendCommand = async (msg) => {
      if (!conn || conn.destroyed) throw new Error('worker socket not connected');
      conn.write(JSON.stringify(msg) + '\n');
      return { ok: true };
    };

    handle.dispose = async () => {
      try {
        if (conn && !conn.destroyed) {
          conn.write(JSON.stringify({ type: 'shutdown' }) + '\n');
        }
      } catch { /* */ }
      try {
        if (!child.killed) child.kill('SIGTERM');
      } catch { /* */ }
      try {
        handle.server.close();
      } catch { /* */ }
      try {
        await unlink(socketPath);
      } catch { /* */ }
      // Reclaim the workspace dir we created in initializeWorkspace().
      // Without this, every disposed/evicted worker leaves behind
      // <sessionsRoot>/<sessionId>/ (containing .claude/skills/ symlinks +
      // sentinel CLAUDE.md). On a long-running daemon those directories
      // pile up indefinitely.
      try {
        await rm(wsPath, { recursive: true, force: true });
      } catch (e) {
        logger.warn({ wsPath, err: (e as Error).message }, 'workspace rm failed (non-fatal)');
      }
    };

    // Wait for ready handshake before returning.
    await handle.readyPromise;

    return handle;
  };
}

// ----------------------------------------------------------------------
// Singleton manager
// ----------------------------------------------------------------------

let _manager: WorkerManager | null = null;

/**
 * Default skill resolver — looks up `agent_skills` for the current agent and
 * returns the enabled skill names. Imported lazily to avoid a cycle at module
 * load (sdk-bridge ← worker-manager ← config; agent-repo ← db).
 */
async function defaultResolveActiveSkills(key: WorkerKey): Promise<ActiveSkill[]> {
  try {
    const mod = await import('../agent/agent-repo.js');
    return await mod.getActiveSkillsForAgent(key.agentId);
  } catch (e) {
    logger.warn({ err: (e as Error).message, agentId: key.agentId }, 'defaultResolveActiveSkills failed; using empty skill list');
    return [];
  }
}

/** Get the lazily-initialized singleton worker manager. */
export function getWorkerManager(): WorkerManager {
  if (_manager) return _manager;
  _manager = createWorkerManager({
    spawn: defaultWorkerSpawner({ resolveActiveSkills: defaultResolveActiveSkills })
  });
  return _manager;
}

/** Shutdown the singleton (for graceful daemon shutdown). */
export async function shutdownWorkerManager(): Promise<void> {
  if (_manager) {
    await _manager.shutdown();
    _manager = null;
  }
}

// ----------------------------------------------------------------------
// Run query — public entry for the conversation dispatcher.
// ----------------------------------------------------------------------

export interface RunQueryOptions {
  key: WorkerKey;
  /** Initial user message (SDK message shape). */
  prompt: unknown;
  /** Additional SDK options (model, system prompt, mcp descriptors, etc.). */
  sdkOptions?: Record<string, unknown>;
  /** Single-turn convenience flag. */
  singleTurn?: boolean;
}

/**
 * Run an SDK query. Returns an EventEmitter-style object emitting:
 *   - `event(rawSdkEvent)` — every SDK stream event from the worker
 *   - `done(result?)` — on `query_done` from the worker
 *   - `error(err)` — on `query_error` from the worker, transport failure, or
 *                    SDK init failure
 *
 * The emitter also exposes the underlying worker handle via `.worker` for
 * advanced callers (e.g. permission_response routing). Callers MUST listen
 * for `done` / `error` and call `mgr.release(opts.key)` themselves — this
 * function does not auto-release so callers can decide when the slot is
 * truly free (e.g. after persisting the final message).
 */
export async function runQuery(opts: RunQueryOptions): Promise<EventEmitter & { worker: WorkerHandle }> {
  const mgr = getWorkerManager();
  const worker = await mgr.acquire(opts.key);
  const emitter = new EventEmitter() as EventEmitter & { worker: WorkerHandle };
  emitter.worker = worker;
  // Permanent "error swallower". Prevents the Node process from crashing
  // with `Unhandled 'error' event` when the orchestrator has already
  // resolved/rejected its watchdog Promise (and removed its listeners) but a
  // late `query_error` IPC still arrives from the worker. The orchestrator's
  // own `once('error')` listener (attached inside the watchdog Promise) is
  // still the one that drives orchestration; this listener just catches the
  // tail.
  emitter.on('error', (e) => {
    logger.debug({ err: (e as Error)?.message }, 'sdk emitter error (post-settle, swallowed)');
  });

  // Build a (serverName, toolName) → handler index from descriptors so we can
  // execute tool calls in the daemon when the worker proxies one over IPC.
  // Without this dispatch, every MCP tool call hangs forever — the worker
  // sends `mcp_tool_call` and waits for `mcp_tool_result` that no one writes.
  type ToolDef = {
    name: string;
    handler?: (args: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
  };
  const handlerIndex = new Map<string, ToolDef['handler']>();
  const descriptorsForIndex = (opts.sdkOptions?.mcpDescriptors as Array<{ serverName: string; tools: ToolDef[] }> | undefined) ?? [];
  for (const desc of descriptorsForIndex) {
    for (const t of desc.tools ?? []) {
      if (typeof t.handler === 'function') {
        handlerIndex.set(`${desc.serverName}::${t.name}`, t.handler);
      }
    }
  }

  const wHandle = worker as unknown as SpawnedWorker;
  if (!wHandle.process || typeof wHandle.subscribe !== 'function') {
    // Test/in-memory worker — just call sendCommand and finish.
    const { mcpDescriptors, ...optionsForSdk } = (opts.sdkOptions ?? {}) as {
      mcpDescriptors?: unknown;
      [k: string]: unknown;
    };
    void worker
      .sendCommand({
        type: 'query_start',
        prompt: opts.prompt,
        options: optionsForSdk,
        mcpDescriptors,
        singleTurn: !!opts.singleTurn
      })
      .then(() => emitter.emit('done'))
      .catch((e) => emitter.emit('error', e));
    return emitter;
  }

  // ----- Worker → emitter pump -----
  // Subscribe to JSON-lines messages from the worker subprocess. Each
  // sdk_event from the worker is forwarded to the emitter as `event`. Lifecycle
  // markers (query_done / query_error) become emitter `done` / `error`.
  let settled = false;
  // We defer error emissions via queueMicrotask so that the orchestrator (which
  // calls `await runQuery(...)` and only then attaches `once('error')` inside
  // the watchdog Promise) has a chance to attach its listener. Without this,
  // a synchronous `query_error` from the worker would crash the daemon with
  // an unhandled 'error' event. `done` is also deferred for symmetry.
  const unsubscribe = wHandle.subscribe((m) => {
    if (settled) return;
    const t = m.type as string | undefined;
    if (t === 'sdk_event') {
      // The worker sends `{ type: 'sdk_event', event: <SDKMessage> }`.
      emitter.emit('event', (m as { event: unknown }).event);
      return;
    }
    if (t === 'context_usage') {
      emitter.emit('context_usage', (m as { data: unknown }).data);
      return;
    }
    if (t === 'permission_request') {
      emitter.emit('permission_request', m);
      return;
    }
    if (t === 'ask_user_request') {
      emitter.emit('ask_user_request', m);
      return;
    }
    if (t === 'elicitation_request') {
      emitter.emit('elicitation_request', m);
      return;
    }
    if (t === 'mcp_tool_call') {
      // Execute the tool handler in the daemon and proxy the result back to
      // the worker. Errors become an `isError: true` text payload so the
      // model sees a useful message instead of hanging.
      const call = m as { requestId: string; serverName: string; toolName: string; args: unknown };
      const fn = handlerIndex.get(`${call.serverName}::${call.toolName}`);
      const reply = (result: { content: Array<{ type: 'text'; text: string }>; isError?: boolean } | { error: string }) => {
        try {
          void worker.sendCommand({ type: 'mcp_tool_result', requestId: call.requestId, ...result });
        } catch (e) {
          logger.warn({ err: (e as Error).message, toolName: call.toolName }, 'mcp_tool_result send failed');
        }
      };
      if (!fn) {
        reply({ error: `unknown MCP tool ${call.serverName}::${call.toolName}` });
      } else {
        Promise.resolve()
          .then(() => fn(call.args))
          .then((r) => reply(r))
          .catch((err) => reply({ error: (err as Error)?.message ?? 'mcp tool threw' }));
      }
      // Also forward to the emitter for any external observers (logging/metrics).
      emitter.emit('mcp_tool_call', m);
      return;
    }
    if (t === 'query_done') {
      settled = true;
      try { unsubscribe(); } catch { /* ignore */ }
      detachExitListener();
      queueMicrotask(() => emitter.emit('done'));
      return;
    }
    if (t === 'query_error') {
      settled = true;
      const err = new Error(String((m as { error?: string }).error || 'sdk worker error'));
      (err as Error & { stderr?: string; exitCode?: number | null }).stderr = (m as { stderr?: string }).stderr;
      (err as Error & { stderr?: string; exitCode?: number | null }).exitCode = (m as { exitCode?: number | null }).exitCode ?? null;
      try { unsubscribe(); } catch { /* ignore */ }
      detachExitListener();
      queueMicrotask(() => emitter.emit('error', err));
      return;
    }
    // 'ready' and unknown types are ignored.
  });

  // Worker process death: if the subprocess exits or the socket closes
  // BEFORE we've received an explicit query_done/query_error, the orchestrator
  // would otherwise await forever and the message stays 'partial' in DB.
  // Surface as error so callers can finalize the message.
  const onProcessExit = (code: number | null, signal: string | null) => {
    if (settled) return;
    settled = true;
    try { unsubscribe(); } catch { /* ignore */ }
    const err = new Error(`sdk worker exited unexpectedly (code=${code} signal=${signal})`);
    (err as Error & { exitCode?: number | null; signal?: string | null }).exitCode = code;
    (err as Error & { exitCode?: number | null; signal?: string | null }).signal = signal;
    queueMicrotask(() => emitter.emit('error', err));
  };
  // Workers are pooled by (userId, agentId, conversationId) and survive
  // across queries. We attach a fresh 'exit' listener per runQuery, so we
  // MUST remove it once that query is settled — otherwise a long-lived
  // worker accumulates 1 listener per query and node fires the
  // MaxListenersExceededWarning at 11, plus all the dead handlers run on
  // eventual exit. The settled-set helpers in the subscribe loop call
  // detachExitListener() exactly once.
  const detachExitListener = () => {
    if (wHandle.process) {
      try { wHandle.process.removeListener('exit', onProcessExit); } catch { /* ignore */ }
    }
  };
  if (wHandle.process) {
    wHandle.process.on('exit', onProcessExit);
  }

  // Kick off the query. If sendCommand throws (socket dead), surface as error.
  //
  // mcpDescriptors must travel at the *top level* of the IPC envelope — the
  // worker's QueryStartMsg shape reads `msg.mcpDescriptors`, not
  // `msg.options.mcpDescriptors`. Anything left inside `options` gets passed
  // straight into `sdk.query({ ..., options })` and silently ignored.
  try {
    const { mcpDescriptors, ...optionsForSdk } = (opts.sdkOptions ?? {}) as {
      mcpDescriptors?: unknown;
      [k: string]: unknown;
    };
    await worker.sendCommand({
      type: 'query_start',
      prompt: opts.prompt,
      options: optionsForSdk,
      mcpDescriptors,
      singleTurn: !!opts.singleTurn
    });
  } catch (e) {
    if (!settled) {
      settled = true;
      try { unsubscribe(); } catch { /* ignore */ }
      detachExitListener();
      // Defer so listeners attached after `await runQuery(...)` get the event.
      queueMicrotask(() => emitter.emit('error', e));
    }
  }

  return emitter;
}
