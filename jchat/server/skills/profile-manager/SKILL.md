---
name: profile-manager
description: 管理用户个人资料（基本信息、偏好、记忆、昵称、头像）。触发词：改名字, 换头像, 修改资料, 生成头像, 我的信息, 帮我记住, 忘掉, 我的记忆, 偏好设置, change name, update profile, generate avatar, my profile, remember, forget, preferences
category: assistant
tags: [profile, avatar, preferences, memory]
---

# Profile Manager

通过对话管理用户个人资料。支持查看/修改基本信息、偏好设置、记忆管理、昵称修改、AI 头像生成和头像上传。

## 核心原则

1. **先读后写** — 所有修改操作前必须先读取当前值和 `profile_version`
2. **乐观锁** — 所有写操作必须传 `--version N`，冲突时重新读取再重试
3. **段级更新** — 禁止整字段替换 `basic_info` / `preferences` / `memory`，必须用 `--section` 或 `--append`
4. **脚本决定论** — LLM 不做 markdown 合并，脚本处理段级更新

## 环境变量

- `$SCRIPTS_DIR` — 脚本目录路径
- `$CURRENT_USER_ID` — 当前用户 ID（唯一来源，禁止硬编码）

## 调用格式

```bash
bash node "$SCRIPTS_DIR/script-name.js" --user-id "$CURRENT_USER_ID" [options]
```

内容通过 heredoc 传入，防止 shell 转义问题：

```bash
cat <<'EOF' | node "$SCRIPTS_DIR/profile-update.js" --user-id "$CURRENT_USER_ID" --field <field> --section "段名" --version N
内容正文
EOF
```

---

## 模块 1：查看资料

读取用户全部资料并格式化展示。

```bash
bash node "$SCRIPTS_DIR/profile-read.js" --user-id "$CURRENT_USER_ID" --field all
```

展示格式：

```
你的个人资料：
- 昵称：{full_name}
- 职位：{basic_info.职位 或 "未设置"}
- 简介：{basic_info.简介 或 "未设置"}
- 学历：{basic_info.学历 或 "未设置"}
- 工作经验：{basic_info.工作经验 或 "未设置"}
- 电话：{basic_info.电话 或 "未设置"}
- 偏好：{preferences 摘要}
- 记忆条目数：{memory 段数}

你想修改哪项？
```

---

## 模块 2：修改基本信息

**字段**: `basic_info`
**已知段名**: 职位, 简介, 学历, 工作经验, 电话（也支持用户自定义段名）

### 流程

1. 读取当前值 + 版本号：

```bash
bash node "$SCRIPTS_DIR/profile-read.js" --user-id "$CURRENT_USER_ID" --field basic_info
```

2. 段级更新（以修改"职位"为例）：

```bash
cat <<'EOF' | node "$SCRIPTS_DIR/profile-update.js" --user-id "$CURRENT_USER_ID" --field basic_info --section "职位" --version 3
Senior Software Engineer @ Google
EOF
```

3. 若返回版本冲突错误，重新读取最新版本后重试。

---

## 模块 3：修改偏好

**字段**: `preferences`
**已知段名**: 语言偏好, 回复风格, 通知偏好（也支持用户自定义段名）

### 流程

1. 读取当前偏好 + 版本号：

```bash
bash node "$SCRIPTS_DIR/profile-read.js" --user-id "$CURRENT_USER_ID" --field preferences
```

2. 段级更新（以修改"回复风格"为例）：

```bash
cat <<'EOF' | node "$SCRIPTS_DIR/profile-update.js" --user-id "$CURRENT_USER_ID" --field preferences --section "回复风格" --version 5
简洁直接，少用emoji，技术问题给代码示例
EOF
```

3. 版本冲突时重新读取再重试。

---

## 模块 4：记忆操作

**字段**: `memory`
**命名空间**: 按 source 隔离，格式为 `## [Source] 标题`
**容量限制**: 50KB — 超出时建议用户清理旧条目

### 添加记忆

必须带 `--source "Assistant"`：

```bash
cat <<'EOF' | node "$SCRIPTS_DIR/profile-update.js" --user-id "$CURRENT_USER_ID" --field memory --append --source "Assistant"
## [Assistant] 用户偏好 Python 而非 Java
用户在 2026-03-28 的对话中明确表示更喜欢 Python。
EOF
```

### 删除记忆

默认只删除 `[Assistant]` 命名空间的条目，除非用户明确指定其他命名空间：

```bash
bash node "$SCRIPTS_DIR/profile-update.js" --user-id "$CURRENT_USER_ID" --field memory --remove-section "[Assistant] 用户偏好 Python 而非 Java"
```

---

## 模块 5：改昵称

**字段**: `full_name`

### 流程

1. 读取当前昵称 + 版本号：

```bash
bash node "$SCRIPTS_DIR/profile-read.js" --user-id "$CURRENT_USER_ID" --field full_name
```

2. 直接更新：

```bash
echo "Jack" | node "$SCRIPTS_DIR/profile-update.js" --user-id "$CURRENT_USER_ID" --field full_name --version 2
```

3. 版本冲突时重新读取再重试。

---

## 模块 6：AI 头像

### 流程

1. **先询问风格偏好**（必须在生成前确认）：
   - 职业照风格（Professional）
   - 卡通插画风（Cartoon / Illustration）
   - 简约几何风（Minimal / Geometric）
   - 其他（用户自定义描述）

2. 根据用户选择构造 prompt，调用生成脚本：

```bash
bash node "$SCRIPTS_DIR/avatar-generate.js" --user-id "$CURRENT_USER_ID" --prompt "A professional avatar portrait, clean background, warm lighting, modern aesthetic, approachable and confident, square format"
```

3. 脚本自动完成：生成图片 → 上传 Storage → 更新数据库。

4. 确认结果，如不满意可重新生成。

---

## 模块 7：上传头像

用户发送图片文件作为头像时：

```bash
bash node "$SCRIPTS_DIR/avatar-upload.js" --user-id "$CURRENT_USER_ID" --file /tmp/user-uploaded-avatar.jpg
```

脚本自动完成：上传 Storage → 更新数据库 → 返回新 URL。

---

## Critical Rules

1. **ALWAYS read before modify** — 先读取当前值和 `profile_version`，再执行写操作
2. **NEVER do full-field replacement** — 对 `basic_info` / `preferences` / `memory` 禁止整字段覆盖，必须用 `--section` 或 `--append`
3. **Memory append ALWAYS includes `--source "Assistant"`** — 记忆写入必须标注来源
4. **Memory remove only targets `[Assistant]` namespace** — 除非用户明确指定其他命名空间
5. **Avatar generation: ask style preference BEFORE generating** — 生成头像前必须先确认风格
6. **user_id from `$CURRENT_USER_ID` only** — 禁止硬编码，禁止从其他来源获取
7. **Version conflict → re-read and retry** — 乐观锁冲突时重新读取最新版本后重试
8. **50KB memory limit** — 超出时提醒用户清理，不要静默丢弃
