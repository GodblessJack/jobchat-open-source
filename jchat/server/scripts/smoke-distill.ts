// jchat/server/scripts/smoke-distill.ts
//
// Manual pre-launch smoke test harness. Boss runs this through the live UI
// against staging — not as an automated CLI flow. This file is the
// scaffold for the report and a documented runbook (see ../README.md).
//
// Usage notes:
//   - Distillation runs interactively in the Jack chat UI; we don't drive
//     it from a CLI WS client (the SDK CLI bundled in jchat does the
//     LLM coordination for us).
//   - This script generates the report template; the human fills in
//     timings + checkpoint observations during/after the run.
//
// Plan: Task 15

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

interface Args {
  handle?: string;
  email?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--x-handle' && argv[i + 1]) out.handle = argv[++i];
    else if (argv[i] === '--user' && argv[i + 1]) out.email = argv[++i];
  }
  return out;
}

const REPORT_TEMPLATE = (handle: string, email: string, date: string) => `# Distill Smoke Test Report

| Field | Value |
|---|---|
| Date | ${date} |
| User | ${email} |
| X handle | @${handle} |
| Source URL | https://x.com/${handle} |

## Phase Timings

(Fill in start/end timestamps as the run progresses. UTC.)

| Phase | Description | Start | End | Duration |
|---|---|---|---|---|
| 0 | Intake triage (auto-skip if explicit "加 ta 好友") | | | |
| 1 | 6-agent parallel research (writings/conversations/expression/external/decisions/timeline) | | | |
| 1.5 | ✋ Checkpoint: review evidence-count table | | | |
| 2 | Framework synthesis (mental models + heuristics + DNA) | | | |
| 2.5 | ✋ Checkpoint: confirm synthesis output | | | |
| 3 | SKILL.md assembly | | | |
| 4 | Quality validation (4-step) | | | |
| 5 | Dual-agent polish | | | |

**Total elapsed:** _____ minutes

## MCP Tool Calls Observed

(Tick the ones that fired during the run.)

- [ ] \`parse_x_url\` — gating check
- [ ] \`check_distillation_quota\` — pre-flight
- [ ] (built-in WebSearch) — used by Phase 1
- [ ] (built-in WebFetch) — used by Phase 1 + 3
- [ ] \`create_contact\` — final persist

## Output

| Field | Value |
|---|---|
| agent_id | |
| slug_resolved | |
| avatar uploaded? | yes/no |
| persona_summary length | |
| skill_md length | |

## Brand Hygiene Re-check

Re-grep transcript + final SKILL.md for residue:
- [ ] No "女娲" in any user-visible chat output
- [ ] No "huashu-nuwa" in any chat output
- [ ] No "造人" in any chat output
- [ ] No "perspective" used as branded term in chat output
- [ ] LICENSE-NOTICE.md untouched (server-only, not surfaced)

## Voice Quality (sample after creation)

After contact appears in ChatList, send a probing question:
> "${'<question that probes the persona\'s mental model>'}"

Paste the response here:

\`\`\`
<paste 100-200 word response>
\`\`\`

Does it feel in-character?
- [ ] Yes — voice / vocabulary / framing matches public materials
- [ ] No — sounds generic ChatGPT
- [ ] Mixed — some authenticity, some drift

## Issues Found

(Bullet list any unexpected behavior. Categorize:)

### Blockers
-

### Warnings
-

### Polish
-

## Disposition

- [ ] **Ship** — clean run, voice authentic, no blockers
- [ ] **Re-test after fixes** — issues found, list them above
- [ ] **Block ship** — fundamental quality issue
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.handle || !args.email) {
    console.error('Usage: tsx server/scripts/smoke-distill.ts --user <email> --x-handle <handle>');
    console.error('');
    console.error('This script writes a report template to .qa-post/. Then:');
    console.error('  1. Open jchat UI, login as <email>');
    console.error('  2. Open Jack contact');
    console.error('  3. Send: "加 ta 为好友 https://x.com/<handle>"');
    console.error('  4. Walk through Phase 1.5 / 2.5 checkpoints');
    console.error('  5. Fill in the report as the run progresses');
    process.exit(1);
  }

  const date = new Date().toISOString().slice(0, 10);
  const outDir = path.join(process.cwd(), '.qa-post');
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `distill-smoke-${args.handle}-${date}.md`);
  await writeFile(outPath, REPORT_TEMPLATE(args.handle, args.email, date));
  console.log(`✅ Report template: ${outPath}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Open jchat UI, login as', args.email);
  console.log('  2. Open Jack contact');
  console.log(`  3. Send: 加 ta 为好友 https://x.com/${args.handle}`);
  console.log('  4. Walk through Phase 1.5 / 2.5 checkpoints');
  console.log('  5. Fill in the report as the run progresses');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
