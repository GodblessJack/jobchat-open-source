// jchat/scripts/precheck.mjs — env validation + execution mode detection
import 'dotenv/config';

const required = {
  ANTHROPIC_API_KEY: 'hard',
  ANTHROPIC_BASE_URL: 'soft',
  OPENAI_API_KEY: 'soft',
};

const missing = { hard: [], soft: [] };
for (const [k, level] of Object.entries(required)) {
  if (!process.env[k]) missing[level].push(k);
}

const report = {
  timestamp: new Date().toISOString(),
  hardMissing: missing.hard,
  softMissing: missing.soft,
  modes: {
    embeddingProvider: process.env.OPENAI_API_KEY ? 'openai' : 'stub-zero-vector',
  }
};

console.log(JSON.stringify(report, null, 2));
if (missing.hard.length > 0) {
  console.error('PRECHECK FAILED: missing required env vars:', missing.hard);
  process.exit(1);
}
process.exit(0);
