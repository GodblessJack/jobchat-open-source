import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeWorkspace } from '@/server/sdk/skill-loader.js';

describe('initializeWorkspace inline_content branch', () => {
  let sessionsRoot: string;
  let skillsRoot: string;

  beforeEach(() => {
    sessionsRoot = mkdtempSync(path.join(tmpdir(), 'sessions-'));
    skillsRoot = mkdtempSync(path.join(tmpdir(), 'skills-'));
    mkdirSync(path.join(skillsRoot, 'shared-skill'), { recursive: true });
  });

  afterEach(() => {
    rmSync(sessionsRoot, { recursive: true, force: true });
    rmSync(skillsRoot, { recursive: true, force: true });
  });

  it('writes inline_content to workspace when not null', async () => {
    const wsPath = await initializeWorkspace({
      sessionsRoot,
      sessionId: 'test-session',
      skillsRoot,
      activeSkills: [
        { name: 'naval', inline_content: '---\nname: naval\n---\n# I am Naval' },
      ],
    });

    const skillFile = path.join(wsPath, '.claude', 'skills', 'naval', 'SKILL.md');
    expect(existsSync(skillFile)).toBe(true);
    expect(readFileSync(skillFile, 'utf-8')).toBe('---\nname: naval\n---\n# I am Naval');
  });

  it('symlinks shared skill when inline_content is null', async () => {
    const wsPath = await initializeWorkspace({
      sessionsRoot,
      sessionId: 'test-session-2',
      skillsRoot,
      activeSkills: [{ name: 'shared-skill', inline_content: null }],
    });

    const link = path.join(wsPath, '.claude', 'skills', 'shared-skill');
    expect(existsSync(link)).toBe(true);
    // Verify it's actually a symlink (not a regular dir)
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('handles mixed inline + symlink in one call', async () => {
    const wsPath = await initializeWorkspace({
      sessionsRoot,
      sessionId: 'mixed',
      skillsRoot,
      activeSkills: [
        { name: 'shared-skill', inline_content: null },
        { name: 'naval', inline_content: '# inline content' },
      ],
    });

    const sharedLink = path.join(wsPath, '.claude', 'skills', 'shared-skill');
    expect(lstatSync(sharedLink).isSymbolicLink()).toBe(true);

    const inlineFile = path.join(wsPath, '.claude', 'skills', 'naval', 'SKILL.md');
    expect(readFileSync(inlineFile, 'utf-8')).toBe('# inline content');
  });

  it('soft-skips invalid skill names without throwing', async () => {
    const wsPath = await initializeWorkspace({
      sessionsRoot,
      sessionId: 'invalid-name',
      skillsRoot,
      activeSkills: [
        { name: '../escape', inline_content: 'evil' },
        { name: 'naval', inline_content: '# good' },
      ],
    });

    // Confirm no path-escape file was written
    expect(existsSync(path.join(wsPath, '.claude', 'skills', '..', 'escape'))).toBe(false);
    expect(existsSync(path.join(wsPath, '.claude', 'skills', 'naval', 'SKILL.md'))).toBe(true);
  });

  it('writes empty CLAUDE.md sentinel at workspace root', async () => {
    const wsPath = await initializeWorkspace({
      sessionsRoot,
      sessionId: 'sentinel',
      skillsRoot,
      activeSkills: [],
    });

    expect(readFileSync(path.join(wsPath, 'CLAUDE.md'), 'utf-8')).toBe('');
  });
});
