// jchat/server/sdk/skill-loader.ts
//
// Workspace bootstrap for SDK workers. **Centralizes red-line enforcement**
// for sessions. (jobchat CLAUDE.md red lines #1, #4, #5, #6.)
//
// What this does:
//   1. Resolve `sessionsRoot` to an absolute path (red line #1, #4) — the
//      symlink target must always be absolute, otherwise the SDK CLI
//      resolves it relative to the workspace's parent directory and ends
//      up loading the wrong skill folder.
//   2. `mkdir <root>/<sessionId>/` recursively.
//   3. Write an EMPTY `CLAUDE.md` sentinel at the workspace root (red line
//      #5). This stops the bundled SDK CLI's project-mode upward filesystem
//      walk from accidentally loading the operator's developer-environment
//      `CLAUDE.md` (e.g. `/path/to/private-project/CLAUDE.md`).
//   4. For each requested skill: validate the name, then either
//      a) write `inline_content` to `<workspace>/.claude/skills/<name>/SKILL.md`
//         (private user-distilled skill stored in DB), or
//      b) symlink the skill from `<skillsRoot>/<name>` (shared skill on disk).

import { mkdir, readlink, symlink, writeFile, unlink, stat, lstat } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../logger.js';

/**
 * One enabled skill bound to an agent (mirror of `agent_skills.skill_name +
 * inline_content` from the DB). `inline_content !== null` means the skill
 * body is stored in the DB and should be written to the workspace; `null`
 * means it's a shared skill folder under `skillsRoot/<name>` that should be
 * symlinked.
 */
export interface ActiveSkill {
  name: string;
  inline_content: string | null;
}

export interface InitWorkspaceOpts {
  /** Sessions root, e.g. `/data/jchat-sessions`. Will be path.resolve()'d. */
  sessionsRoot: string;
  /** Logical session id. Becomes the workspace dir name. */
  sessionId: string;
  /** Active skills to install for this session (DB-resolved). */
  activeSkills: ActiveSkill[];
  /** Skills root, e.g. `<repo>/jchat/server/skills`. Will be path.resolve()'d. */
  skillsRoot: string;
}

/**
 * Allow lowercase letters, digits, and hyphens. Must start with letter or
 * digit (no leading dash, no leading dot, no `..`). Length 1-64.
 *
 * **Security**: this gates a path segment in `<workspace>/.claude/skills/<name>/`,
 * and the `<name>` ultimately comes from `agent_skills.skill_name` (a column
 * mutable by service-role code paths). A loose pattern would let a hostile
 * row escape the workspace via `../`. Keep this regex tight.
 */
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_RE.test(name);
}

/**
 * Bootstrap a worker session workspace. Returns the absolute workspace path.
 *
 * Idempotent: safe to call multiple times for the same `(sessionsRoot,
 * sessionId)`. For shared skills, symlinks pointing to the correct target
 * are left untouched; stale ones are rebuilt; missing targets are
 * soft-skipped with a warning. For inline skills, the file is rewritten on
 * every call (cheap; ensures freshness if DB content changed between
 * sessions).
 */
export async function initializeWorkspace(opts: InitWorkspaceOpts): Promise<string> {
  const { sessionId, activeSkills } = opts;

  // Red line: sessionsRoot must be absolute.
  const absRoot = path.resolve(opts.sessionsRoot);
  const wsPath = path.join(absRoot, sessionId);
  await mkdir(wsPath, { recursive: true });

  // Red line #5 — sentinel CLAUDE.md.
  await writeFile(path.join(wsPath, 'CLAUDE.md'), '', 'utf8');

  const skillsDir = path.join(wsPath, '.claude', 'skills');
  await mkdir(skillsDir, { recursive: true });

  const absSkillsRoot = path.resolve(opts.skillsRoot);

  for (const skill of activeSkills) {
    if (!isValidSkillName(skill.name)) {
      logger.warn({ skill: skill.name }, 'invalid skill name, soft-skipping');
      continue;
    }

    const link = path.join(skillsDir, skill.name);

    if (skill.inline_content !== null) {
      // Inline (private) skill — write content to workspace. Idempotent: each
      // session gets a fresh write reflecting current DB content.
      // If the skill was previously shared (symlink), unlink it first so
      // mkdir+writeFile don't follow the symlink and corrupt the shared source.
      try { const st = await lstat(link); if (st.isSymbolicLink()) await unlink(link); } catch { /* ENOENT ok */ }
      try {
        await mkdir(link, { recursive: true });
        await writeFile(path.join(link, 'SKILL.md'), skill.inline_content, 'utf-8');
      } catch (e) {
        logger.warn(
          { skill: skill.name, err: (e as Error).message },
          'failed to write inline skill SKILL.md'
        );
      }
      continue;
    }

    // Shared skill — symlink path. Existing logic preserved verbatim.
    const target = path.join(absSkillsRoot, skill.name);

    let existing: string | null = null;
    try {
      existing = await readlink(link);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        logger.warn(
          { skill: skill.name, link, code: err.code },
          'skill link path is not a symlink, skipping'
        );
        continue;
      }
    }

    if (existing === target) {
      continue;
    }

    if (existing !== null) {
      try {
        await unlink(link);
      } catch (e) {
        logger.warn(
          { skill: skill.name, link, err: (e as Error).message },
          'failed to unlink stale skill symlink'
        );
        continue;
      }
    }

    let targetOk = false;
    try {
      const s = await stat(target);
      targetOk = s.isDirectory();
    } catch {
      targetOk = false;
    }
    if (!targetOk) {
      logger.warn({ skill: skill.name, target }, 'skill target missing or not a directory, soft-skipping');
      continue;
    }

    try {
      await symlink(target, link, 'dir');
    } catch (e) {
      logger.warn(
        { skill: skill.name, target, link, err: (e as Error).message },
        'failed to create skill symlink'
      );
    }
  }

  return wsPath;
}
