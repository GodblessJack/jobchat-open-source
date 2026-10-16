// jchat/server/scripts/import-nuwa-examples.ts
//
// Imports pre-distilled persona skills from the alchaincyf/nuwa-skill
// upstream `examples/` directory as default-bound shared agents.
//
// Per Boss directive (2026-04-28):
//   - Whitelist 11 personas (skip trump, sun-yuchen)
//   - is_default=true → all current + future users see them in their
//     contact list automatically
//   - inline_content (DB) is the unified runtime standard
//   - Filesystem copy under jchat/server/skills/<slug>/ remains the git
//     source of truth (sync-fs-skills-to-db.ts bridges them)
//
// What this does:
//   1. Clone nuwa-skill upstream to /tmp
//   2. For each whitelisted persona:
//      a. Read examples/<slug>-perspective/SKILL.md
//      b. sed brand pass (remove 女娲 / huashu-nuwa / 造人 / -perspective)
//      c. Parse frontmatter description and the body H1 for the display name
//      d. Write the cleaned SKILL.md to jchat/server/skills/<slug>/SKILL.md
//      e. INSERT agents row (owner_user_id=NULL, is_default=true)
//      f. INSERT agent_skills row with full inline_content
//      g. Backfill user_agents for all existing users (is_removable=true)
//
// Idempotent: skips an agent if the same slug already exists with
// owner_user_id IS NULL.

import 'dotenv/config';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../lib/db.js';
import { agents, agentSkills, localUsers, userAgents } from '../sql/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILLS_DEST_ROOT = path.resolve(__dirname, '..', 'skills');

// ----- Whitelist (11 personas; skip trump + sun-yuchen) -----
interface PersonaSpec {
  upstream: string;       // upstream folder name (e.g., 'naval-perspective')
  slug: string;           // jchat slug (e.g., 'naval')
  display_name: string;   // agents.name (curated to be clean)
}

const PERSONAS: PersonaSpec[] = [
  { upstream: 'andrej-karpathy-perspective', slug: 'andrej-karpathy', display_name: 'Andrej Karpathy' },
  { upstream: 'elon-musk-perspective',       slug: 'elon-musk',       display_name: 'Elon Musk' },
  { upstream: 'feynman-perspective',         slug: 'feynman',         display_name: 'Richard Feynman' },
  { upstream: 'ilya-sutskever-perspective',  slug: 'ilya-sutskever',  display_name: 'Ilya Sutskever' },
  { upstream: 'mrbeast-perspective',         slug: 'mrbeast',         display_name: 'MrBeast' },
  { upstream: 'munger-perspective',          slug: 'munger',          display_name: 'Charlie Munger' },
  { upstream: 'naval-perspective',           slug: 'naval',           display_name: 'Naval Ravikant' },
  { upstream: 'paul-graham-perspective',     slug: 'paul-graham',     display_name: 'Paul Graham' },
  { upstream: 'steve-jobs-perspective',      slug: 'steve-jobs',      display_name: 'Steve Jobs' },
  { upstream: 'taleb-perspective',           slug: 'taleb',           display_name: 'Nassim Taleb' },
  { upstream: 'zhang-yiming-perspective',    slug: 'zhang-yiming',    display_name: '张一鸣' },
  { upstream: 'zhangxuefeng-perspective',    slug: 'zhangxuefeng',    display_name: '张雪峰' },
];


function brandReplace(text: string): string {
  return text
    .replace(/huashu-nuwa/g, 'persona-distillation')
    .replace(/女娲/g, '')
    .replace(/造人/g, '蒸馏')
    .replace(/-perspective/g, '')
    // Standalone "perspective" at word boundary in user-visible text
    .replace(/「([^」]*)\s*perspective」/g, '「$1模式」');
}

interface ParsedSkill {
  frontmatter_description: string;
  body_first_h1: string | null;
  cleaned_content: string;
}

function parseSkill(raw: string): ParsedSkill {
  const cleaned = brandReplace(raw);
  // Frontmatter between leading --- ... ---
  const fmMatch = /^---\n([\s\S]*?)\n---\n/.exec(cleaned);
  let description = '';
  if (fmMatch) {
    const fm = fmMatch[1]!;
    const descMatch = /^description:\s*\|?\s*\n?([\s\S]*?)(?=^\w+:|(?![\s\S]))/m.exec(fm);
    if (descMatch) description = descMatch[1]!.trim();
  }
  // First H1 in the body (display name pattern: "# X · 思维操作系统")
  const bodyStart = fmMatch ? cleaned.slice(fmMatch[0].length) : cleaned;
  const h1Match = /^#\s+(.+?)\s*$/m.exec(bodyStart);
  const body_first_h1 = h1Match ? h1Match[1]!.trim() : null;
  return { frontmatter_description: description, body_first_h1, cleaned_content: cleaned };
}

function rebrandFrontmatter(content: string, slug: string): string {
  // Replace `name: <slug>-perspective` with `name: <slug>` in the frontmatter line
  return content.replace(/^name:\s*\S+/m, `name: ${slug}`);
}

async function importPersona(spec: PersonaSpec, upstreamRoot: string): Promise<'imported' | 'skipped' | 'failed'> {
  // Idempotency check: does a shared agent for this slug already exist?
  const existing = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.slug, spec.slug),
        isNull(agents.ownerUserId)
      )
    )
    .limit(1)
    .then(r => r[0] || null);
  if (existing) {
    console.log(`[import] ${spec.slug}: already exists (agent_id=${existing.id}), skipping`);
    return 'skipped';
  }

  // Read upstream SKILL.md
  const srcSkillPath = path.join(upstreamRoot, 'examples', spec.upstream, 'SKILL.md');
  if (!existsSync(srcSkillPath)) {
    console.error(`[import] ${spec.slug}: upstream SKILL.md not found at ${srcSkillPath}`);
    return 'failed';
  }
  const raw = readFileSync(srcSkillPath, 'utf-8');
  const parsed = parseSkill(raw);
  const finalContent = rebrandFrontmatter(parsed.cleaned_content, spec.slug);

  // Write to jchat/server/skills/<slug>/SKILL.md (filesystem source-of-truth)
  const destDir = path.join(SKILLS_DEST_ROOT, spec.slug);
  mkdirSync(destDir, { recursive: true });
  writeFileSync(path.join(destDir, 'SKILL.md'), finalContent, 'utf-8');

  const initialMessage =
    `你好，我是 ${spec.display_name}。今天想聊点什么？` +
    `\n\n（提示：我会以 ${spec.display_name} 的视角回应你的问题；想恢复普通模式时，对我说"退出角色"即可。）`;

  // CRITICAL: persona_description is the system prompt source (jchat
  // persona-builder.ts:40). It MUST contain the role-play directives, not just
  // a product description. Use the full cleaned SKILL.md content directly —
  // includes "我是 [name]" + role-play rules + answer workflow + mental models.
  // The frontmatter description alone (which describes WHEN to invoke a skill)
  // is the wrong source — that bug shipped once (2026-04-28) producing agents
  // that introduced themselves as "Claude" until the user explicitly named
  // the persona.
  const personaSystemPrompt = finalContent;

  // All writes in a single transaction: if any part fails, the entire
  // operation rolls back so the idempotency check on re-run will retry
  // from scratch instead of skipping a partially-created persona.
  const agentRow = await db.transaction(async (tx) => {
    // INSERT agents row
    const [row] = await tx
      .insert(agents)
      .values({
        name: spec.display_name,
        role: parsed.frontmatter_description.split(/[\n。]/)[0]?.slice(0, 200) ?? null,
        avatarUrl: null,
        personaDescription: personaSystemPrompt,
        initialMessage: initialMessage,
        isDefault: true,
        ownerUserId: null,
        slug: spec.slug,
        sourceType: null,
        sourceUrl: null,
      })
      .returning({ id: agents.id });
    if (!row) {
      throw new Error('agents INSERT returned no row');
    }
    const agentId = row.id;

    // INSERT agent_skills row with inline_content
    await tx.insert(agentSkills).values({
      agentId: agentId,
      skillName: spec.slug,
      enabled: true,
      sortOrder: 0,
      description: parsed.frontmatter_description.split(/[\n。]/)[0]?.slice(0, 200) ?? null,
      inlineContent: finalContent,
    });

    // Backfill user_agents for all existing users (local_users table)
    const users = await tx
      .select({ id: localUsers.id })
      .from(localUsers);

    if (users.length > 0) {
      for (const u of users) {
        await tx.insert(userAgents).values({
          userId: u.id,
          agentId: agentId,
          isRemovable: true,
        }).onConflictDoNothing();
      }
    }

    return { row, userCount: users.length };
  });
  const agentId = agentRow.row.id;

  console.log(
    `[import] ${spec.slug}: agent_id=${agentId} ` +
      `(${spec.display_name}, ${finalContent.length} bytes, backfilled ${agentRow.userCount} users)`
  );
  return 'imported';
}

async function main() {
  console.log('[import] Cloning nuwa-skill upstream...');
  const tmp = mkdtempSync(path.join(tmpdir(), 'nuwa-import-'));
  try {
    execSync(`git clone --depth 1 https://github.com/alchaincyf/nuwa-skill.git "${tmp}/nuwa"`, {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    const upstreamRoot = path.join(tmp, 'nuwa');

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    for (const spec of PERSONAS) {
      const result = await importPersona(spec, upstreamRoot);
      if (result === 'imported') imported += 1;
      else if (result === 'skipped') skipped += 1;
      else failed += 1;
    }

    console.log('');
    console.log(`[import] Summary: imported=${imported} skipped=${skipped} failed=${failed}`);
    if (failed > 0) process.exit(1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
