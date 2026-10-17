# Security Policy

## Supported versions

Security fixes are applied to the latest release on `main`. Older releases may
not receive fixes.

## Report a vulnerability

Please report suspected vulnerabilities privately to
[done@jobchat.io](mailto:done@jobchat.io) with the subject
`[JobChat Security]`.

Include:

- affected version or commit;
- impact and affected component;
- reproduction steps or proof of concept;
- any suggested mitigation.

Do not open a public issue for an unresolved vulnerability. We aim to
acknowledge reports within five business days and will coordinate a fix and
disclosure timeline with the reporter.

## Security notes for self-hosters

- Never commit or publish `.env` files, session workspaces, uploaded files, or
  database dumps.
- Use independent, randomly generated JWT access and refresh secrets.
- Restrict browser-side model API keys by HTTP referrer and API scope.
- Keep session and file roots outside the repository with least-privilege
  filesystem permissions.
- Bind local development databases to `127.0.0.1`; do not expose them directly
  to the internet.
- Rotate any credential that may have been committed or shared, even after it
  has been removed from the latest source.

Automated secret scanning and dependency review are part of the release
process, but no scanner can prove that a repository is free of secrets or
vulnerabilities.
