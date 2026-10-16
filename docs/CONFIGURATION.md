# Configuration

JobChat uses per-module `.env` files. Examples are provided for every required file; none contains real credentials. Values prefixed with `VITE_` are embedded in browser bundles and must be treated as public.

## Root `.env`

Used by `docker-compose.yml` for local PostgreSQL:

| Variable | Required | Description |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | Yes | Local database password; must match `DATABASE_URL` |
| `POSTGRES_PORT` | No | Host port, defaults to `5432` |

The container binds to `127.0.0.1` and stores data in the `jobchat-postgres` Docker volume.

## `jchat/.env`

### Required for the normal local workflow

| Variable | Description |
| --- | --- |
| `ANTHROPIC_API_KEY` | Credential used for contact replies |
| `DATABASE_URL` | PostgreSQL connection string |
| `LOCAL_JWT_ACCESS_SECRET` | Random secret for access tokens |
| `LOCAL_JWT_REFRESH_SECRET` | Different random secret for refresh tokens |
| `JCHAT_SESSIONS_ROOT` | Absolute runtime-workspace path outside the repository |
| `FILES_ROOT` | Absolute uploaded-file path outside the repository |
| `JCHAT_LOCAL_USERNAME` | Local account used by `create-user` and `seed:local` |
| `JCHAT_LOCAL_PASSWORD` | Local account password, at least 12 characters |

Generate independent JWT secrets:

```bash
openssl rand -hex 64
openssl rand -hex 64
```

### Server behavior

| Variable | Default | Description |
| --- | --- | --- |
| `JCHAT_PORT` | `5272` | API and WebSocket listener |
| `NODE_ENV` | `development` | Set to `production` for deployment |
| `AUTH_TRANSITION` | `0` | Keep disabled for the local-first setup |
| `ANTHROPIC_BASE_URL` | Provider default | Optional API-compatible endpoint |
| `ANTHROPIC_MODEL` | Provider default | Optional model override |
| `OPENAI_API_KEY` | Empty | Enables OpenAI embeddings when configured |
| `OPENAI_BASE_URL` | Provider default | Optional embeddings endpoint |
| `JCHAT_EMBEDDING_PROVIDER` | Auto | `openai` or `stub-zero-vector` |
| `JCHAT_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model |
| `ALIBABA_DASHSCOPE_API_KEY` | Empty | Optional Qwen realtime provider credential |
| `QWEN_OMNI_WS_URL` | Qwen realtime endpoint | Optional realtime WebSocket endpoint |
| `SLACK_WEBHOOK_URL` | Empty | Optional Slack notifications |

Concurrency, upload, memory, and round-table limits are documented inline in `jchat/.env.example`. The zero-vector embedding mode is intended only for development without an embedding provider; recall quality is limited in that mode.

## `meeting/.env`

| Variable | Required for calls | Description |
| --- | --- | --- |
| `VITE_GEMINI_API_KEY` | Yes, for the Google realtime client | Browser-side Google GenAI credential |

**Browser-key warning:** anything named `VITE_` can be read by users of the deployed site. Use a key restricted by HTTP referrer and only the required API scope. Do not use an unrestricted production key.

## `landing/.env`

| Variable | Local example | Description |
| --- | --- | --- |
| `VITE_SITE_URL` | `http://localhost:5274` | Canonical site origin for metadata |
| `VITE_CLIENT_URL` | `http://localhost:5274` | Fallback site origin |
| `VITE_CHAT_URL` | `http://localhost:5273/chat` | Destination for chat calls to action |

For a deployment behind the included gateway, use the public site origin and `VITE_CHAT_URL=/chat`.

## Secret-handling rules

- `.env` and its variants are ignored; only `.env.example` files belong in Git.
- Do not place real values in documentation, tests, screenshots, or issue reports.
- Rotate credentials that may have been committed, even after deleting the visible value.
- Production secrets should come from the deployment platform's secret manager where available.
