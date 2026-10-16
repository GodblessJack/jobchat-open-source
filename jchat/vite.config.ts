import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';

/**
 * Vite plugin that waits for the jchat backend (port 5272) to be healthy before
 * the dev server starts accepting connections.
 *
 * Without this, Vite starts faster than the backend and proxies WS upgrades to
 * a server that is not yet listening — the client sees "Connection closed before
 * receiving a handshake response" until the first reconnect cycle succeeds.
 */
function waitForBackend(): Plugin {
  const BACKEND_HEALTH_URL = 'http://localhost:5272/health';
  const POLL_INTERVAL_MS = 500;
  const MAX_WAIT_MS = 30_000;

  async function pollUntilReady(): Promise<void> {
    const deadline = Date.now() + MAX_WAIT_MS;

    while (true) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(BACKEND_HEALTH_URL, { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) {

          console.log('[vite] jchat backend is ready');
          return;
        }
      } catch {
        // backend not yet listening — poll again
      }
      if (Date.now() > deadline) {

        console.warn('[vite] jchat backend did not become ready within 30 s, proceeding anyway');
        return;
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  return {
    name: 'wait-for-backend',
    async configureServer() {
      await pollUntilReady();
    }
  };
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/chat/' : '/',
  plugins: [react(), waitForBackend()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared')
    }
  },
  server: {
    port: 5273,
    proxy: {
      '/api': { target: 'http://localhost:5272', changeOrigin: true },
      '/ws': { target: 'ws://localhost:5272', ws: true, changeOrigin: true },
      '/files': { target: 'http://localhost:5272', changeOrigin: true },
      '/call': { target: 'http://localhost:5180', changeOrigin: true, ws: true }
    }
  }
}));
