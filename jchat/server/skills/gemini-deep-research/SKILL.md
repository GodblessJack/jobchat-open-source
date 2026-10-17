---
name: gemini-deep-research
description: 使用 Gemini Deep Research 生成深度研究报告（耗时 5-25 分钟）。仅在用户通过路由追问明确选择"深度研究"后才调用此 skill。禁止因为用户说"研究"、"了解"、"分析"就自动触发。
---

# Gemini Deep Research

使用 Google Gemini Deep Research API 对用户指定的主题进行全面深入的研究，生成专业研究报告。

## ⚠️ 调用前提（强制）

此 Skill **仅在以下条件全部满足时才可调用**：
1. 用户已经通过路由追问流程，**明确选择了"深度研究"选项**
2. 或者用户直接说出了"深度研究"、"deep research"、"写研究报告"等明确无歧义的指令

**以下情况禁止直接调用此 Skill**（应先追问或使用 gemini-chat）：
- 用户说"研究一下" → 可能只是想快速了解，先追问
- 用户说"帮我分析" → 通常 gemini-chat 就能满足
- 用户说"了解一下XXX" → 通常 gemini-chat 就能满足
- 用户上传文件说"看看这个" → 用 gemini-chat 分析文件

## 脚本路径

所有脚本通过 `${SCRIPTS_DIR}` 定位：`${SCRIPTS_DIR}/../skills-source/gemini-deep-research/scripts/`

## 完整流程

### Step 1：文件解析（可选）

如果用户消息中包含 `supabase://` 链接（附件），先下载并解析：

```bash
# 1. 下载附件
node ${SCRIPTS_DIR}/download-file.js "supabase://chat-files/userId/filename"
# 输出本地路径，如 /tmp/chat-downloads/1234_doc.pdf

# 2. 调用 analyze.js 提取文本
node ${SCRIPTS_DIR}/../skills-source/gemini-deep-research/scripts/analyze.js \
  --files '[{"path":"/tmp/chat-downloads/1234_doc.pdf","mimeType":"application/pdf"}]'
```

stdout 输出提取的文本内容。保存为 `fileContext` 变量。

如果没有附件，跳过此步骤，`fileContext` 为空。

### Step 2：生成研究计划

```bash
node ${SCRIPTS_DIR}/../skills-source/gemini-deep-research/scripts/plan.js \
  --topic "用户的研究主题" \
  --context "Step 1 提取的文本（如有）"
```

stdout 输出 Markdown 格式的研究计划。

**将研究计划展示给用户**，并询问：

> 以下是为您生成的研究计划：
>
> {研究计划内容}
>
> 请确认是否开始研究？如需修改，请告诉我您的修改意见。

### Step 3：等待用户确认

- 用户说"开始"、"确认"、"可以"等 → 进入 Step 4
- 用户提出修改意见 → 根据意见重新生成计划（回到 Step 2）

**不要**在用户确认前启动研究。

### Step 4：启动深度研究

组装完整输入并启动研究：

```bash
cat > /tmp/deep-research-input.txt << 'INPUT_EOF'
Research Context:
{fileContext 或 "无"}

Research Plan:
{用户确认的研究计划}

Goal:
{用户的研究主题}

IMPORTANT Output Requirement:
The final report MUST be written in Chinese (Simplified).
You may use English for specific professional terms or proper nouns where appropriate.
Please ensure the report generates structured Markdown suitable for professional reports.
INPUT_EOF

node ${SCRIPTS_DIR}/../skills-source/gemini-deep-research/scripts/start.js \
  --input "$(cat /tmp/deep-research-input.txt)"
```

stdout 输出 JSON：`{"id":"interactions/xxx","status":"in_progress"}`

保存 `id` 用于轮询。

通知用户：
> 深度研究已启动！预计需要 5-25 分钟，我会持续为您更新进度。

### Step 5：轮询研究状态

在启动研究时记录开始时间戳（`Date.now()`），每隔 **30 秒**调用一次：

```bash
node ${SCRIPTS_DIR}/../skills-source/gemini-deep-research/scripts/poll.js \
  --id "interactions/xxx" \
  --start-time "启动时的时间戳毫秒数"
```

stdout 输出 JSON：`{"status":"in_progress|completed|failed|timeout|poll_error","outputs":[...]}`

**每次轮询后向用户发送进度消息**：
> 研究进行中...已过 X 分钟

**终止条件（任一满足即停止轮询）**：
- `status` 为 `completed` → 进入 Step 6
- `status` 为 `failed` → 通知用户研究失败
- `status` 为 `timeout` → 通知用户研究超时（脚本内置 25 分钟硬超时保护）
- `status` 为 `poll_error` → 累计错误，连续 30 次后通知用户网络异常

### Step 6：输出研究报告

从 `outputs` 数组中找到 `type: "text"` 的条目，提取 `text` 内容。

将完整的研究报告（Markdown 格式）发送给用户：

> 研究完成！以下是您的研究报告：
>
> {报告内容}

## 错误处理

| 场景 | 处理 |
|------|------|
| 文件解析失败 | 告知用户，询问是否在无附件情况下继续 |
| 计划生成失败 | 告知用户，建议重试或换个描述 |
| 启动研究失败 | 告知用户，建议等待 60 秒后重试 |
| 轮询连续失败 30 次 | 终止研究，告知用户网络问题 |
| 总时长超 25 分钟 | 终止研究，告知用户超时 |
| status 为 failed | 告知用户研究失败，建议缩小研究范围重试 |

## 注意事项

- 环境变量 `GEMINI_API_KEY` 和 `SCRIPTS_DIR` 已由系统注入，无需手动传递
- 轮询间隔严格 30 秒，使用 `sleep 30` 等待
- 研究报告原样输出，不做二次摘要或改写
