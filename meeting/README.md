# JobChat call client

The browser-based realtime audio/video call interface, built with React, TypeScript, Vite, Tailwind CSS, and Google GenAI.

## Development

```bash
npm ci
cp .env.example .env
npm run dev
```

The client listens on `http://localhost:5180/call/` and proxies `/api` to the JobChat server on port 5272.

Set `VITE_GEMINI_API_KEY` to a browser key restricted by HTTP referrer and API scope. Never use an unrestricted production key: all `VITE_` values are public in the built bundle.

## JobChat integration

- Open calls with a `?conversationId=` URL parameter.
- Use JobChat `/api/call/*` endpoints for session and transcript persistence.
- Transcript messages carry `metadata.source='call'` so they remain distinct in the chat history.
- End calls through both the standard bearer-header path and the beacon-compatible request path used during page teardown.

## Build

```bash
npm run build
```

Static output is written to `build/` and served by the root production gateway under `/call/`.
