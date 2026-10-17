// jchat/tests/unit/server/sdk/skill-loader.test.ts
//
// Red lines #5 / #6 (jobchat CLAUDE.md):
//   #5 — workspace must contain an empty `CLAUDE.md` sentinel so the bundled
//        SDK CLI cannot walk up the filesystem and accidentally load
//        development-environment instructions.
//   #6 — skill symlinks MUST resolve to absolute targets, and existing
//        symlinks pointing to the wrong target (e.g. left over from a
//        dev→prod migration) must be rebuilt.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  readlinkSync,
  statSync,
  mkdirSync,
  writeFileSync,
  symlinkSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeWorkspace } from '@/server/sdk/skill-loader';

describe('skill-loader (red lines)', () => {
  let tmpRoot: string;
  let tmpSkills: string;
  const cwd0 = process.cwd();

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'jchat-sess-'));
    tmpSkills = mkdtempSync(path.join(tmpdir(), 'jchat-skills-'));
    mkdirSync(path.join(tmpSkills, 'demo-skill-a'));
    writeFileSync(path.join(tmpSkills, 'demo-skill-a', 'SKILL.md'), '# demo a');
    mkdirSync(path.join(tmpSkills, 'demo-skill-b'));
    writeFileSync(path.join(tmpSkills, 'demo-skill-b', 'SKILL.md'), '# demo b');
  });

  afterEach(() => {
    process.chdir(cwd0);
    rmSync(tmpRoot, { recursive: true, force: true });
    rmSync(tmpSkills, { recursive: true, force: true });
  });

  it('creates workspace dir with empty sentinel CLAUDE.md (red line #5)', async () => {
    const sid = 'test-sid-1';
    await initializeWorkspace({
      sessionsRoot: tmpRoot,
      sessionId: sid,
      activeSkills: [],
      skillsRoot: tmpSkills
    });
    const wsPath = path.join(tmpRoot, sid);
    expect(statSync(wsPath).isDirectory()).toBe(true);
    const sentinel = readFileSync(path.join(wsPath, 'CLAUDE.md'), 'utf8');
    expect(sentinel).toBe('');
  });

  it('symlinks skills with absolute resolved targets (red line #6)', async () => {
    const sid = 'test-sid-2';
    await initializeWorkspace({
      sessionsRoot: tmpRoot,
      sessionId: sid,
      activeSkills: [{ name: 'demo-skill-a', inline_content: null }, { name: 'demo-skill-b', inline_content: null }],
      skillsRoot: tmpSkills
    });
    const linkA = path.join(tmpRoot, sid, '.claude', 'skills', 'demo-skill-a');
    const targetA = readlinkSync(linkA);
    expect(path.isAbsolute(targetA)).toBe(true);
    expect(targetA).toBe(path.join(tmpSkills, 'demo-skill-a'));

    const linkB = path.join(tmpRoot, sid, '.claude', 'skills', 'demo-skill-b');
    expect(readlinkSync(linkB)).toBe(path.join(tmpSkills, 'demo-skill-b'));
  });

  it('soft-skips missing skill targets without throwing', async () => {
    const sid = 'test-sid-3';
    await initializeWorkspace({
      sessionsRoot: tmpRoot,
      sessionId: sid,
      activeSkills: [{ name: 'nonexistent-skill', inline_content: null }, { name: 'demo-skill-a', inline_content: null }],
      skillsRoot: tmpSkills
    });
    expect(() =>
      readlinkSync(path.join(tmpRoot, sid, '.claude', 'skills', 'nonexistent-skill'))
    ).toThrow();
    // Existing skill still installed
    expect(
      readlinkSync(path.join(tmpRoot, sid, '.claude', 'skills', 'demo-skill-a'))
    ).toBe(path.join(tmpSkills, 'demo-skill-a'));
  });

  it('rebuilds symlink if existing one points to wrong target (red line #6 — dev→prod migration)', async () => {
    const sid = 'test-sid-4';
    const wsPath = path.join(tmpRoot, sid);
    const skillDir = path.join(wsPath, '.claude', 'skills');
    mkdirSync(skillDir, { recursive: true });
    const wrongTarget = '/some/wrong/path';
    const link = path.join(skillDir, 'demo-skill-a');
    symlinkSync(wrongTarget, link, 'dir');

    await initializeWorkspace({
      sessionsRoot: tmpRoot,
      sessionId: sid,
      activeSkills: [{ name: 'demo-skill-a', inline_content: null }],
      skillsRoot: tmpSkills
    });
    expect(readlinkSync(link)).toBe(path.join(tmpSkills, 'demo-skill-a'));
  });

  it('keeps symlink unchanged if existing one points to correct target (idempotency)', async () => {
    const sid = 'test-sid-5';
    // First call creates link
    await initializeWorkspace({
      sessionsRoot: tmpRoot,
      sessionId: sid,
      activeSkills: [{ name: 'demo-skill-a', inline_content: null }],
      skillsRoot: tmpSkills
    });
    const link = path.join(tmpRoot, sid, '.claude', 'skills', 'demo-skill-a');
    const t0 = readlinkSync(link);
    // Second call should be idempotent
    await initializeWorkspace({
      sessionsRoot: tmpRoot,
      sessionId: sid,
      activeSkills: [{ name: 'demo-skill-a', inline_content: null }],
      skillsRoot: tmpSkills
    });
    expect(readlinkSync(link)).toBe(t0);
  });

  it('uses sessionsRoot as path.resolve()-ed absolute (red line: SESSIONS_ROOT must be absolute)', async () => {
    process.chdir(tmpRoot);
    await initializeWorkspace({
      sessionsRoot: '.',
      sessionId: 'rel-test',
      activeSkills: [],
      skillsRoot: tmpSkills
    });
    const ws = path.join(tmpRoot, 'rel-test');
    expect(statSync(ws).isDirectory()).toBe(true);
    expect(readFileSync(path.join(ws, 'CLAUDE.md'), 'utf8')).toBe('');
  });

  it('returns the absolute workspace path', async () => {
    const sid = 'test-sid-6';
    const wsPath = await initializeWorkspace({
      sessionsRoot: tmpRoot,
      sessionId: sid,
      activeSkills: [],
      skillsRoot: tmpSkills
    });
    expect(path.isAbsolute(wsPath)).toBe(true);
    expect(wsPath).toBe(path.join(tmpRoot, sid));
  });

  it('soft-skips when skill target is a file rather than a directory', async () => {
    // Create a file at the skill target
    writeFileSync(path.join(tmpSkills, 'not-a-dir-skill'), 'just a file');
    const sid = 'test-sid-7';
    await initializeWorkspace({
      sessionsRoot: tmpRoot,
      sessionId: sid,
      activeSkills: [{ name: 'not-a-dir-skill', inline_content: null }],
      skillsRoot: tmpSkills
    });
    expect(() =>
      readlinkSync(path.join(tmpRoot, sid, '.claude', 'skills', 'not-a-dir-skill'))
    ).toThrow();
  });
});
