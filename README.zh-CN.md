<div align="center">
  <img src="landing/src/assets/logo.png" alt="JobChat" width="180" />
  <h1>JobChat</h1>
  <p><strong>可自托管的 AI 团队协作工作台。</strong></p>
  <p>创建拥有不同角色与能力的 AI 联系人，通过单聊、群聊和实时通话开展工作。</p>

  <p>
    <a href="https://github.com/GodblessJack/jobchat-open-source/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache-2.0 许可证" /></a>
    <a href="https://github.com/GodblessJack/jobchat-open-source/actions/workflows/ci.yml"><img src="https://github.com/GodblessJack/jobchat-open-source/actions/workflows/ci.yml/badge.svg" alt="CI 状态" /></a>
  </p>
  <p><a href="README.md">English</a> · <a href="https://jobchat.io">官网</a> · <a href="docs/ARCHITECTURE.md">架构</a> · <a href="docs/CONFIGURATION.md">配置</a> · <a href="CONTRIBUTING.md">贡献指南</a></p>
</div>

![JobChat 单聊与联系人资料](docs/assets/contacts-chat.webp)

## 为什么选择 JobChat？

JobChat 让每位 AI 联系人拥有独立的角色、说明和可复用能力，并将它们集中在熟悉的协作界面中。你可以在自己的基础设施上保存会话与数据，而不必依赖托管工作台。

仓库包含完整的核心流程，覆盖聊天、通话、持久会话和长期记忆。

## 主要功能

- **专业 AI 联系人**：为不同工作配置角色、说明和能力组合。
- **单聊与群聊**：支持实时消息、提及、附件和会话历史。
- **实时通话**：与联系人进行音视频通话，并将转录保存回会话。
- **长期记忆**：跨会话召回相关上下文。
- **默认自托管**：由你掌控账号、会话和数据。

<details>
  <summary><strong>查看落地页截图</strong></summary>
  <br />
  <img src="docs/assets/landing.webp" alt="JobChat 落地页" width="900" />
</details>

## 快速开始

你需要 Node.js 22+、npm 10+、Docker Compose v2 或 PostgreSQL 16+ 与 pgvector，以及受支持的模型服务密钥。

### 1. 克隆并安装依赖

```bash
git clone https://github.com/GodblessJack/jobchat-open-source.git
cd jobchat-open-source

npm ci
npm --prefix jchat ci
npm --prefix meeting ci
npm --prefix landing ci
```

### 2. 配置 JobChat

```bash
cp .env.example .env
cp jchat/.env.example jchat/.env
cp landing/.env.example landing/.env
cp meeting/.env.example meeting/.env
```

按照[配置指南](docs/CONFIGURATION.md)设置必需的数据库、模型服务和本地账号选项。可选集成可以稍后再配置。

### 3. 初始化并启动

```bash
npm run db:up
npm --prefix jchat run bootstrap
npm run dev
```

初始化命令会准备数据库和本地账号。启动完成后，使用你配置的账号登录即可。

## 部署

JobChat 支持自托管生产部署和 Docker。运行 `npm run build` 构建应用，然后按照[配置指南](docs/CONFIGURATION.md)和[架构指南](docs/ARCHITECTURE.md)完成生产部署。

提供托管服务或分发预构建镜像前，请阅读[运行时条款](docs/RUNTIME_TERMS.md)。

## 架构概览

JobChat 将网页聊天与通话、后端服务、持久数据和隔离运行时工作区整合为一个自托管系统。进程边界与数据流详见[架构指南](docs/ARCHITECTURE.md)。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [架构指南](docs/ARCHITECTURE.md) | 进程、数据流与运行时边界 |
| [配置指南](docs/CONFIGURATION.md) | 环境变量与模型服务配置 |
| [安全审计](docs/SECURITY_AUDIT.md) | 发布安全检查与依赖策略 |
| [运行时条款](docs/RUNTIME_TERMS.md) | 专有 Claude Agent SDK 的使用与分发条款 |
| [贡献指南](CONTRIBUTING.md) | 开发与 Pull Request 流程 |
| [更新日志](CHANGELOG.md) | 版本历史 |

## 安全说明

不要提交真实环境文件、凭证、运行时数据、上传文件或数据库导出。安全漏洞请按照 [SECURITY.md](SECURITY.md) 中的流程私下报告。

## 参与贡献

欢迎贡献。提交 Pull Request 前，请阅读[贡献指南](CONTRIBUTING.md)和[行为准则](CODE_OF_CONDUCT.md)。

## 许可证与声明

JobChat 采用 [Apache License 2.0](LICENSE)。第三方组件与素材来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，附加许可证文本位于 [`licenses/`](licenses/)。

Claude Agent SDK 及其 bundled 二进制是 Anthropic 的专有依赖，不属于 JobChat 的 Apache 许可范围。提供托管服务或分发预构建镜像前，请阅读 [docs/RUNTIME_TERMS.md](docs/RUNTIME_TERMS.md)。

基于公众人物的内置联系人仅为虚构演示，不代表相关人物本人，也不存在隶属或背书关系。
