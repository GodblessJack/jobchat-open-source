#!/usr/bin/env node

import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('Error: GEMINI_API_KEY is not set');
  process.exit(1);
}

// Configure proxy if set (Node.js native fetch doesn't read env vars)
const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY;
if (proxyUrl) {
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici');
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  } catch (_) {
    // undici not available, proceed without proxy
  }
}

const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-3-flash-preview';

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const result = { prompt: '', history: '[]', attachments: '[]', maxHistory: '40' };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prompt' && args[i + 1]) {
      result.prompt = args[++i];
    } else if (args[i] === '--history' && args[i + 1]) {
      result.history = args[++i];
    } else if (args[i] === '--attachments' && args[i + 1]) {
      result.attachments = args[++i];
    } else if (args[i] === '--max-history' && args[i + 1]) {
      result.maxHistory = args[++i];
    }
  }

  if (!result.prompt) {
    console.error('Error: --prompt is required');
    process.exit(1);
  }

  return result;
}

async function main() {
  const args = parseArgs();

  const ai = new GoogleGenAI({ apiKey: API_KEY });

  // Parse history and apply sliding window
  const MAX_HISTORY = parseInt(args.maxHistory, 10) || 40;
  let history = [];
  try {
    history = JSON.parse(args.history);
  } catch {
    history = [];
  }
  const recentHistory = history.slice(-MAX_HISTORY);

  // Convert history to Gemini format
  const historyContents = recentHistory.map(msg => ({
    role: msg.role === 'model' ? 'model' : 'user',
    parts: [{ text: msg.content || '' }]
  }));

  // Process attachments — read local files and convert to base64 inlineData
  let attachmentParts = [];
  let attachments = [];
  try {
    attachments = JSON.parse(args.attachments);
  } catch {
    // No attachments or invalid JSON — continue without
  }
  for (const att of attachments) {
    const fileData = fs.readFileSync(att.path);
    const base64 = fileData.toString('base64');
    attachmentParts.push({
      inlineData: {
        data: base64,
        mimeType: att.mimeType
      }
    });
  }

  // Build current user message
  const currentMessage = {
    role: 'user',
    parts: [
      ...attachmentParts,
      { text: args.prompt }
    ]
  };

  const allContents = [...historyContents, currentMessage];

  // Call Gemini API (streaming, collect full response)
  const response = await ai.models.generateContentStream({
    model: CHAT_MODEL,
    contents: allContents,
    config: {
      tools: [{ googleSearch: {} }],
      thinkingConfig: {
        thinkingBudget: 1024
      }
    }
  });

  // Collect and output full response
  for await (const chunk of response) {
    const text = chunk.text;
    if (text) {
      process.stdout.write(text);
    }
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
