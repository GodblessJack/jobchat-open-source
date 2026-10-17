<div align="center">
  <img src="landing/src/assets/logo.png" alt="JobChat" width="180" />
  <h1>JobChat</h1>
  <p><strong>A self-hosted workspace for your AI team.</strong></p>
  <p>Create specialized AI contacts, collaborate in direct or group chats, and talk with them over realtime calls.</p>

  <p>
    <a href="https://github.com/GodblessJack/jobchat-open-source/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache-2.0 license" /></a>
    <img src="https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white" alt="Node.js 22+" />
    <img src="https://img.shields.io/badge/PostgreSQL-16%20%2B%20pgvector-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL 16 with pgvector" />
    <a href="https://github.com/GodblessJack/jobchat-open-source/actions/workflows/ci.yml"><img src="https://github.com/GodblessJack/jobchat-open-source/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  </p>
  <p><a href="https://jobchat.io">Website</a> · <a href="docs/ARCHITECTURE.md">Architecture</a> · <a href="docs/CONFIGURATION.md">Configuration</a> · <a href="CONTRIBUTING.md">Contributing</a> · <a href="README.zh-CN.md">简体中文</a></p>
</div>

![JobChat direct conversation and contact profile](docs/assets/contacts-chat.webp)

## Why JobChat?

JobChat gives each AI contact a distinct role, instructions, and reusable capabilities, then makes them available in one familiar collaboration interface. You can keep conversations and data on your own infrastructure instead of relying on a hosted workspace.

This repository contains the complete core workflow: chat and call clients, backend services, local authentication, PostgreSQL persistence, vector memory, database migrations, and production packaging. It does not require a global Claude Code installation or a hosted Supabase project.

## Features

- **Specialized AI contacts** — define roles, instructions, and capability packs for different kinds of work.
- **Direct and group chats** — realtime messages, mentions, attachments, and persistent conversation history.
- **Realtime calls** — browser-based audio/video calls with transcripts saved back to the conversation.
- **Long-term memory** — recall relevant context with PostgreSQL and pgvector.
- **Self-hosted by default** — local accounts, isolated runtime workspaces, and no required hosted control plane.
- **One production entry point** — serve the web apps and proxy API, file, and WebSocket traffic through the gateway.

<details>
  <summary><strong>View the landing page</strong></summary>
  <br />
  <img src="docs/assets/landing.webp" alt="JobChat landing page" width="900" />
</details>

## Quick start

### Prerequisites

- Node.js 22+ and npm 10+
- Docker with Compose v2, or PostgreSQL 16+ with pgvector
- An Anthropic API key for contact replies

OpenAI, Google GenAI, Qwen, and Slack credentials are optional and only needed for their respective integrations.

### 1. Clone and install

```bash
git clone https://github.com/GodblessJack/jobchat-open-source.git
cd jobchat-open-source

npm ci
npm --prefix jchat ci
npm --prefix meeting ci
npm --prefix landing ci
```

### 2. Configure the local environment

```bash
cp .env.example .env
cp jchat/.env.example jchat/.env
cp landing/.env.example landing/.env
cp meeting/.env.example meeting/.env
```

Update `.env` and `jchat/.env`:

1. Use the same database password in `POSTGRES_PASSWORD` and `DATABASE_URL`.
2. Set `ANTHROPIC_API_KEY`.
3. Generate two different JWT secrets with `openssl rand -hex 64`.
4. Set a `JCHAT_LOCAL_PASSWORD` of at least 12 characters.
5. Keep `JCHAT_SESSIONS_ROOT` and `FILES_ROOT` at writable absolute paths **outside the repository**.

See the [configuration guide](docs/CONFIGURATION.md) for all settings and optional providers.

### 3. Initialize the database

```bash
npm run db:up
npm --prefix jchat run bootstrap
```

The bootstrap command applies migrations, creates or updates the local account, and installs three example contacts. It is safe to run again.

### 4. Start JobChat

```bash
npm run dev
```

| Application | URL |
| --- | --- |
| Chat | http://localhost:5273/chat |
| Landing page | http://localhost:5274/ |
| Call client | http://localhost:5180/call/ |
| API health check | http://localhost:5272/health |

Sign in as `admin`, or the username configured in `JCHAT_LOCAL_USERNAME`, with your local development password.

## Run in production

Build all applications, then start the server and gateway as separate processes:

```bash
npm run build

# Process 1: API and realtime services
npm --prefix jchat start

# Process 2: web applications and gateway on port 3000
npm start
```

Set production values in the module environment files before building, and run the server with `NODE_ENV=production`.

### Docker

```bash
docker build -t jobchat:0.1.0 .
docker run --rm \
  -p 3000:3000 -p 5272:5272 \
  --env-file jchat/.env \
  -v jobchat-sessions:/data/jchat-sessions \
  -v jobchat-files:/data/jobchat/files \
  jobchat:0.1.0
```

The container starts both the compiled server and the gateway as the unprivileged `node` user. Use a `DATABASE_URL` reachable from inside the container. Review the [runtime terms](docs/RUNTIME_TERMS.md) before distributing a prebuilt image.

## Architecture

```text
Browser
   │
   ├── Landing / Chat / Calls
   │
   ▼
Production gateway :3000
   │
   ▼
JobChat server :5272 ─── PostgreSQL 16 + pgvector
   │                  └── Local authentication and storage
   └── Isolated runtime workspaces ─── Configured model providers
```

In development, the web clients run on their own Vite servers. In production, `gateway.js` serves the built applications and proxies API, file, and WebSocket traffic. See [the architecture guide](docs/ARCHITECTURE.md) for process boundaries and data flow.

<details>
  <summary><strong>Repository layout</strong></summary>

```text
.
├── jchat/                 # Chat client, server, database schema, and tests
├── meeting/               # Realtime call client
├── landing/               # Public landing page and brand assets
├── docs/                  # Guides and product screenshots
├── licenses/              # Third-party license texts
├── gateway.js             # Production static server and reverse proxy
├── docker-compose.yml     # Local PostgreSQL + pgvector service
└── .github/               # CI, dependency updates, and community templates
```

</details>

## Documentation

| Guide | Purpose |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | Processes, data flow, and runtime boundaries |
| [Configuration](docs/CONFIGURATION.md) | Environment variables and provider settings |
| [Security audit](docs/SECURITY_AUDIT.md) | Release security checks and dependency policy |
| [Runtime terms](docs/RUNTIME_TERMS.md) | Proprietary Claude Agent SDK usage and distribution terms |
| [Contributing](CONTRIBUTING.md) | Development and pull-request workflow |
| [Changelog](CHANGELOG.md) | Release history |

## Development checks

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run audit
```

The default test suite uses test-only configuration and does not call hosted model APIs. The live SDK integration test is opt-in:

```bash
RUN_SDK_INTEGRATION=1 npm --prefix jchat test -- tests/integration/sdk-pipeline.test.ts
```

Only enable it with a valid provider credential and an understanding of the associated API usage.

## Security

Do not commit real `.env` files, credentials, session workspaces, uploads, or database dumps. Keep runtime data outside the source tree, use independent JWT secrets, and restrict any browser-side provider keys by referrer and API scope.

Please report vulnerabilities privately through the process in [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) before opening a pull request. Behavioral changes should include tests and documentation.

## License and notices

JobChat is licensed under [Apache License 2.0](LICENSE). Third-party components and media are credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), with additional license texts in [`licenses/`](licenses/).

The Claude Agent SDK and its bundled binary are proprietary Anthropic dependencies, not Apache-licensed JobChat code. Review [docs/RUNTIME_TERMS.md](docs/RUNTIME_TERMS.md) before offering a hosted service or distributing a prebuilt image.

Built-in contacts based on public figures are fictional demonstrations. They are not affiliated with, endorsed by, or speaking for those individuals.
