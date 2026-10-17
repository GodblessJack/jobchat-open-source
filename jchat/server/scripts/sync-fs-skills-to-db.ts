// jchat/server/scripts/sync-fs-skills-to-db.ts
//
// Unified-standard runtime sync: pushes every shared skill's SKILL.md
// content from the filesystem source-of-truth into agent_skills.inline_content
// and agent_skills.description (DB runtime).
//
// **Architecture (post-unification)**:
//   - Filesystem (jchat/server/skills/<name>/SKILL.md) = git source of truth
//     for SHARED skills — code review, diffs, version control.
//   - DB (agent_skills.inline_content + description) = runtime standard.
//     Worker reads DB and materializes to workspace at session start.
//   - Sync script = bridge. Run on:
//       - Initial migration (existing fs skills → DB)
//       - After editing any shared SKILL.md (push change to runtime)
//       - On deploy (CI/CD)
//
// Private user-distilled skills are NOT touched here — they already have
// inline_content (written by create_distilled_contact) and never live on
// filesystem.
//
// Usage:
//   tsx server/scripts/sync-fs-skills-to-db.ts [--dry-run]

import 'dotenv/config';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../lib/db.js';
import { agentSkills, agents } from '../sql/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';

const DRY = process.argv.includes('--dry-run');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILLS_ROOT = path.resolve(__dirname, '..', 'skills');

interface SkillFile {
  name: string;
  content: string;
  description: string | null;
}

/** Extract first-sentence description from SKILL.md YAML frontmatter. */
function extractDescription(content: string): string | null {
  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!fmMatch) return null;
  const fm = fmMatch[1]!;

  // Find the description key position.
  const keyIdx = fm.search(/^description:/m);
  if (keyIdx === -1) return null;

  // Strip the key and optional YAML block indicator (| or >).
  const styleMatch = /^description:\s*([|>]?)\s*\n?/.exec(fm.slice(keyIdx));
  const style = styleMatch ? styleMatch[1] ?? '' : '';
  const afterKey = fm.slice(keyIdx).replace(/^description:\s*([|>]?)\s*\n?/, '');

  // Value extends until the next frontmatter key or end of string.
  const valueEnd = afterKey.search(/^[a-z_]+:/m);
  let raw = (valueEnd === -1 ? afterKey : afterKey.slice(0, valueEnd)).trim();

  // Folded block scalar (>): newlines become spaces.
  if (style === '>') {
    raw = raw.replace(/\n\s+/g, ' ');
  }

  // Take first sentence / line, max 200 chars.
  const first = raw.split(/[\n。.]/)[0]?.trim() ?? raw;
  return first ? first.slice(0, 200) : null;
}

async function readAllFsSkills(): Promise<SkillFile[]> {
  const entries = await readdir(SKILLS_ROOT);
  const skills: SkillFile[] = [];
  for (const name of entries) {
    const dir = path.join(SKILLS_ROOT, name);
    const s = await stat(dir);
    if (!s.isDirectory()) continue;

    const skillPath = path.join(dir, 'SKILL.md');
    try {
      const content = await readFile(skillPath, 'utf-8');
      skills.push({ name, content, description: extractDescription(content) });
    } catch {
      console.warn(`[sync] skip ${name}: SKILL.md missing`);
    }
  }
  return skills;
}

async function main() {
  console.log(`[sync] Skills root: ${SKILLS_ROOT}`);
  console.log(`[sync] Dry run: ${DRY ? 'YES' : 'no'}`);

  const fsSkills = await readAllFsSkills();
  console.log(`[sync] Found ${fsSkills.length} fs skills`);

  let updated = 0;
  let skipped = 0;
  let unmatched = 0;

  for (const skill of fsSkills) {
    // Find all agent_skills rows pointing at this skill (across ALL shared agents).
    // Private agents (owner_user_id IS NOT NULL) are intentionally not touched —
    // they own their own inline_content via create_distilled_contact.
    const rows = await db
      .select({
        agentId: agentSkills.agentId,
        skillName: agentSkills.skillName,
        inlineContent: agentSkills.inlineContent,
        description: agentSkills.description,
      })
      .from(agentSkills)
      .innerJoin(agents, eq(agentSkills.agentId, agents.id))
      .where(
        and(
          eq(agentSkills.skillName, skill.name),
          isNull(agents.ownerUserId)
        )
      );

    if (!rows || rows.length === 0) {
      console.warn(
        `[sync] ${skill.name}: no shared agent uses this skill (orphan source)`
      );
      unmatched += 1;
      continue;
    }

    // Push content + description to all matching rows.
    for (const row of rows) {
      const contentChanged = row.inlineContent !== skill.content;
      const descChanged = row.description !== skill.description;
      if (!contentChanged && !descChanged) {
        skipped += 1;
        continue;
      }
      if (DRY) {
        const changes: string[] = [];
        if (contentChanged) changes.push(`content (${skill.content.length} bytes)`);
        if (descChanged) changes.push(`description: ${skill.description?.slice(0, 40) ?? '(null)'}`);
        console.log(
          `[sync] [dry] would update agent ${row.agentId} skill ${skill.name}: ${changes.join(', ')}`
        );
        updated += 1;
        continue;
      }
      try {
        const set: Record<string, unknown> = {};
        if (contentChanged) set.inlineContent = skill.content;
        if (descChanged) set.description = skill.description;
        await db
          .update(agentSkills)
          .set(set)
          .where(
            and(
              eq(agentSkills.agentId, row.agentId),
              eq(agentSkills.skillName, skill.name)
            )
          );
        const changes: string[] = [];
        if (contentChanged) changes.push(`content`);
        if (descChanged) changes.push(`description`);
        console.log(`[sync] ${skill.name} → agent ${row.agentId} (${changes.join(', ')})`);
        updated += 1;
      } catch (err) {
        console.error(
          `[sync] ${skill.name}@${row.agentId}: update failed:`,
          (err as Error).message
        );
      }
    }
  }

  console.log('');
  console.log(`[sync] Summary: updated=${updated} skipped=${skipped} unmatched-fs-skills=${unmatched}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
