#!/usr/bin/env node

import { GoogleGenAI } from '@google/genai';

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
  const result = { topic: '', context: '' };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--topic' && args[i + 1]) {
      result.topic = args[++i];
    } else if (args[i] === '--context' && args[i + 1]) {
      result.context = args[++i];
    }
  }

  if (!result.topic) {
    console.error('Error: --topic is required');
    process.exit(1);
  }

  return result;
}

async function main() {
  const args = parseArgs();

  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `**你的任务是：**
根据以下信息，生成一份结构清晰、符合专业视角的**研究计划框架**。
格式严格遵循以下范例：

---

### 范例格式
**研究目标：** [一句话概括整个计划的核心目的]

**子任务列表：**
1. [子任务一内容，仅描述研究方向或目标，不含具体细节]
2. [子任务二内容，保持抽象，不指定方法或结论]
3. [子任务三内容，避免细节预设]
...

---

**请开始生成。不要返回任何其他内容，只返回研究计划内容。**

用户研究主题: ${args.topic}
附件原始文本内容: ${args.context || '无'}

请输出 Markdown 格式的研究计划。列表只需要标题和简单的子任务描述。`;

  const response = await ai.models.generateContent({
    model: CHAT_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
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
