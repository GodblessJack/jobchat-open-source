// jchat/server/sdk/ipc.ts
//
// Unix domain socket + JSON-lines IPC primitive (port of clay/lib/ipc.js).
// Used by the daemon ↔ SDK worker channel. One JSON object per line.

import net, { type Server, type Socket } from 'node:net';
import { unlink } from 'node:fs/promises';
import { logger } from '../logger.js';

export type IpcMessage = Record<string, unknown>;
export type IpcHandler = (msg: IpcMessage) => IpcMessage | Promise<IpcMessage>;

export interface IpcServerHandle {
  /** Close the listener and unlink the socket file. */
  close: () => Promise<void>;
  /** Underlying server (for advanced callers). */
  server: Server;
}

/**
 * Create a JSON-lines IPC server bound to a Unix domain socket.
 * The handler returns a response object (sync or async); responses are
 * written back as one JSON object per line to the same connection.
 */
export function createIpcServer(sockPath: string, handler: IpcHandler): Promise<IpcServerHandle> {
  return new Promise(async (resolve, reject) => {
    // Remove stale socket file (Linux/macOS).
    try {
      await unlink(sockPath);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        // Non-fatal; bind may still succeed.
        logger.debug({ sockPath, code: err.code }, 'pre-bind unlink warning');
      }
    }

    const server = net.createServer((conn: Socket) => {
      let buf = '';
      conn.setEncoding('utf8');
      conn.on('data', (chunk: string) => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop() || ''; // keep last partial line
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg: IpcMessage;
          try {
            msg = JSON.parse(line);
          } catch {
            try {
              conn.write(JSON.stringify({ ok: false, error: 'parse error' }) + '\n');
            } catch { /* socket closed */ }
            continue;
          }
          Promise.resolve()
            .then(() => handler(msg))
            .then((res) => {
              try {
                conn.write(JSON.stringify(res ?? { ok: true }) + '\n');
              } catch { /* socket closed */ }
            })
            .catch((err: Error) => {
              try {
                conn.write(JSON.stringify({ ok: false, error: err.message }) + '\n');
              } catch { /* socket closed */ }
            });
        }
      });
      conn.on('error', () => { /* ignore — peer may have hung up */ });
    });

    let retried = false;
    server.on('error', async (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && !retried) {
        retried = true;
        logger.warn({ sockPath }, 'ipc socket in use, removing and retrying');
        try {
          await unlink(sockPath);
        } catch { /* ignore */ }
        server.listen(sockPath);
      } else {
        reject(err);
      }
    });

    server.listen(sockPath, () => {
      resolve({
        server,
        close: () =>
          new Promise<void>((r) => {
            server.close(async () => {
              try {
                await unlink(sockPath);
              } catch { /* ignore */ }
              r();
            });
          })
      });
    });
  });
}

/**
 * Send a single JSON-lines command and wait for the response.
 * Resolves with the parsed response or `{ ok: false, error }` on timeout/IO err.
 */
export function sendIpcCommand(
  sockPath: string,
  message: IpcMessage,
  timeoutMs = 3000
): Promise<IpcMessage> {
  return new Promise((resolve) => {
    const client = net.connect(sockPath);
    let buf = '';
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      client.destroy();
      resolve({ ok: false, error: 'timeout' });
    }, timeoutMs);
    timer.unref();

    client.on('connect', () => {
      try {
        client.write(JSON.stringify(message) + '\n');
      } catch (e) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ok: false, error: (e as Error).message });
      }
    });

    client.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const idx = buf.indexOf('\n');
      if (idx === -1 || done) return;
      done = true;
      clearTimeout(timer);
      try {
        const resp = JSON.parse(buf.slice(0, idx)) as IpcMessage;
        resolve(resp);
      } catch {
        resolve({ ok: false, error: 'invalid response' });
      }
      client.destroy();
    });

    client.on('error', (err: NodeJS.ErrnoException) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        error: err.code === 'ECONNREFUSED' ? 'daemon not responding' : err.message
      });
    });
  });
}
