<div align="center">
  <img src="landing/src/assets/logo.png" alt="JobChat" width="180" />
  <h1>JobChat</h1>
  <p><strong>A self-hosted workspace for your AI team.</strong></p>
  <p>Create specialized AI contacts, collaborate in direct or group chats, and talk with them over realtime calls.</p>

  <p>
    <a href="https://github.com/GodblessJack/jobchat-open-source/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache-2.0 license" /></a>
    <a href="https://github.com/GodblessJack/jobchat-open-source/actions/workflows/ci.yml"><img src="https://github.com/GodblessJack/jobchat-open-source/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  </p>
  <p><a href="https://jobchat.io">Website</a> · <a href="docs/ARCHITECTURE.md">Architecture</a> · <a href="docs/CONFIGURATION.md">Configuration</a> · <a href="CONTRIBUTING.md">Contributing</a> · <a href="README.zh-CN.md">简体中文</a></p>
</div>

![JobChat direct conversation and contact profile](docs/assets/contacts-chat.webp)

## Why JobChat?

JobChat gives each AI contact a distinct role, instructions, and reusable capabilities, then brings them together in one familiar collaboration interface. You can keep conversations and data on your own infrastructure instead of relying on a hosted workspace.

The repository includes the complete core workflow, from chat and calls to persistent conversations and long-term memory.

## Features

- **Specialized AI contacts** — define roles, instructions, and capability packs for different kinds of work.
- **Direct and group chats** — exchange realtime messages, mentions, and attachments with persistent history.
- **Realtime calls** — talk with contacts over audio or video and save transcripts back to the conversation.
- **Long-term memory** — recall relevant context across conversations.
- **Self-hosted by default** — keep accounts, conversations, and data under your control.

<details>
  <summary><strong>View the landing page</strong></summary>
  <br />
  <img src="docs/assets/landing.webp" alt="JobChat landing page" width="900" />
</details>

## Quick start

You will need Node.js 22+, npm 10+, Docker with Compose v2 or PostgreSQL 16+ with pgvector, and a supported model provider key.

### 1. Clone and install

```bash
git clone https://github.com/GodblessJack/jobchat-open-source.git
cd jobchat-open-source

npm ci
npm --prefix jchat ci
npm --prefix meeting ci
npm --prefix landing ci
```

### 2. Configure JobChat

```bash
cp .env.example .env
cp jchat/.env.example jchat/.env
cp landing/.env.example landing/.env
cp meeting/.env.example meeting/.env
```

Follow the [configuration guide](docs/CONFIGURATION.md) to set the required database, model provider, and local account options. Optional integrations can be configured later.

### 3. Initialize and start

```bash
npm run db:up
npm --prefix jchat run bootstrap
npm run dev
```

The bootstrap command prepares the database and your local account. Once startup is complete, sign in with the account you configured.

## Deployment

JobChat supports self-hosted production deployments and Docker. Run `npm run build` to build the applications, then follow the [configuration guide](docs/CONFIGURATION.md) and [architecture guide](docs/ARCHITECTURE.md) for production setup.

Review the [runtime terms](docs/RUNTIME_TERMS.md) before offering a hosted service or distributing a prebuilt image.

## Architecture

JobChat combines web-based chat and calls, backend services, persistent data, and isolated runtime workspaces in one self-hosted system. See the [architecture guide](docs/ARCHITECTURE.md) for process boundaries and data flow.

## Documentation

| Guide | Purpose |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | Processes, data flow, and runtime boundaries |
| [Configuration](docs/CONFIGURATION.md) | Environment variables and provider settings |
| [Security audit](docs/SECURITY_AUDIT.md) | Release security checks and dependency policy |
| [Runtime terms](docs/RUNTIME_TERMS.md) | Proprietary Claude Agent SDK usage and distribution terms |
| [Contributing](CONTRIBUTING.md) | Development and pull-request workflow |
| [Changelog](CHANGELOG.md) | Release history |

## Security

Do not commit real environment files, credentials, runtime data, uploads, or database dumps. Please report vulnerabilities privately through the process in [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) before opening a pull request.

## License and notices

JobChat is licensed under [Apache License 2.0](LICENSE). Third-party components and media are credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), with additional license texts in [`licenses/`](licenses/).

The Claude Agent SDK and its bundled binary are proprietary Anthropic dependencies, not Apache-licensed JobChat code. Review [docs/RUNTIME_TERMS.md](docs/RUNTIME_TERMS.md) before offering a hosted service or distributing a prebuilt image.

Built-in contacts based on public figures are fictional demonstrations. They are not affiliated with, endorsed by, or speaking for those individuals.
