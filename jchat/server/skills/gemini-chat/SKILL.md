---
name: gemini-chat
description: 默认 Skill — 使用 Gemini AI 与用户对话，支持附件分析、互联网搜索、快速问答。这是 Gemini Agent 的主力 skill，处理日常对话、文件分析、联网搜索、快速知识问答等所有非深度研究的任务。
---

# Gemini Chat（默认 Skill）

通过 Gemini AI 回答用户问题，支持多模态附件分析和 Google Search。

## 适用场景（优先使用此 Skill）

- 用户的日常问答、闲聊
- 文件/图片/视频/音频分析
- 联网搜索获取实时信息
- 快速知识查询和解释
- "帮我看看这个"、"分析一下"、"了解一下" 等模糊请求（经路由追问确认后）
- 所有**非**深度研究报告的任务

## 脚本路径

脚本位于当前 skill 目录下：找到本 SKILL.md 所在目录，脚本在 `scripts/chat.js`。

## 使用方式

用户发送任何普通对话消息时，调用此 skill 将消息转发给 Gemini AI。

### 1. 处理附件

如果用户消息中包含 `supabase://` 链接（表示用户上传了文件），先下载到本地：

```bash
node ${SCRIPTS_DIR}/download-file.js "supabase://chat-files/userId/filename"
```

脚本输出本地文件路径（如 `/tmp/chat-downloads/1234_file.pdf`）。记下路径和文件的 MIME 类型。

### 2. 构建对话历史

从对话历史中提取最近的消息（系统已注入），转换为 JSON 数组格式：

```json
[
  {"role": "user", "content": "之前的问题"},
  {"role": "model", "content": "之前的回答"}
]
```

注意：历史中的 `role` 为 `assistant` 时，需转换为 `model`。

### 3. 调用 Gemini Chat 脚本

将 prompt 写入临时文件避免 shell 引号问题：

```bash
cat > /tmp/gemini-chat-prompt.txt << 'PROMPT_EOF'
用户的消息内容
PROMPT_EOF
```

然后调用脚本：

**纯文本对话：**
```bash
node ${SCRIPTS_DIR}/../skills-source/gemini-chat/scripts/chat.js \
  --prompt "$(cat /tmp/gemini-chat-prompt.txt)" \
  --history '对话历史JSON'
```

**带附件对话：**
```bash
node ${SCRIPTS_DIR}/../skills-source/gemini-chat/scripts/chat.js \
  --prompt "$(cat /tmp/gemini-chat-prompt.txt)" \
  --history '对话历史JSON' \
  --attachments '[{"path":"/tmp/chat-downloads/1234_file.pdf","mimeType":"application/pdf"}]'
```

### 4. 输出处理

将脚本的 stdout 输出**直接**作为回复发送给用户，不做二次加工。Gemini 的回复已经是完整的 Markdown 格式。

## 支持的附件类型

图片（image/*）、视频（video/*）、音频（audio/*）、PDF、Word 文档。

## 注意事项

- **不要**对 Gemini 的回复做摘要、翻译或改写，原样输出
- 如果脚本报错（exit code 1），将 stderr 中的错误信息告知用户
- 环境变量 `GEMINI_API_KEY` 已由系统注入，无需手动传递
- `SCRIPTS_DIR` 环境变量指向 `chat/server/scripts/` 目录
