#!/usr/bin/env node

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('Error: GEMINI_API_KEY is not set');
  process.exit(1);
}

// Configure proxy if set
const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY;
if (proxyUrl) {
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici');
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  } catch (_) {}
}

// Hardcoded safety limit
const MAX_POLL_DURATION_MS = 25 * 60 * 1000; // 25 minutes

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let id = '';
  let startTime = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id' && args[i + 1]) {
      id = args[++i];
    } else if (args[i] === '--start-time' && args[i + 1]) {
      startTime = args[++i];
    }
  }

  if (!id) {
    console.error('Error: --id is required');
    process.exit(1);
  }

  return { id, startTime };
}

async function main() {
  const args = parseArgs();

  // Check hardcoded timeout if start time provided
  if (args.startTime) {
    const elapsed = Date.now() - parseInt(args.startTime, 10);
    if (elapsed > MAX_POLL_DURATION_MS) {
      process.stdout.write(JSON.stringify({
        status: 'timeout',
        error: `研究已超过 25 分钟限制（已用 ${Math.round(elapsed / 60000)} 分钟），强制终止。`,
        elapsedMs: elapsed,
      }));
      return;
    }
  }

  // Clean ID: strip "interactions/" prefix if present
  let interactionId = args.id;
  if (interactionId.startsWith('interactions/')) {
    interactionId = interactionId.replace('interactions/', '');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/interactions/${interactionId}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-goog-api-key': API_KEY,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const errorBody = await response.text();
    // Output structured error instead of throwing
    process.stdout.write(JSON.stringify({
      status: 'poll_error',
      error: `Poll failed: ${response.status} - ${errorBody}`,
    }));
    return;
  }

  const data = await response.json();

  // Output JSON with status and outputs
  const result = {
    status: data.status,
    outputs: data.outputs || null
  };

  process.stdout.write(JSON.stringify(result));
}

main().catch(err => {
  // Structured error output for caller to parse
  process.stdout.write(JSON.stringify({
    status: 'poll_error',
    error: err.message,
  }));
  process.exit(1);
});
