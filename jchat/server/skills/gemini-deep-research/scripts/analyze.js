#!/usr/bin/env node

import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('Error: GEMINI_API_KEY is not set');
  process.exit(1);
}

const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-3-flash-preview';

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
  let files = '[]';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--files' && args[i + 1]) {
      files = args[++i];
    }
  }

  return { files };
}

async function main() {
  const args = parseArgs();

  let files = [];
  try {
    files = JSON.parse(args.files);
  } catch {
    files = [];
  }

  if (files.length === 0) {
    process.stdout.write('未上传任何参考资料，将仅根据用户主题进行研究。');
    return;
  }

  // Read local files and convert to base64 inlineData (skip unreadable files)
  const parts = [];
  for (const f of files) {
    try {
      const fileData = fs.readFileSync(f.path);
      const base64 = fileData.toString('base64');
      parts.push({
        inlineData: {
          mimeType: f.mimeType || 'text/plain',
          data: base64
        }
      });
    } catch (err) {
      console.error(`Warning: Could not read file ${f.path}: ${err.message}`);
    }
  }

  if (parts.length === 0) {
    process.stdout.write('文件读取失败，将仅根据用户主题进行研究。');
    return;
  }

  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = '请直接、完整地提起并输出这些附件的所有原始文本内容。不要进行任何分析、总结或提炼，请务必忠实于原件，将提取出的内容原样整理在 markdown 标记中输出。';

  const response = await ai.models.generateContent({
    model: CHAT_MODEL,
    contents: { parts: [...parts, { text: prompt }] },
    config: {
      thinkingConfig: {
        thinkingBudget: 1024
      }
    }
  });

  process.stdout.write(response.text || '');
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
