# Architecture

## Modules

### `jchat/`

The main application contains a React client and a Node.js server. The server provides local JWT authentication, conversation and contact APIs, PostgreSQL persistence, realtime WebSocket delivery, file storage, vector memory, call lifecycle endpoints, and the isolated model runtime.

The production client is built with Vite. The server is compiled with TypeScript, after which `tsc-alias` rewrites path aliases and completes ESM file extensions so the output runs directly on Node.js.

### `meeting/`

The call client provides browser-based realtime audio/video interaction and sends session lifecycle and transcript data through the JobChat `/api/call/*` endpoints. Browser credentials must be restricted as described in `CONFIGURATION.md`.

### `landing/`

The public landing page is a separate Vite application. In development it runs on port 5274. In production the gateway serves its built files.

### `gateway.js`

The gateway is a small Express process that:

- serves `landing/build`, `jchat/dist`, and `meeting/build`;
- proxies `/api` to the JobChat server;
- proxies WebSocket upgrades at `/ws`;
- provides SPA fallbacks for `/chat`, `/login`, and `/call`.

## Development ports

| Port | Purpose |
| --- | --- |
| `5272` | JobChat API and WebSocket server |
| `5273` | Chat Vite development server |
| `5274` | Landing Vite development server |
| `5180` | Call Vite development server |
| `3000` | Production gateway |

## Data stores

PostgreSQL is the primary relational and vector store. The schema includes local users, contacts, conversations, messages, call sessions, refresh-token families, and vector memory. Full-text search uses a generated `tsvector` column, while memory recall uses pgvector.

Database initialization has two layers:

1. `drizzle/0000_test.sql` creates the current table baseline.
2. Ordered SQL migrations add extensions, generated columns, functions, triggers, and indexes.

`jchat_schema_migrations` records applied files so initialization is repeatable.

Uploaded files and runtime workspaces are intentionally outside the database and outside the repository.

## Runtime isolation

The model runtime uses `@anthropic-ai/claude-agent-sdk` from npm, including its bundled executable. A global Claude Code installation is not required.

Important boundaries:

- `JCHAT_SESSIONS_ROOT` must be an absolute path outside the source tree.
- Runtime environment variables are passed explicitly rather than inheriting the developer's complete shell environment.
- Runtime workspaces contain an empty `CLAUDE.md` sentinel to prevent unintended parent-directory instruction loading.
- Capability links are validated before use.

These boundaries prevent local development configuration from leaking into self-hosted runtime sessions.

## Realtime flows

### Chat

The browser sends messages through the API. The server persists them, schedules a contact reply through the isolated runtime, and broadcasts updates through PostgreSQL `LISTEN` / `NOTIFY` and WebSocket snapshots.

### Calls

The call client obtains contact and conversation context from the server, streams provider audio/video from the browser, and sends transcript entries back through `/api/call/*`. Call completion updates the session and schedules transcript-to-memory processing. A periodic sweeper closes stale ongoing sessions as a final-consistency safeguard.

## Testing boundaries

The default Vitest suite uses mock databases and deterministic test-only credentials. The real SDK pipeline test is skipped unless both `RUN_SDK_INTEGRATION=1` and a real provider credential are present, preventing accidental hosted API usage in normal CI.
