// jchat/server/call/ws-proxy.ts
//
// WebSocket proxy for Qwen-Omni Realtime API.
//
// Architecture:
//   Browser WS (/ws/call)  ←→  this proxy  ←→  Qwen WS (dashscope)
//
// The proxy:
//   1. Accepts browser WS connections at /ws/call?token=JWT&sessionId=SID
//   2. Verifies JWT and session ownership
//   3. Opens an upstream WS to Qwen-Omni Realtime (with DashScope API key)
//   4. Forwards events bidirectionally
//   5. Intercepts transcript events to write jchat_messages rows
//
// Why a proxy (not direct browser→Qwen WS)?
//   Browser WebSocket API does not support custom headers, but Qwen requires
//   Authorization: Bearer <API_KEY>. The proxy adds the header server-side.

import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyJchatJwt } from '../auth/jwt-verify.js';
import { getSession } from './sessions-repo.js';
import { supabaseAdmin } from '../lib/supabase-admin.js';
import { logger } from '../logger.js';
import type { MeetingSessionRow } from './sessions-repo.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProxySession {
  /** The meeting-sessions row (userId, agentId, conversationId, status). */
  meetingSession: MeetingSessionRow;
  /** Upstream WebSocket to Qwen dashscope. */
  upstream: WebSocket | null;
  /** Whether the upstream WS has opened. */
  upstreamReady: boolean;
  /** Buffered browser→upstream messages queued before upstream is open. */
  upstreamBuffer: string[];
  /** Timestamp of last activity. */
  lastActivity: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const QWEN_WS_URL =
  process.env.QWEN_OMNI_WS_URL ??
  'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3.5-omni-plus-realtime';

const DASHSCOPE_API_KEY = process.env.ALIBABA_DASHSCOPE_API_KEY ?? '';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseQuery(url: string | undefined): URLSearchParams {
  if (!url) return new URLSearchParams();
  const q = url.split('?')[1];
  return new URLSearchParams(q ?? '');
}

/** Extract JWT from incoming upgrade request. */
async function extractJwt(req: IncomingMessage): Promise<string | null> {
  const h = req.headers['authorization'] ?? '';
  if (h && h.startsWith('Bearer ')) return h.slice(7);

  const params = parseQuery(req.url);
  return params.get('token') || null;
}

// ---------------------------------------------------------------------------
// Proxy class
// ---------------------------------------------------------------------------

export class CallWsProxy {
  private sessions = new Map<string, ProxySession>();

  /**
   * Handle an HTTP upgrade request for the /ws/call path.
   * Returns `true` if handled (upgrade completed or rejected).
   */
  async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<boolean> {
    // 1. Authenticate
    const token = await extractJwt(req);
    if (!token) {
      this.rejectUpgrade(socket, 401, 'missing JWT');
      return true;
    }

    let userId: string;
    try {
      const user = await verifyJchatJwt(token);
      userId = user.id;
    } catch {
      this.rejectUpgrade(socket, 401, 'invalid JWT');
      return true;
    }

    // 2. Resolve session
    const params = parseQuery(req.url);
    const sessionId = params.get('sessionId');
    if (!sessionId) {
      this.rejectUpgrade(socket, 400, 'missing sessionId');
      return true;
    }

    let meetingSession: MeetingSessionRow;
    try {
      const s = await getSession(sessionId);
      if (!s) {
        this.rejectUpgrade(socket, 404, 'session not found');
        return true;
      }
      if (s.userId !== userId) {
        this.rejectUpgrade(socket, 403, 'not session owner');
        return true;
      }
      if (s.status !== 'ongoing') {
        this.rejectUpgrade(socket, 409, 'session not ongoing');
        return true;
      }
      meetingSession = s;
    } catch (err) {
      logger.error({ err, sessionId }, 'ws-proxy: session lookup failed');
      this.rejectUpgrade(socket, 500, 'internal error');
      return true;
    }

    // 3. Check API key
    if (!DASHSCOPE_API_KEY) {
      logger.error('ws-proxy: ALIBABA_DASHSCOPE_API_KEY not configured');
      this.rejectUpgrade(socket, 500, 'server not configured');
      return true;
    }

    // 4. Complete upgrade
    const wss = new WebSocketServer({ noServer: true });
    wss.handleUpgrade(req, socket, head, (browserWs) => {
      wss.emit('connection', browserWs, req);
      this.handleConnection(browserWs, meetingSession);
    });

    return true;
  }

  /**
   * Handle a new browser WebSocket connection for an ongoing call session.
   */
  private handleConnection(browserWs: WebSocket, meetingSession: MeetingSessionRow): void {
    const proxy: ProxySession = {
      meetingSession,
      upstream: null,
      upstreamReady: false,
      upstreamBuffer: [],
      lastActivity: Date.now(),
    };

    this.sessions.set(meetingSession.id, proxy);
    logger.info(
      { sessionId: meetingSession.id, userId: meetingSession.userId, agentId: meetingSession.agentId },
      'ws-proxy: browser connected'
    );

    // Open upstream WS to Qwen.
    let upstream: WebSocket;
    try {
      upstream = new WebSocket(QWEN_WS_URL, {
        headers: { Authorization: `Bearer ${DASHSCOPE_API_KEY}` },
      });
    } catch (err) {
      logger.error({ err, sessionId: meetingSession.id }, 'ws-proxy: upstream WebSocket constructor failed');
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(JSON.stringify({ type: 'error', message: 'upstream connection failed' }));
        browserWs.close(1011, 'upstream constructor error');
      }
      this.sessions.delete(meetingSession.id);
      return;
    }
    proxy.upstream = upstream;

    upstream.on('open', () => {
      logger.info({ sessionId: meetingSession.id }, 'ws-proxy: upstream connected');
      for (const msg of proxy.upstreamBuffer) {
        upstream.send(msg);
      }
      proxy.upstreamBuffer = [];
      proxy.upstreamReady = true;
    });

    upstream.on('message', (data) => {
      proxy.lastActivity = Date.now();
      this.onUpstreamMessage(proxy, data.toString(), browserWs);
    });

    upstream.on('error', (err) => {
      logger.error({ err, sessionId: meetingSession.id }, 'ws-proxy: upstream error');
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(JSON.stringify({ type: 'error', message: 'upstream connection error' }));
        browserWs.close(1011, 'upstream error');
      }
      this.cleanup(meetingSession.id);
    });

    upstream.on('close', (code, reason) => {
      logger.info(
        { sessionId: meetingSession.id, code, reason: reason.toString() },
        'ws-proxy: upstream closed'
      );
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.close(1000, 'upstream closed');
      }
      this.cleanup(meetingSession.id);
    });

    // Handle browser messages.
    browserWs.on('message', (data) => {
      proxy.lastActivity = Date.now();
      this.onBrowserMessage(proxy, data.toString());
    });

    browserWs.on('close', (code, reason) => {
      logger.info(
        { sessionId: meetingSession.id, code, reason: reason.toString() },
        'ws-proxy: browser disconnected'
      );
      if (proxy.upstream && proxy.upstream.readyState === WebSocket.OPEN) {
        proxy.upstream.close(1000, 'browser disconnected');
      }
      this.cleanup(meetingSession.id);
    });

    browserWs.on('error', (err) => {
      logger.error({ err, sessionId: meetingSession.id }, 'ws-proxy: browser error');
      this.cleanup(meetingSession.id);
    });

    // Signal the browser that the proxy is ready.
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({ type: 'proxy.ready', sessionId: meetingSession.id }));
    }
  }

  // -----------------------------------------------------------------------
  // Message handlers
  // -----------------------------------------------------------------------

  /** Qwen → browser. Forwards and intercepts transcripts. */
  private onUpstreamMessage(proxy: ProxySession, raw: string, browserWs: WebSocket): void {
    // Forward immediately for lowest latency.
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(raw);
    }

    // Intercept transcript events for DB persistence (best-effort).
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const session = proxy.meetingSession;

    // Agent transcript.
    if (parsed.type === 'response.audio_transcript.done' && typeof parsed.transcript === 'string') {
      this.persistTranscript(session, parsed.transcript, 'agent').catch((err) =>
        logger.warn({ err, sessionId: session.id }, 'ws-proxy: agent transcript persist failed')
      );
    }

    // User transcript.
    if (
      parsed.type === 'conversation.item.input_audio_transcription.completed' &&
      typeof parsed.transcript === 'string'
    ) {
      this.persistTranscript(session, parsed.transcript, 'user').catch((err) =>
        logger.warn({ err, sessionId: session.id }, 'ws-proxy: user transcript persist failed')
      );
    }
  }

  /** Browser → Qwen. Buffers if upstream not open yet. */
  private onBrowserMessage(proxy: ProxySession, raw: string): void {
    if (proxy.upstream && proxy.upstreamReady && proxy.upstream.readyState === WebSocket.OPEN) {
      proxy.upstream.send(raw);
    } else {
      proxy.upstreamBuffer.push(raw);
    }
  }

  // -----------------------------------------------------------------------
  // Transcript persistence
  // -----------------------------------------------------------------------

  private async persistTranscript(
    session: MeetingSessionRow,
    text: string,
    sender: 'user' | 'agent'
  ): Promise<void> {
    if (!text.trim()) return;

    const senderType = sender === 'user' ? 'user' : 'agent';
    const senderId = sender === 'user' ? session.userId : session.agentId;

    const now = Date.now();
    const contentHash = createHash('sha256').update(text).digest('hex').slice(0, 12);
    const transcriptEntryId = `${session.id}:qwen:${now}:${contentHash}`;

    const { error } = await supabaseAdmin.from('jchat_messages').insert({
      conversation_id: session.conversationId,
      sender_type: senderType,
      sender_id: senderId,
      content: text,
      delivery_status: 'final',
      metadata: {
        source: 'call',
        callSessionId: session.id,
        transcriptEntryId,
      },
      created_at: new Date(now).toISOString(),
    });

    if (error) {
      logger.warn({ err: error, sessionId: session.id, sender }, 'ws-proxy: transcript insert failed');
    } else {
      logger.info(
        { sessionId: session.id, sender, textLength: text.length },
        'ws-proxy: transcript persisted'
      );
    }
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  private cleanup(sessionId: string): void {
    const proxy = this.sessions.get(sessionId);
    if (!proxy) return;

    if (proxy.upstream && proxy.upstream.readyState === WebSocket.OPEN) {
      try {
        proxy.upstream.close(1000, 'cleanup');
      } catch {
        /* ignore */
      }
    }

    this.sessions.delete(sessionId);
    logger.info({ sessionId }, 'ws-proxy: session cleaned up');
  }

  private rejectUpgrade(socket: Duplex, code: number, message: string): void {
    const body = JSON.stringify({ error: message });
    socket.write(
      `HTTP/1.1 ${code} ${message}\r\n` +
        'Content-Type: application/json\r\n' +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        'Connection: close\r\n' +
        '\r\n' +
        body
    );
    socket.destroy();
    logger.warn({ code, message }, 'ws-proxy: upgrade rejected');
  }

  get activeCount(): number {
    return this.sessions.size;
  }
}
