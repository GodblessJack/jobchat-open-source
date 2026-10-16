#!/usr/bin/env node

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('Error: GEMINI_API_KEY is not set');
  process.exit(1);
}

const RESEARCH_MODEL = process.env.GEMINI_RESEARCH_MODEL || 'deep-research-pro-preview-12-2025';

// Configure proxy if set
const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY;
if (proxyUrl) {
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici');
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  } catch (_) {}
}

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let input = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      input = args[++i];
    }
  }

  if (!input) {
    console.error('Error: --input is required');
    process.exit(1);
  }

  return { input };
}

async function main() {
  const args = parseArgs();

  const url = 'https://generativelanguage.googleapis.com/v1beta/interactions';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      input: args.input,
      agent: RESEARCH_MODEL,
      background: true
    })
  });

  if (!response.ok) {
    const errorResult = await response.json().catch(() => ({}));
    throw new Error(errorResult?.error?.message || `HTTP ${response.status}`);
  }

  const data = await response.json();

  // Output JSON with id and status
  process.stdout.write(JSON.stringify({
    id: data.id,
    status: data.status
  }));
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
