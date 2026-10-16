---
name: wechat-case-study-writer
description: >
  将求职案例数据转化为故事驱动的微信公众号文章。
  Use when user asks "写公众号案例", "微信文章", "求职案例文章",
  "case study article", "wechat article", "写案例".
category: content-creation
tags: [writing, wechat, case-study, story]
---

# 微信公众号求职案例写作

本 Skill 将结构化的求职案例数据转化为故事驱动、情感丰富的微信公众号文章。以求职机构创始人/导师的视角讲述客户的求职故事，通过故事引擎为每篇文章生成独特的叙事弧光。

## Agent 执行指令

**重要**：执行本 Skill 前必须完成以下设置：
1. 确定本 SKILL.md 文件所在目录路径，记为 `SKILL_DIR`
2. 将本文档中所有 `${SKILL_DIR}` 替换为实际路径
3. 资源文件路径 = `${SKILL_DIR}/resources/<文件名>.md`

**资源文件清单**：
| 文件 | 用途 | 何时读取 |
|------|------|----------|
| `${SKILL_DIR}/resources/case_study_structure.md` | 输入数据结构与输出文章结构 | 步骤1：理解案例数据格式 |
| `${SKILL_DIR}/resources/story_engine.md` | 核心矛盾识别 + 故事弧光生成 | 步骤2：分析核心矛盾、选择叙事弧光 |
| `${SKILL_DIR}/resources/writing_style.md` | 写作风格指南（口语化、情感、金句） | 步骤3：创作时加载风格 |
| `${SKILL_DIR}/resources/article_template.md` | 文章结构模板 | 步骤3：创作时参照模板 |

## Workspace Rules

**IMPORTANT**: All file operations MUST use the session workspace directory.

- **Use relative paths only** for output files
- **NEVER write to `.claude/skills/`** - this is read-only
- **All output files** must be created in the workspace using relative paths

## 执行流程

### 步骤1：获取案例数据

用户在对话中直接提供案例数据。阅读 `${SKILL_DIR}/resources/case_study_structure.md`，理解输入数据结构（五大部分）：
1. 背景介绍（学历、Offer、公司）
2. 面试 Timeline
3. 口述记录面经分享
4. 遇到的挑战
5. 解决困难

如果用户提供的数据缺少某些部分，主动询问补充。

### 步骤2：分析核心矛盾 & 选择故事弧光

阅读 `${SKILL_DIR}/resources/story_engine.md`：

1. **识别核心矛盾**：从六种矛盾类型中找到最匹配的（认知错配 / 技能短板 / 软实力缺失 / 项目经验匮乏 / 心态崩溃 / 跨界转行）
2. **选择故事弧光**：根据核心矛盾选择叙事结构（"顿悟"时刻 / "绝境逢生" / "强项致胜" / "慢工出细活" / "体系重塑"）
3. **提炼金句**：从故事本身提炼结尾金句，不从预设列表选取

将分析结果简要告知用户，然后进入创作。

### 步骤3：创作文章

加载以下资源：
- `${SKILL_DIR}/resources/writing_style.md` — 写作风格（口语化、情感表达、金句总结）
- `${SKILL_DIR}/resources/article_template.md` — 文章结构模板

按模板结构创作，严格遵守：
- **叙事视角**：机构创始人/导师视角，用「我们」讲述客户故事
- **真实感**：口语化表达，包含真实判断和感慨
- **画面感**：场景化描写，白描手法串联人物事件
- **情感表达**：不回避情绪，直接表达喜悦、感慨
- **长度限制**：整篇文章（标题到结尾微信号）控制在 **1000 字符以内**

### 步骤4：交付确认

将完成的文章展示给用户：
- 附上核心矛盾分析和选用的故事弧光
- 确认文章长度是否在 1000 字符以内
- 用户可要求修改语气、内容或结构

## 文章结构速查

```
[标题]
[场景化引言]
• 学校背景: ...
• 斩获 Offer: ...
• "这家公司，我必须得说道说道": ...

## 这个同学的求职路
[面试Timeline故事化]

## 面试里到底考了啥
[面试题干货 + 点评]

## 这个同学当时面临的挑战
[故事低谷]

## 我们是怎么帮TA上岸的
[故事高潮 + 机构价值]

———
加我好友: [微信号],  围观更多上岸详细信息
```

## Distinction

- **wechat-case-study-writer** = 将单个求职案例数据转化为故事驱动的公众号文章（1000字以内，案例故事）
- **student-job-search-writer** = 撰写风格鲜明的留学生求职干货长文（心态/转行/技巧/行业/面经/政策，干货文章）

使用 wechat-case-study-writer 当用户有具体案例数据要写成文章。使用 student-job-search-writer 当用户需要某个求职话题的深度干货内容。
