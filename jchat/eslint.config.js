import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'build/**',
      'coverage/**',
      'node_modules/**',
      'server/skills/**',
      'drizzle/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      'no-var': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
  {
    // These expressions intentionally detect control and irregular characters.
    files: [
      'server/agent/prompt-defense.ts',
      'server/mcp/create-attachment-mcp.ts',
      'server/storage/signed-url.ts',
    ],
    rules: {
      'no-control-regex': 'off',
      'no-irregular-whitespace': 'off',
      'no-misleading-character-class': 'off',
    },
  },
  {
    // IPC lifecycle is covered by the worker tests; keep its executor structure stable.
    files: ['server/sdk/ipc.ts'],
    rules: {
      'no-async-promise-executor': 'off',
    },
  },
);
