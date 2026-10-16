# JobChat

> **Get Jobs Done. All of Them.**
>
> 一个可自托管的 AI 联系人协作工作台。

[English](README.md) | [官网](https://jobchat.io) | [Apache-2.0](LICENSE)

## 项目简介

JobChat 允许你创建具有不同角色、身份说明和能力的 AI 联系人，并通过单聊、群聊和实时通话与它们协作。仓库包含聊天运行时、落地页、通话界面、本地认证、PostgreSQL 持久化、向量记忆和生产网关。

核心本地流程不依赖全局 Claude Code、已退役的旧聊天项目或托管 Supabase 项目。

![JobChat 联系人会话](docs/assets/contacts-chat.webp)

## 主要功能

- 自定义 AI 联系人的角色、身份、说明和能力组合
- 单聊、群聊、提及、附件和实时消息
- 实时音视频通话及转录持久化
- 基于 PostgreSQL + pgvector 的记忆召回
- 本地账号密码登录、访问令牌和刷新令牌
- 通过 npm 依赖提供隔离运行时，无需安装全局 CLI
- 通过 gateway 统一提供前端、API 和 WebSocket 入口

## 目录结构

```text
.
├── jchat/                 # 聊天前端、服务端、数据库和测试
├── meeting/               # 实时通话前端
├── landing/               # 落地页和品牌素材
├── docs/                  # 架构、配置和发布素材
├── licenses/              # 第三方许可证文本
├── gateway.js             # 生产静态服务与反向代理
└── docker-compose.yml     # 本地 PostgreSQL + pgvector
```

## 快速开始

### 环境要求

- Node.js 22+、npm 10+
- Docker Compose v2，或已有 PostgreSQL 16+ 与 pgvector
- 用于联系人回复的 Anthropic API Key
- 可选的 OpenAI、Google GenAI、Qwen 和 Slack 配置

### 1. 安装

```bash
git clone https://github.com/GodblessJack/jobchat-open-source.git
cd jobchat-open-source

npm ci
npm --prefix jchat ci
npm --prefix meeting ci
npm --prefix landing ci
```

### 2. 创建配置

```bash
cp .env.example .env
cp jchat/.env.example jchat/.env
cp landing/.env.example landing/.env
cp meeting/.env.example meeting/.env
```

需要修改：

1. 让根目录 `POSTGRES_PASSWORD` 与 `jchat/.env` 中 `DATABASE_URL` 的密码一致。
2. 配置 `ANTHROPIC_API_KEY`。
3. 使用 `openssl rand -hex 64` 分别生成两个 JWT 随机密钥。
4. 为本地开发账号设置至少 12 位的 `JCHAT_LOCAL_PASSWORD`。
5. `JCHAT_SESSIONS_ROOT` 和 `FILES_ROOT` 必须是仓库外的绝对路径，并确保当前用户有读写权限。

完整变量说明见 [docs/CONFIGURATION.md](docs/CONFIGURATION.md)。

### 3. 初始化数据库

```bash
npm run db:up
npm --prefix jchat run bootstrap
```

该命令会执行当前数据库迁移、创建或更新本地账号，并初始化三个示例联系人。重复执行不会重复应用已记录的迁移或重复创建联系人。

### 4. 启动开发环境

```bash
npm run dev
```

| 应用 | 地址 |
| --- | --- |
| 落地页 | http://localhost:5274/ |
| 聊天 | http://localhost:5273/chat |
| 通话 | http://localhost:5180/call/ |
| API 健康检查 | http://localhost:5272/health |

默认账号为 `admin`，密码为你在 `JCHAT_LOCAL_PASSWORD` 中设置的值。

## 生产运行

```bash
npm run build
```

分别运行编译后的服务端和 gateway：

```bash
# 进程 1
npm --prefix jchat start

# 进程 2
npm start
```

生产 gateway 默认监听 `http://localhost:3000/`。构建前请把各模块环境配置改为生产值，并以 `NODE_ENV=production` 运行服务端。

### 容器镜像

```bash
docker build -t jobchat:0.1.0 .
docker run --rm \
  -p 3000:3000 -p 5272:5272 \
  --env-file jchat/.env \
  -v jobchat-sessions:/data/jchat-sessions \
  -v jobchat-files:/data/jobchat/files \
  jobchat:0.1.0
```

`DATABASE_URL` 必须从容器内可达。镜像以非 root 的 `node` 用户运行，并同时启动编译后的服务端与 gateway。分发预构建镜像前，请阅读 `docs/RUNTIME_TERMS.md` 中的专有运行时条款。

## 质量检查

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

默认测试使用专用的测试配置，不调用线上模型 API。真实 SDK 集成测试必须显式启用：

```bash
RUN_SDK_INTEGRATION=1 npm --prefix jchat test -- tests/integration/sdk-pipeline.test.ts
```

## 安全、贡献与许可证

- 不要提交真实 `.env`、会话工作区、上传文件或数据库导出。
- 浏览器侧模型 Key 必须限制 HTTP Referrer 和 API 权限。
- 安全问题请按照 [SECURITY.md](SECURITY.md) 私下报告。
- 贡献代码前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
- 项目采用 [Apache License 2.0](LICENSE)，第三方版权与素材来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

Claude Agent SDK 及其 bundled Claude Code 二进制是 Anthropic 的专有依赖，不属于 JobChat 的 Apache 许可范围。其使用、认证、计费、分发和禁止转售/中转用量等要求见 [docs/RUNTIME_TERMS.md](docs/RUNTIME_TERMS.md)。提供托管服务或分发预构建镜像前必须阅读相关条款。

内置的公众人物联系人仅为软件演示中的虚拟模拟，不代表相关人物本人，也不存在隶属或背书关系。
