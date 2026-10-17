// jchat/tests/unit/server/sdk/worker-env.test.ts
// Red line #2: workerEnv must NEVER include `...process.env`. Only allowlisted
// keys are forwarded to the SDK worker subprocess.

import { describe, it, expect, afterEach } from 'vitest';
import { buildWorkerEnv, WORKER_ENV_ALLOWLIST } from '@/server/sdk/worker-env';

describe('worker-env (red line #2)', () => {
  const dirty: string[] = [];
  afterEach(() => {
    for (const k of dirty) delete process.env[k];
    dirty.length = 0;
  });
  function setEnv(k: string, v: string) {
    process.env[k] = v;
    dirty.push(k);
  }

  it('only contains allowlisted keys (no leak from process.env)', () => {
    setEnv('RANDOM_LEAK_VAR', 'should-not-appear');
    setEnv('SOME_OTHER_SECRET', 'oops');
    process.env.PATH = '/usr/bin';
    process.env.HOME = '/home/test';
    setEnv('ANTHROPIC_API_KEY', 'sk-test');

    const env = buildWorkerEnv();
    const keys = Object.keys(env);

    for (const k of keys) {
      expect(WORKER_ENV_ALLOWLIST as readonly string[]).toContain(k);
    }
    expect(env.RANDOM_LEAK_VAR).toBeUndefined();
    expect(env.SOME_OTHER_SECRET).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test');
  });

  it('does not include NODE_OPTIONS or NPM_CONFIG_*', () => {
    setEnv('NODE_OPTIONS', '--inspect');
    setEnv('NPM_CONFIG_PREFIX', '/some/prefix');
    setEnv('NPM_CONFIG_REGISTRY', 'https://registry.npmjs.org');
    const env = buildWorkerEnv();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.NPM_CONFIG_PREFIX).toBeUndefined();
    expect(env.NPM_CONFIG_REGISTRY).toBeUndefined();
  });

  it('passes ANTHROPIC_BASE_URL when set', () => {
    setEnv('ANTHROPIC_BASE_URL', 'https://api.example.com');
    expect(buildWorkerEnv().ANTHROPIC_BASE_URL).toBe('https://api.example.com');
  });

  it('passes ANTHROPIC_AUTH_TOKEN when set', () => {
    setEnv('ANTHROPIC_AUTH_TOKEN', 'token-xyz');
    expect(buildWorkerEnv().ANTHROPIC_AUTH_TOKEN).toBe('token-xyz');
  });

  it('passes JCHAT_SESSIONS_ROOT when set', () => {
    setEnv('JCHAT_SESSIONS_ROOT', '/data/jchat-sessions');
    expect(buildWorkerEnv().JCHAT_SESSIONS_ROOT).toBe('/data/jchat-sessions');
  });

  it('omits keys not in process.env', () => {
    delete process.env.CLAUDE_HOME;
    const env = buildWorkerEnv();
    expect(env.CLAUDE_HOME).toBeUndefined();
  });

  it('allows merging caller-supplied overrides into the env (e.g. workspace-specific)', () => {
    process.env.PATH = '/usr/bin';
    const env = buildWorkerEnv({ JCHAT_SESSIONS_ROOT: '/tmp/override' });
    expect(env.JCHAT_SESSIONS_ROOT).toBe('/tmp/override');
    expect(env.PATH).toBe('/usr/bin');
  });

  it('overrides only allowlisted keys (drops unknown overrides)', () => {
    const env = buildWorkerEnv({ RANDOM_LEAK_VAR: 'still-bad' } as Record<string, string>);
    expect(env.RANDOM_LEAK_VAR).toBeUndefined();
  });
});
