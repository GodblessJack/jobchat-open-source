// jchat/server/distillation/distillation-routes.ts
//
// HTTP endpoints for the distillation wizard. Pattern mirrors
// server/call/call-routes.ts:
//   - GET  /api/distillation/quota     → today's remaining count
//   - POST /api/distillation/run       → kick off a distillation, return run_id
//   - GET  /api/distillation/run/:id   → poll status
//
// Plan: Tasks 5, 6, 7

import type { Express, Request, Response } from 'express';
import { verifyJchatJwt } from '../auth/jwt-verify.js';
import { getDistillationQuota } from '../services/quota.js';
import { logger } from '../logger.js';
import type { QuotaResponse } from '@shared/distillation-types.js';
import { createRun, getRun, hasRunningForUser, markError } from './run-registry.js';
import { launchDistillation } from './launcher.js';

async function requireUser(req: Request, res: Response): Promise<string | null> {
  const auth = req.header('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    res.status(401).json({ error: 'missing_token' });
    return null;
  }
  try {
    const user = await verifyJchatJwt(m[1]!);
    return user.id;
  } catch {
    res.status(401).json({ error: 'invalid_token' });
    return null;
  }
}

export interface DistillationRouteDeps {
  /** WS broadcaster — invoked with topic 'contacts' after a successful
   *  contact creation so the user's sidebar refreshes. Wired in
   *  server/index.ts the same way mountCallRoutes is. */
  broadcastConvSnapshot?: (topic: string) => Promise<void> | void;
}

export function mountDistillationRoutes(app: Express, deps: DistillationRouteDeps = {}): void {
  app.get('/api/distillation/quota', async (req, res) => {
    const userId = await requireUser(req, res);
    if (!userId) return;
    try {
      const q = await getDistillationQuota(userId);
      const body: QuotaResponse = {
        used: q.used,
        limit: q.limit,
        remaining: Math.max(0, q.limit - q.used),
        reset_at: q.reset_at,
      };
      res.json(body);
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'GET /api/distillation/quota failed');
      res.status(500).json({ error: 'internal' });
    }
  });

  const X_PROFILE_URL = /^https?:\/\/(www\.)?(twitter|x)\.com\/([A-Za-z0-9_]{1,15})\/?(\?.*)?$/i;
  const X_RESERVED_HANDLES = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings']);

  app.post('/api/distillation/run', async (req, res) => {
    const userId = await requireUser(req, res);
    if (!userId) return;
    const xUrl = String((req.body ?? {}).x_url ?? '').trim();
    const m = X_PROFILE_URL.exec(xUrl);
    if (!m) {
      res.status(400).json({ error: 'invalid_x_url', message: '请粘贴 ta 的 X 主页 URL（不是单条推文）' });
      return;
    }
    const handle = m[3]!.toLowerCase();
    if (X_RESERVED_HANDLES.has(handle)) {
      res.status(400).json({ error: 'invalid_x_url', message: '这是 X 的系统页面，不是个人主页' });
      return;
    }
    if (xUrl.includes('/status/')) {
      res.status(400).json({ error: 'invalid_x_url', message: '这看起来是单条推文，请粘贴主页 URL' });
      return;
    }

    try {
      const quota = await getDistillationQuota(userId);
      if (!quota.allowed) {
        res.status(400).json({ error: 'quota_exhausted', message: '今日次数已用完，明天再来吧' });
        return;
      }
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'quota check failed');
      res.status(500).json({ error: 'internal' });
      return;
    }

    if (hasRunningForUser(userId)) {
      res.status(400).json({ error: 'concurrent_running', message: '还有 1 个正在准备中，等它完了再加新的' });
      return;
    }

    const runId = createRun(userId, xUrl);
    // Fire-and-forget — the launcher writes to the registry asynchronously.
    void launchDistillation({
      runId,
      userId,
      xUrl,
      broadcastConvSnapshot: deps.broadcastConvSnapshot,
    }).catch((e) => {
      markError(runId, 'SDK_LAUNCH_FAILED', (e as Error).message);
      logger.warn({ err: (e as Error).message, runId }, 'launchDistillation threw');
    });
    res.status(202).json({ run_id: runId });
  });

  app.get('/api/distillation/run/:id', async (req, res) => {
    try {
      const userId = await requireUser(req, res);
      if (!userId) return;
      const id = String(req.params.id ?? '');
      const run = getRun(id);
      if (!run) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (run.userId !== userId) {
        res.status(403).json({ error: 'not_owner' });
        return;
      }
      if (run.status === 'running') {
        res.json({ status: 'running', started_at: new Date(run.startedAt).toISOString() });
        return;
      }
      if (run.status === 'done') {
        res.json({
          status: 'done',
          agent_id: run.result.agent_id,
          name: run.result.name,
          avatar_url: run.result.avatar_url,
          slug: run.result.slug,
        });
        return;
      }
      // error
      res.json({ status: 'error', code: run.code, message: run.message });
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'GET /api/distillation/run/:id failed');
      res.status(500).json({ error: 'internal' });
    }
  });
}
