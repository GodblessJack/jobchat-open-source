# Dependency audit policy

Run the complete audit with:

```bash
npm run audit
```

The script performs two checks for every runtime module:

1. **Production dependency audit (`npm audit --omit=dev`)** — every moderate,
   high, or critical finding blocks the release.
2. **Full dependency audit** — every new moderate, high, or critical finding
   blocks the release except the explicitly documented development-only
   exceptions below.

This avoids both hiding development-tool risk and accepting production risk
merely because a fix would require an unreviewed major-version upgrade.

## Current status — 2026-10-16

- Production findings: **0** in gateway, jchat, meeting, and landing.
- Blocked full-audit findings: **0**.
- Documented development exceptions: **2**.

## Development-only exceptions

### `GHSA-vfj7-8cjw-p6xm` — braces

Reached through build-time glob processing in Tailwind CSS and `tsc-alias`.
The release pipeline processes repository-controlled paths only; it does not
pass user-controlled glob patterns to these tools. The vulnerable packages are
not present in the production dependency audit.

### `GHSA-67mh-4wv8-2f99` — esbuild development server

Reached through Drizzle's development tooling. The affected development server
is not exposed by the production deployment. The related Windows-only advisory
`GHSA-g7r4-m6w7-qqqr` is also allowlisted for developers on Windows, subject to
the same non-exposure requirement.

## Review requirements

- Re-run `npm run audit` after every dependency update and before every release.
- Do not add an exception without a written exposure analysis and a review date.
- Review these exceptions by **2027-01-16**. Prefer upgrading or replacing the
  affected build tools over renewing an exception.
- Any new advisory, any production finding, or any change that exposes the
  affected development services to untrusted input blocks release.

Dependency auditing does not replace secret scanning, license review, tests, or
manual security review.
