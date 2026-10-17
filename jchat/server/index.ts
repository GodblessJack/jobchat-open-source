// jchat/server/index.ts
//
// Server entrypoint. Wires:
//   - HTTP server (express) with /health
//   - WS server (`ws` lib) under upgrade-time auth
//   - WsRouter (subscribe / command / heartbeat)
//   - Multi-tab realtime sync (Supabase Realtime → router fan-out)
//   - Worker manager idle-evict (started lazily by sdk-bridge on first use)
//   - Graceful shutdown on SIGINT/SIGTERM

import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { config } from './config.js';
import { logger } from './logger.js';
import { healthHandler } from './health.js';
import { WsRouter, type WsLike } from './ws/ws-router.js';
import { HeartbeatTracker } from './ws/heartbeat.js';
import { CommandDispatcher } from './ws/command-dispatcher.js';
import { registerAllSnapshotSources, setPresenceCountSource } from './ws/snapshot-sources.js';
import { setOrchestratorBroadcaster } from './conversation/agent-reply-orchestrator.js';
import { setStreamRegistryChangeListener } from './conversation/stream-registry.js';
import { MultiTabSync } from './realtime/multi-tab-sync.js';
import { attachAuthToSocket } from './auth/ws-auth-middleware.js';
import { CallWsProxy } from './call/ws-proxy.js';
import { JchatError, toErrorPayload } from '@shared/errors.js';
import cookieParser from 'cookie-parser';
import { mountProfileRoute } from './auth/profile-route.js';
import { mountAuthRoutes } from './auth/auth-routes.js';
import { mountFileRoutes } from './storage/local-files.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountCallRoutes } from './call/call-routes.js';
import { mountDistillationRoutes } from './distillation/distillation-routes.js';
import { startSweeper } from './call/sweeper.js';

// ===== HTTP =====

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.get('/health', healthHandler);
mountProfileRoute(app);
mountAuthRoutes(app);
mountFileRoutes(app);

const httpServer = createServer(app);

// ===== WS =====
//
// `noServer: true` lets us run our auth middleware on the upgrade event before
// the handshake completes — required so we can return 401 to unauthed clients.
const wss = new WebSocketServer({ noServer: true });

const heartbeat = new HeartbeatTracker<WsLike>({
  scanIntervalMs: 5000,
  staleAfterMs: config.staleConnectionMs
});

const dispatcher = new CommandDispatcher();
const router = new WsRouter({ heartbeat, dispatcher, log: logger });

// Register snapshot sources so subscribe(topic) returns real data.
registerAllSnapshotSources(router);

// Wire presence snapshot to read live multi-tab counts from the router.
setPresenceCountSource((userId: string) => router.getUserClients(userId).length);

// Wire agent-reply-orchestrator with router as broadcaster (for delta + snapshot push).
setOrchestratorBroadcaster({
  broadcastTopicChanged: (topic) => router.broadcastTopicChanged(topic),
  sendToUser: (userId, event) => router.sendToUser(userId, event)
});

// Push agent-status snapshot to all subscribers whenever the in-memory
// stream registry changes (a stream starts or ends). Cheap because the
// snapshot cache will dedupe identical projections via signature.
setStreamRegistryChangeListener(() => router.broadcastTopicChanged('agent-status'));

router.start();
const stopSweeper = startSweeper();

// Qwen-Omni WebSocket proxy for realtime voice/video calls.
// Routes /ws/call upgrade requests to a bidirectional WS proxy that
// forwards between browser and DashScope (Qwen-Omni Realtime API).
const callProxy = new CallWsProxy();

// Mount /api/call/* routes. Broadcaster is captured by closure so it resolves
// at call time (router is already in scope by this point).
mountCallRoutes(app, {
  broadcastConvSnapshot: (topic: string) => router.broadcastTopicChanged(topic)
});

mountDistillationRoutes(app, {
  broadcastConvSnapshot: (topic: string) => router.broadcastTopicChanged(topic)
});

// Static serve meeting/build at /call/*
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const meetingDist = process.env.MEETING_DIST_PATH
  ?? path.resolve(__dirname, '../../../meeting/build');
import('node:fs').then(fs => {
  if (fs.existsSync(meetingDist)) {
    app.use('/call', express.static(meetingDist));
    logger.info({ meetingDist }, 'mounted /call static');
  } else {
    logger.warn({ meetingDist }, '/call static disabled — meeting/build missing (dev mode is OK)');
  }
}).catch(err => logger.warn({ err }, 'static check failed'));

// Realtime fan-out. Snapshot sources are registered by sibling subagents'
// modules at their own boot time; until then, broadcastTopicChanged is a
// no-op for unregistered topics (the router throws VALIDATION_ERROR which
// is caught and logged).
const multiTabSync = new MultiTabSync({ router, log: logger });
multiTabSync.start();

httpServer.on('upgrade', (req, socket, head) => {
  const url = req.url || '/';
  const path = url.split('?')[0];

  // /ws/call — Qwen-Omni Realtime voice/video proxy.
  if (path === '/ws/call') {
    void callProxy.handleUpgrade(req, socket, head);
    return;
  }

  // Only /ws is handled below; reject everything else with 404.
  if (path !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    // Buffer any messages the client sends BEFORE async auth completes.
    // Without this, the client's eager subscribes (fired on WS open) race
    // ahead of router.attach()'s message listener registration and are lost.
    const preAttachBuffer: import('ws').RawData[] = [];
    const bufferingListener = (data: import('ws').RawData) => {
      preAttachBuffer.push(data);
    };
    ws.on('message', bufferingListener);

    // Run auth after the WS handshake completes so we can send a typed
    // error envelope to the client before closing. Sending an HTTP 401
    // would be cleaner, but `ws.handleUpgrade` has already replied 101.
    attachAuthToSocket(ws, req)
      .then(({ user, token }) => {
        ws.removeListener('message', bufferingListener);
        router.attach(ws as unknown as WsLike, { userId: user.id, email: user.email ?? null, jwt: token });
        // Replay buffered messages now that router has installed its own listener.
        for (const data of preAttachBuffer) {
          ws.emit('message', data);
        }
      })
      .catch((err) => {
        ws.removeListener('message', bufferingListener);
        const payload = toErrorPayload(
          err instanceof JchatError ? err : new JchatError('AUTH_INVALID', 'auth failed')
        );
        try {
          ws.send(JSON.stringify({ v: 1, type: 'error', code: payload.code, message: payload.message }));
          ws.close(1008, 'auth-failed');
        } catch {
          /* socket already closed */
        }
      });
  });
});

// ===== Boot =====

httpServer.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      nodeEnv: config.nodeEnv,
      sessionsRoot: config.sessionsRoot,
      embeddingProvider: config.embeddingProvider
    },
    'jchat-server listening'
  );
});

// ===== Graceful shutdown =====

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutdown initiated');

  // Stop accepting new WS upgrades + close existing.
  router.shutdown('server-shutdown');
  wss.close();

  // Stop realtime channel.
  await multiTabSync.stop().catch((err) => logger.warn({ err }, 'multi-tab-sync stop failed'));

  // Stop worker manager (lazy import — only relevant if any worker spawned).
  try {
    const sdkBridge = await import('./sdk/sdk-bridge.js');
    if (typeof sdkBridge.shutdownWorkerManager === 'function') {
      await sdkBridge.shutdownWorkerManager();
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'worker-manager shutdown skipped (module not loaded)');
  }

  // Tear down Slack Socket Mode, L4 monitors, and pending approval requests.
  // Dynamic import — slack-client may fail to load if @slack/* packages aren't installed.
  try {
    const { shutdownSlackClient } = await import('./lib/slack-client.js');
    await shutdownSlackClient();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'slack-client shutdown skipped');
  }

  stopSweeper();

  httpServer.close(() => {
    logger.info('http server closed');
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn('forcing exit after 5s');
    process.exit(1);
  }, 5000).unref();
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
