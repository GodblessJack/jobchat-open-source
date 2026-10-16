import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Vitest config — server tests use `@/server/...`, client tests use `@/...`
// (which maps to `src/...` to match vite.config.ts). The order of aliases
// matters: `@/server/` is matched first, then `@/` falls back to src.

export default defineConfig({
  resolve: {
    alias: [
      { find: '@shared', replacement: path.resolve(__dirname, 'shared') },
      // Server-test alias must come before the catch-all.
      { find: /^@\/server\//, replacement: path.resolve(__dirname, 'server') + '/' },
      // Client-test alias: `@/...` -> `src/...`
      { find: /^@\//, replacement: path.resolve(__dirname, 'src') + '/' }
    ]
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    // Integration tests spawn real subprocesses + hit external APIs and need
    // headroom over the default 5s.
    testTimeout: 60_000,
    hookTimeout: 30_000
  }
});
