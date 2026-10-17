# Contributing to JobChat

Thank you for helping improve JobChat. By contributing, you agree that your
contributions are licensed under the project's Apache-2.0 license.

## Before you start

- Search existing issues before opening a duplicate.
- For security reports, follow `SECURITY.md` instead of opening a public issue.
- Discuss substantial behavior or architecture changes in an issue first.
- Keep changes focused; unrelated cleanup belongs in a separate pull request.

## Development setup

Requirements: Node.js 22+, npm 10+, Docker with Compose, and PostgreSQL 16+
with pgvector when not using the provided container.

```bash
npm ci
npm --prefix jchat ci
npm --prefix meeting ci
npm --prefix landing ci
cp .env.example .env
cp jchat/.env.example jchat/.env
cp landing/.env.example landing/.env
cp meeting/.env.example meeting/.env
```

Configure the local database password, JWT secrets, development password, and
model credentials. Never commit real `.env` files.

Start PostgreSQL and initialize the database:

```bash
npm run db:up
npm --prefix jchat run bootstrap
```

Start the development stack:

```bash
npm run dev
```

## Pull request checklist

1. Create a topic branch from `main`.
2. Add or update tests for behavior changes.
3. Update documentation and environment examples when configuration changes.
4. Run the relevant checks:

   ```bash
   npm run typecheck
   npm test
   npm run lint
   npm run build
   ```

5. Confirm `git status` contains no generated dependencies, build output,
   runtime data, screenshots with private information, or secrets.
6. Complete the pull request template and link the related issue.

## Code and content guidelines

- Preserve the existing TypeScript and React style in each module.
- Keep user data, session workspaces, and uploaded files outside the repository.
- Do not add compatibility branches for retired projects.
- Do not commit production credentials, personal data, or internal work logs.
- Preserve third-party copyright, license, NOTICE, and modification notices.
- New capabilities must work through the current JobChat runtime and must not
  depend on a local Claude Code installation.

## Reviews

Maintainers may request changes for correctness, security, accessibility,
privacy, licensing, documentation, or test coverage. Small, well-described
pull requests are easier to review and merge.
