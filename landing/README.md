# JobChat landing

The public JobChat landing page, built with React, TypeScript, Vite, Tailwind CSS, and shadcn/ui.

## Development

```bash
npm ci
cp .env.example .env
npm run dev
```

The development server listens on `http://localhost:5274/`. `VITE_CHAT_URL` points to the chat application; change it to `/chat` for a same-origin production gateway.

## Build

```bash
npm run build
```

Static output is written to `build/` and served by the root production gateway.

## Assets and attribution

Brand-image requirements and generated social assets are documented in `public/IMAGE_ASSETS_README.md`. shadcn/ui and Unsplash attributions are retained in `src/Attributions.md`; see the repository-level `THIRD_PARTY_NOTICES.md` for license texts and the asset inventory.
